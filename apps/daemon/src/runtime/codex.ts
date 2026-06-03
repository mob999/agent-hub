import { spawn as spawnChildProcess } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

import type {
  AgentAdapter,
  AgentRunInput,
} from "@agent-hub/core/runtime";
import type {
  DaemonRuntime,
  RunEvent,
  RunId,
  RuntimeRawEvent,
} from "@agent-hub/core/protocol";

import { LineDecoder, parseJsonLine } from "./jsonl";
import { buildPromptWithRuntimeMemory } from "./memory-context";
import {
  createAgentHubMcpServerCommand,
  createAgentHubMcpSession,
  type AgentHubMcpRelayLike,
  type AgentHubMcpServerCommand,
} from "./mcp";
import type { AgentHubMcpSessionHandle } from "../mcp/relay";
import {
  AsyncEventQueue,
  attachJsonLineRuntimeOutput,
  createLogLineEvent,
  createRuntimeEvent,
  createRuntimeSpawnOptions,
  mapAbortReasonToRunStatus,
  nowIsoDateTime,
  type RuntimeChildProcess,
} from "./common";

export type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => RuntimeChildProcess;

export interface CodexAdapterOptions {
  dailyMemoryRefreshIntervalMs?: number;
  dailyMemoryRefreshTranscriptMaxBytes?: number;
  executablePath?: string;
  mcpRelay?: AgentHubMcpRelayLike;
  mcpServerCommand?: AgentHubMcpServerCommand;
  spawnProcess?: SpawnCodexProcess;
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringProperty(
  value: Record<string, unknown>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const property = value[name];

    if (typeof property === "string" && property.length > 0) {
      return property;
    }
  }

  return undefined;
}

function readRecordProperty(
  value: Record<string, unknown>,
  names: string[],
): Record<string, unknown> | undefined {
  for (const name of names) {
    const property = value[name];

    if (
      typeof property === "object" &&
      property !== null &&
      !Array.isArray(property)
    ) {
      return property as Record<string, unknown>;
    }
  }

  return undefined;
}

function createCodexRawEvent(
  payload: unknown,
  nativeType: string | undefined,
): RuntimeRawEvent {
  return {
    runtimeKind: "codex",
    ...(nativeType === undefined ? {} : { nativeType }),
    payload,
  };
}

function mapCodexCommandStatus(
  item: Record<string, unknown>,
): Extract<RunEvent, { type: "tool.call.completed" }>["status"] {
  const exitCode = item.exit_code;

  if (typeof exitCode === "number") {
    return exitCode === 0 ? "succeeded" : "failed";
  }

  return item.status === "completed" ? "succeeded" : "failed";
}

function mapCodexJsonEvents(value: unknown, runId: RunId): RunEvent[] {
  const createdAt = nowIsoDateTime();

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const raw = createCodexRawEvent(value, undefined);

    return [createRuntimeEvent(runId, raw, createdAt)];
  }

  const record = value as Record<string, unknown>;
  const nativeType = readStringProperty(record, ["type"]);
  const raw = createCodexRawEvent(record, nativeType);
  const events: RunEvent[] = [createRuntimeEvent(runId, raw, createdAt)];
  const threadId = readStringProperty(record, ["thread_id", "threadId"]);

  if (nativeType === "thread.started" && threadId !== undefined) {
    events.push({
      type: "runtime.session.started",
      runId,
      runtimeKind: "codex",
      sessionId: threadId,
      createdAt,
    });
  }

  if (nativeType !== "item.started" && nativeType !== "item.completed") {
    return events;
  }

  const item = readRecordProperty(record, ["item"]);
  const itemType =
    item === undefined ? undefined : readStringProperty(item, ["type"]);

  if (item === undefined || itemType === undefined) {
    return events;
  }

  const itemId =
    readStringProperty(item, ["id"]) ?? `${runId}:codex-item:${createdAt}`;

  if (nativeType === "item.completed" && itemType === "agent_message") {
    const content = toText(item.text) ?? toText(item.content) ?? toText(item.delta);

    if (content !== undefined) {
      events.push({
        type: "message.delta",
        runId,
        content,
        raw,
        createdAt,
      });
    }

    return events;
  }

  if (itemType !== "command_execution") {
    return events;
  }

  if (nativeType === "item.started") {
    events.push({
      type: "tool.call.started",
      runId,
      toolCallId: itemId,
      name: itemType,
      input: {
        command: item.command,
      },
      raw,
      createdAt,
    });

    return events;
  }

  const status = mapCodexCommandStatus(item);
  const exitCode = item.exit_code;

  events.push({
    type: "tool.call.completed",
    runId,
    toolCallId: itemId,
    name: itemType,
    status,
    output: {
      command: item.command,
      aggregated_output: item.aggregated_output,
      exit_code: exitCode,
      status: item.status,
    },
    ...(status === "failed" && typeof exitCode === "number"
      ? { error: `Command exited with code ${exitCode}` }
      : {}),
    raw,
    createdAt,
  });

  return events;
}

