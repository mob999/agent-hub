import { spawn as spawnChildProcess } from "node:child_process";
import type { ChildProcessByStdio, SpawnOptionsWithoutStdio } from "node:child_process";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import type {
  AgentRunArtifactUpload,
  AgentAdapter,
  AgentRunInput,
} from "@agent-hub/core/runtime";
import type {
  AgentHubMcpToolInput,
  AgentHubMcpToolResult,
  AgentHubListTasksToolResult,
  AgentHubUploadArtifactToolResult,
  AgentHubMcpToolName,
  AgentRuntimeConfig,
  DaemonRuntime,
  RunEvent,
  RunId,
  RuntimeRawEvent,
} from "@agent-hub/core/protocol";

import type { AgentHubMcpSessionHandle } from "../mcp/relay";
import { LineDecoder, parseJsonLine } from "./jsonl";

type SpawnedProcess = Pick<
  ChildProcessByStdio<Writable, Readable, Readable>,
  "kill" | "once" | "stderr" | "stdin" | "stdout"
>;

export type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => SpawnedProcess;

export interface CodexAdapterOptions {
  executablePath?: string;
  mcpRelay?: AgentHubMcpRelayLike;
  mcpServerCommand?: AgentHubMcpServerCommand;
  spawnProcess?: SpawnCodexProcess;
}

export interface AgentHubMcpServerCommand {
  args: string[];
  command: string;
  cwd?: string;
}

export interface AgentHubMcpRelayLike {
  createSession(input: {
    enabledTools: AgentHubMcpToolName[];
    onArtifactUpload?(
      upload: AgentRunArtifactUpload,
    ): Promise<AgentHubUploadArtifactToolResult>;
    onToolCall(call: {
      createdAt: string;
      input: AgentHubMcpToolInput;
      name: AgentHubMcpToolName;
      runId: RunId;
      toolCallId: string;
    }): AgentHubMcpToolResult | Promise<AgentHubMcpToolResult>;
    runId: RunId;
    workspacePath: string;
  }): AgentHubMcpSessionHandle;
}

interface AsyncQueueItem<T> {
  done: boolean;
  value?: T;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  #ended = false;
  #items: T[] = [];
  #resolvers: Array<(item: AsyncQueueItem<T>) => void> = [];

  push(item: T): void {
    if (this.#ended) {
      return;
    }

    const resolve = this.#resolvers.shift();

    if (resolve === undefined) {
      this.#items.push(item);
      return;
    }

    resolve({ done: false, value: item });
  }