function createCodexDeveloperInstructionsConfig(
  agentInstructions: string | undefined,
): string | undefined {
  const trimmedInstructions = agentInstructions?.trim();

  if (trimmedInstructions === undefined || trimmedInstructions.length === 0) {
    return undefined;
  }

  return `developer_instructions=${JSON.stringify(trimmedInstructions)}`;
}

function toTomlLiteral(value: string): string {
  if (!value.includes("'") && !/[\r\n]/.test(value)) {
    return `'${value}'`;
  }

  return JSON.stringify(value);
}

function toTomlStringArray(values: string[]): string {
  return `[${values.map(toTomlLiteral).join(",")}]`;
}

function createAgentHubMcpConfigArgs(input: {
  command: AgentHubMcpServerCommand;
  session: AgentHubMcpSessionHandle;
}): string[] {
  return [
    "-c",
    `mcp_servers.agenthub.command=${toTomlLiteral(input.command.command)}`,
    "-c",
    `mcp_servers.agenthub.args=${toTomlStringArray(input.command.args)}`,
    "-c",
    "mcp_servers.agenthub.startup_timeout_sec=15",
    "-c",
    `mcp_servers.agenthub.env.AGENTHUB_MCP_RELAY_URL=${toTomlLiteral(input.session.relayUrl)}`,
    "-c",
    `mcp_servers.agenthub.env.AGENTHUB_MCP_SESSION_TOKEN=${toTomlLiteral(input.session.token)}`,
    "-c",
    `mcp_servers.agenthub.env.AGENTHUB_MCP_TOOLS=${toTomlLiteral(input.session.enabledTools.join(","))}`,
    ...(input.command.cwd === undefined
      ? []
      : [
          "-c",
          `mcp_servers.agenthub.cwd=${toTomlLiteral(input.command.cwd)}`,
        ]),
  ];
}

async function runHiddenCodexPrompt(input: {
  agentInstructions?: string;
  executablePath: string;
  prompt: string;
  spawnProcess: SpawnCodexProcess;
  workspacePath: string;
}): Promise<string> {
  const developerInstructionsConfig = createCodexDeveloperInstructionsConfig(
    input.agentInstructions,
  );
  const process = input.spawnProcess(input.executablePath, [
    "exec",
    "--json",
    "--ephemeral",
    "--cd",
    input.workspacePath,
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    ...(developerInstructionsConfig === undefined
      ? []
      : ["-c", developerInstructionsConfig]),
    "-",
  ], {
    ...createRuntimeSpawnOptions({
      cwd: input.workspacePath,
      stdio: "pipe",
    }),
  });
  const stdout = new LineDecoder();
  const stderr = new LineDecoder();
  const output: string[] = [];
  const errors: string[] = [];

  process.stdout.on("data", (chunk) => {
    for (const line of stdout.push(chunk)) {
      const parsed = parseJsonLine(line);

      if (!parsed.ok) {
        output.push(parsed.line);
        continue;
      }

      for (const event of mapCodexJsonEvents(parsed.value, "memory_compaction")) {
        if (event.type === "message.delta") {
          output.push(event.content);
        }
      }
    }
  });
  process.stderr.on("data", (chunk) => errors.push(...stderr.push(chunk)));

  process.stdin.write(input.prompt);
  process.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    process.once("error", reject);
    process.once("close", resolve);
  });

  const lastStdout = stdout.flush();
  const lastStderr = stderr.flush();

  if (lastStdout !== undefined) {
    output.push(lastStdout);
  }

  if (lastStderr !== undefined) {
    errors.push(lastStderr);
  }

  if (exitCode !== 0) {
    throw new Error(errors.join("\n") || `Codex compaction exited with code ${exitCode}`);
  }

  return output.join("\n").trim();
}

export class CodexAdapter implements AgentAdapter {
  readonly runtimeKind = "codex" as const;

  #dailyMemoryRefreshIntervalMs: number;
  #dailyMemoryRefreshTranscriptMaxBytes: number;
  #executablePath: string;
  #mcpRelay: AgentHubMcpRelayLike | undefined;
  #mcpServerCommand: AgentHubMcpServerCommand;
  #spawnProcess: SpawnCodexProcess;

  constructor(options: CodexAdapterOptions = {}) {
    this.#dailyMemoryRefreshIntervalMs =
      options.dailyMemoryRefreshIntervalMs ?? 4 * 60 * 60 * 1000;
    this.#dailyMemoryRefreshTranscriptMaxBytes =
      options.dailyMemoryRefreshTranscriptMaxBytes ?? 60 * 1024;
    this.#executablePath = options.executablePath ?? "codex";
    this.#mcpRelay = options.mcpRelay;
    this.#mcpServerCommand =
      options.mcpServerCommand ?? createAgentHubMcpServerCommand();
    this.#spawnProcess = options.spawnProcess ?? spawnChildProcess;
  }

  async detect(): Promise<DaemonRuntime> {
    const process = this.#spawnProcess(this.#executablePath, ["--version"], {
      ...createRuntimeSpawnOptions({
        stdio: "pipe",
      }),
    });
    const stdout = new LineDecoder();
    const stderr = new LineDecoder();
    const output: string[] = [];
    const errors: string[] = [];

    process.stdout.on("data", (chunk) => output.push(...stdout.push(chunk)));
    process.stderr.on("data", (chunk) => errors.push(...stderr.push(chunk)));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      process.once("error", reject);
      process.once("close", resolve);
    });

    const lastStdout = stdout.flush();
    const lastStderr = stderr.flush();

    if (lastStdout !== undefined) {
      output.push(lastStdout);
    }

    if (lastStderr !== undefined) {
      errors.push(lastStderr);
    }

    if (exitCode !== 0) {
      throw new Error(
        `Codex runtime detection failed: ${errors.join("\n") || exitCode}`,
      );
    }

    return {
      daemonDeviceId: "",
      runtimeKind: "codex",
      runtimeVersion: output.join("\n").trim() || undefined,
      executablePath: this.#executablePath,
      capabilities: [
        { name: "json-events", enabled: true },
        { name: "persistent-session", enabled: true },
        { name: "resume-session", enabled: true },
        { name: "agenthub-mcp", enabled: this.#mcpRelay !== undefined },
      ],
      status: "ready",
      lastSeenAt: nowIsoDateTime(),
    };
  }

  run(input: AgentRunInput): AsyncIterable<RunEvent> {
    const queue = new AsyncEventQueue<RunEvent>();
    const developerInstructionsConfig = createCodexDeveloperInstructionsConfig(
      input.agentInstructions,
    );
    const mcpSession = createAgentHubMcpSession({
      eventSink: queue,
      relay: this.#mcpRelay,
      runInput: input,
    });
    const resumeSessionId =
      input.run.dispatchMode === "resume"
        ? input.run.runtimeSessionId
        : undefined;
    const args = [
      "exec",
      ...(resumeSessionId === undefined ? [] : ["resume", resumeSessionId]),
      "--json",
      ...(resumeSessionId === undefined ? ["--cd", input.workspacePath] : []),
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      ...(developerInstructionsConfig === undefined
        ? []
        : ["-c", developerInstructionsConfig]),
      ...(mcpSession === undefined
        ? []
        : createAgentHubMcpConfigArgs({
            command: this.#mcpServerCommand,
            session: mcpSession,
          })),
      "-",
    ];
    const process = this.#spawnProcess(this.#executablePath, args, {
      ...createRuntimeSpawnOptions({
        cwd: input.workspacePath,
        stdio: "pipe",
      }),
    });
    let completed = false;
    let aborted = false;
    let abortStatus: Extract<RunEvent, { type: "run.completed" }>["status"] =
      "cancelled";
    let stdinInitialized = false;
    let pendingCloseExitCode: number | null | undefined;

    const complete = (
      status: Extract<RunEvent, { type: "run.completed" }>["status"],
      error?: string,
    ) => {
      if (completed) {
        return;
      }

      completed = true;
      mcpSession?.close();
      queue.push({
        type: "run.completed",
        runId: input.run.id,
        status,
        error,
        createdAt: nowIsoDateTime(),
      });
      queue.end();
    };
    const completeFromExitCode = (exitCode: number | null): void => {
      if (!stdinInitialized) {
        pendingCloseExitCode = exitCode;
        return;
      }

      complete(
        exitCode === 0 ? "succeeded" : "failed",
        exitCode === 0 ? undefined : `Codex exited with code ${exitCode}`,
      );
    };
    const markStdinInitialized = (): void => {
      stdinInitialized = true;
      if (pendingCloseExitCode !== undefined) {
        completeFromExitCode(pendingCloseExitCode);
      }
    };

    attachJsonLineRuntimeOutput({
      eventSink: queue,
      mapJsonValue: (value) => mapCodexJsonEvents(value, input.run.id),
      process,
      runId: input.run.id,
    });

    process.once("error", (error) => {
      complete("failed", error instanceof Error ? error.message : String(error));
    });
    process.once("close", (exitCode) => {
      if (aborted) {
        complete(abortStatus);
        return;
      }

      completeFromExitCode(exitCode);
    });

    input.abortSignal?.addEventListener(
      "abort",
      () => {
        aborted = true;
        abortStatus = mapAbortReasonToRunStatus(input.abortSignal?.reason);
        process.kill("SIGTERM");
      },
      { once: true },
    );

    queue.push({
      type: "run.started",
      runId: input.run.id,
      workspacePath: input.workspacePath,
      createdAt: nowIsoDateTime(),
    });
    void (async () => {
      try {
        const runPrompt = await buildPromptWithRuntimeMemory({
          agentInstructions: input.agentInstructions,
          basePrompt: input.prompt,
          contextCompression: input.contextCompression,
          eventSink: queue,
          hiddenPrompt: (hiddenInput) => runHiddenCodexPrompt({
            agentInstructions: hiddenInput.agentInstructions,
            executablePath: this.#executablePath,
            prompt: hiddenInput.prompt,
            spawnProcess: this.#spawnProcess,
            workspacePath: hiddenInput.workspacePath,
          }),
          memoryOptions: {
            dailyMemoryRefreshIntervalMs: this.#dailyMemoryRefreshIntervalMs,
            dailyMemoryRefreshTranscriptMaxBytes:
              this.#dailyMemoryRefreshTranscriptMaxBytes,
          },
          runId: input.run.id,
          runtimeKind: "codex",
          workspacePath: input.workspacePath,
        });

        process.stdin.write(runPrompt);
        process.stdin.end();
        markStdinInitialized();
      } catch (error) {
        process.stdin.write(input.prompt);
        process.stdin.end();
        markStdinInitialized();
        queue.push(
          createLogLineEvent(
            input.run.id,
            "stderr",
            `Memory prompt/compaction failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    })();

    return queue;
  }

  async cancel(): Promise<void> {
    return Promise.resolve();
  }
}

export function createCodexAdapter(
  options?: CodexAdapterOptions,
): CodexAdapter {
  return new CodexAdapter(options);
}