  end(): void {
    if (this.#ended) {
      return;
    }

    this.#ended = true;

    for (const resolve of this.#resolvers.splice(0)) {
      resolve({ done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.#items.length > 0) {
        yield this.#items.shift() as T;
        continue;
      }

      if (this.#ended) {
        return;
      }

      const item = await new Promise<AsyncQueueItem<T>>((resolve) => {
        this.#resolvers.push(resolve);
      });

      if (item.done) {
        return;
      }

      yield item.value as T;
    }
  }
}

function nowIsoDateTime(): string {
  return new Date().toISOString();
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

function createCodexRuntimeEvent(
  runId: RunId,
  raw: RuntimeRawEvent,
  createdAt: string,
): RunEvent {
  return {
    type: "runtime.event",
    runId,
    raw,
    createdAt,
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

    return [createCodexRuntimeEvent(runId, raw, createdAt)];
  }

  const record = value as Record<string, unknown>;
  const nativeType = readStringProperty(record, ["type"]);
  const raw = createCodexRawEvent(record, nativeType);
  const events: RunEvent[] = [createCodexRuntimeEvent(runId, raw, createdAt)];

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

function createLogLineEvent(
  runId: RunId,
  stream: "stdout" | "stderr",
  line: string,
): RunEvent {
  return {
    type: "log.line",
    runId,
    stream,
    line,
    createdAt: nowIsoDateTime(),
  };
}

function createCodexSpawnOptions(
  options: SpawnOptionsWithoutStdio,
): SpawnOptionsWithoutStdio {
  return process.platform === "win32"
    ? {
        ...options,
        shell: true,
      }
    : options;
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

function createAgentHubMcpServerCommand(): AgentHubMcpServerCommand {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const isTypeScriptSource = currentFile.endsWith(".ts");

  if (isTypeScriptSource) {
    return {
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        path.resolve(currentDir, "../mcp/stdio-server.ts"),
      ],
      cwd: path.resolve(currentDir, "../../../.."),
    };
  }

  return {
    command: process.execPath,
    args: [path.resolve(currentDir, "../mcp/stdio-server.js")],
    cwd: path.resolve(currentDir, ".."),
  };
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

export class CodexAdapter implements AgentAdapter {
  readonly runtimeKind = "codex" as const;

  #executablePath: string;
  #mcpRelay: AgentHubMcpRelayLike | undefined;
  #mcpServerCommand: AgentHubMcpServerCommand;
  #spawnProcess: SpawnCodexProcess;

  constructor(options: CodexAdapterOptions = {}) {
    this.#executablePath = options.executablePath ?? "codex";
    this.#mcpRelay = options.mcpRelay;
    this.#mcpServerCommand =
      options.mcpServerCommand ?? createAgentHubMcpServerCommand();
    this.#spawnProcess = options.spawnProcess ?? spawnChildProcess;
  }

  async detect(): Promise<DaemonRuntime> {
    const process = this.#spawnProcess(this.#executablePath, ["--version"], {
      ...createCodexSpawnOptions({
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
        { name: "ephemeral-runs", enabled: true },
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
    const mcpTasks: AgentHubListTasksToolResult["tasks"] = [
      ...(input.agentHubMcpTasks ?? []),
    ];
    const mcpSession = this.#mcpRelay?.createSession({
      enabledTools: input.agentHubMcpTools ?? [],
      runId: input.run.id,
      workspacePath: input.workspacePath,
      onArtifactUpload: input.uploadArtifact,
      onToolCall: (call) => {
        queue.push({
          type: "agenthub.tool.call",
          runId: call.runId,
          toolCallId: call.toolCallId,
          name: call.name,
          input: call.input,
          createdAt: call.createdAt,
        });

        if (call.name === "list_tasks") {
          const status = "status" in call.input &&
            typeof call.input.status === "string"
            ? call.input.status
            : undefined;

          return {
            accepted: true,
            tasks: status === undefined
              ? mcpTasks.map((task) => ({ ...task }))
              : mcpTasks
                  .filter((task) => task.status === status)
                  .map((task) => ({ ...task })),
          };
        }

        if (
          call.name === "create_task" &&
          "title" in call.input &&
          "assigneeAgentId" in call.input
        ) {
          const taskInput = call.input as {
            assigneeAgentId: string;
            taskId?: string;
            title: string;
          };

          const task = {
            id: taskInput.taskId ?? call.toolCallId,
            title: taskInput.title,
            assigneeAgentId: taskInput.assigneeAgentId,
            status: "assigned" as const,
          };
          mcpTasks.push(task);

          return {
            accepted: true,
            task: {
              id: task.id,
              title: task.title,
              assigneeAgentId: task.assigneeAgentId,
            },
          };
        }

        return { accepted: true };
      },
    });
    const args = [
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
      ...(mcpSession === undefined
        ? []
        : createAgentHubMcpConfigArgs({
            command: this.#mcpServerCommand,
            session: mcpSession,
          })),
      "-",
    ];
    const process = this.#spawnProcess(this.#executablePath, args, {
      ...createCodexSpawnOptions({
        cwd: input.workspacePath,
        stdio: "pipe",
      }),
    });
    const stdout = new LineDecoder();
    const stderr = new LineDecoder();
    let completed = false;
    let aborted = false;

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

    const handleStdoutLine = (line: string) => {
      const parsed = parseJsonLine(line);

      if (!parsed.ok) {
        queue.push(createLogLineEvent(input.run.id, "stdout", parsed.line));
        return;
      }

      for (const event of mapCodexJsonEvents(parsed.value, input.run.id)) {
        queue.push(event);
      }
    };

    process.stdout.on("data", (chunk) => {
      for (const line of stdout.push(chunk)) {
        handleStdoutLine(line);
      }
    });
    process.stdout.on("end", () => {
      const line = stdout.flush();

      if (line !== undefined) {
        handleStdoutLine(line);
      }
    });

    process.stderr.on("data", (chunk) => {
      for (const line of stderr.push(chunk)) {
        queue.push(createLogLineEvent(input.run.id, "stderr", line));
      }
    });
    process.stderr.on("end", () => {
      const line = stderr.flush();

      if (line !== undefined) {
        queue.push(createLogLineEvent(input.run.id, "stderr", line));
      }
    });

    process.once("error", (error) => {
      complete("failed", error instanceof Error ? error.message : String(error));
    });
    process.once("close", (exitCode) => {
      if (aborted) {
        complete("cancelled");
        return;
      }

      complete(
        exitCode === 0 ? "succeeded" : "failed",
        exitCode === 0 ? undefined : `Codex exited with code ${exitCode}`,
      );
    });

    input.abortSignal?.addEventListener(
      "abort",
      () => {
        aborted = true;
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
    process.stdin.write(input.prompt);
    process.stdin.end();

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
