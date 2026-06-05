import { spawn as spawnChildProcess } from "node:child_process";

import type {
  AgentAdapter,
  AgentRunInput,
} from "@agent-hub/core/runtime";
import type {
  AgentHubMcpToolName,
  DaemonRuntime,
  RunEvent,
  RunId,
  RuntimeRawEvent,
} from "@agent-hub/core/protocol";

import type { AgentHubMcpSessionHandle } from "../mcp/relay";
import { LineDecoder, parseJsonLine } from "./jsonl";
import { buildPromptWithRuntimeMemory } from "./memory-context";
import {
  createAgentHubMcpServerCommand,
  createAgentHubMcpSession,
  type AgentHubMcpRelayLike,
  type AgentHubMcpServerCommand,
} from "./mcp";
import {
  AsyncEventQueue,
  attachJsonLineRuntimeOutput,
  createLogLineEvent,
  createRuntimeEvent,
  createRuntimeProcessSpawner,
  createRuntimeSpawnOptions,
  mapAbortReasonToRunStatus,
  nowIsoDateTime,
  type SpawnRuntimeProcess,
} from "./common";
import { RuntimeTempFiles } from "./temp-files";

export interface ClaudeCodeAdapterOptions {
  dailyMemoryRefreshIntervalMs?: number;
  dailyMemoryRefreshTranscriptMaxBytes?: number;
  executablePath?: string;
  mcpRelay?: AgentHubMcpRelayLike;
  mcpServerCommand?: AgentHubMcpServerCommand;
  spawnProcess?: SpawnRuntimeProcess;
}

function createClaudeRawEvent(
  payload: unknown,
  nativeType: string | undefined,
): RuntimeRawEvent {
  return {
    runtimeKind: "claude-code",
    ...(nativeType === undefined ? {} : { nativeType }),
    payload,
  };
}

function createClaudeMcpConfig(input: {
  command: AgentHubMcpServerCommand;
  session: AgentHubMcpSessionHandle;
}): string {
  return JSON.stringify({
    mcpServers: {
      agenthub: {
        type: "stdio",
        alwaysLoad: true,
        command: input.command.command,
        args: input.command.args,
        ...(input.command.cwd === undefined ? {} : { cwd: input.command.cwd }),
        env: {
          AGENTHUB_MCP_RELAY_URL: input.session.relayUrl,
          AGENTHUB_MCP_SESSION_TOKEN: input.session.token,
          AGENTHUB_MCP_TOOLS: input.session.enabledTools.join(","),
        },
      },
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? (value[key] as string) : undefined;
}

function readClaudeSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sessionId = readString(value, "session_id");

  return sessionId === undefined || sessionId.length === 0
    ? undefined
    : sessionId;
}

function mapClaudeJsonEvents(
  value: unknown,
  runId: RunId,
  options: { emitRuntimeSessionStarted?: boolean } = {},
): RunEvent[] {
  const createdAt = nowIsoDateTime();

  if (!isRecord(value)) {
    return [createRuntimeEvent(runId, createClaudeRawEvent(value, undefined), createdAt)];
  }

  const nativeType = readString(value, "type");
  const raw = createClaudeRawEvent(value, nativeType);
  const events: RunEvent[] = [createRuntimeEvent(runId, raw, createdAt)];
  const sessionId = readClaudeSessionId(value);

  if (options.emitRuntimeSessionStarted === true && sessionId !== undefined) {
    events.push({
      type: "runtime.session.started",
      runId,
      runtimeKind: "claude-code",
      sessionId,
      createdAt,
    });
  }

  if (nativeType === "assistant" && isRecord(value.message)) {
    const message = value.message;
    const content = Array.isArray(message.content) ? message.content : [];

    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }

      if (item.type === "text" && typeof item.text === "string" && item.text.length > 0) {
        events.push({
          type: "message.delta",
          runId,
          content: item.text,
          raw,
          createdAt,
        });
      }

      if (item.type === "tool_use" && typeof item.id === "string") {
        events.push({
          type: "tool.call.started",
          runId,
          toolCallId: item.id,
          name: typeof item.name === "string" ? item.name : "tool_use",
          input: item.input,
          raw,
          createdAt,
        });
      }
    }
  }

  if (nativeType === "user" && isRecord(value.message)) {
    const message = value.message;
    const content = Array.isArray(message.content) ? message.content : [];

    for (const item of content) {
      if (!isRecord(item) || item.type !== "tool_result" || typeof item.tool_use_id !== "string") {
        continue;
      }

      const status = item.is_error === true ? "failed" : "succeeded";
      const output = item.content;

      events.push({
        type: "tool.call.completed",
        runId,
        toolCallId: item.tool_use_id,
        status,
        ...(status === "failed" && typeof output === "string" ? { error: output } : {}),
        output,
        raw,
        createdAt,
      });
    }
  }

  return events;
}

function createClaudeAppendSystemPrompt(
  agentInstructions: string | undefined,
  agentHubToolInstructions: string | undefined,
): string | undefined {
  const parts = [
    agentInstructions?.trim(),
    agentHubToolInstructions?.trim(),
  ].filter((value): value is string => value !== undefined && value.length > 0);

  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function createClaudeAgentHubToolInstructions(
  enabledTools: AgentHubMcpToolName[] | undefined,
): string | undefined {
  if (enabledTools === undefined || enabledTools.length === 0) {
    return undefined;
  }

  const mappings = enabledTools.map((toolName) =>
    `- ${toolName} -> mcp__agenthub__${toolName}`
  );

  return [
    "AgentHub MCP tool names in Claude Code are namespaced.",
    "Whenever prior instructions mention a bare AgentHub tool name, call the corresponding Claude tool name instead:",
    ...mappings,
    "Do not call the bare tool names directly in Claude Code.",
  ].join("\n");
}

function createClaudeAllowedToolsArg(
  enabledTools: AgentHubMcpToolName[] | undefined,
): string[] {
  if (enabledTools === undefined || enabledTools.length === 0) {
    return [];
  }

  return [
    "--allowedTools",
    enabledTools.map((toolName) => `mcp__agenthub__${toolName}`).join(","),
  ];
}

async function runHiddenClaudePrompt(input: {
  agentInstructions?: string;
  executablePath: string;
  prompt: string;
  spawnProcess: SpawnRuntimeProcess;
  workspacePath: string;
}): Promise<string> {
  const safeRunId = "memory_compaction";
  const tempFiles = new RuntimeTempFiles(`agenthub-claude-${safeRunId}-`);
  const appendSystemPrompt = createClaudeAppendSystemPrompt(
    input.agentInstructions,
    undefined,
  );
  const childProcess = input.spawnProcess(input.executablePath, [
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "bypassPermissions",
    ...(appendSystemPrompt === undefined
      ? []
      : [
          "--append-system-prompt-file",
          tempFiles.write("append-system-prompt.txt", appendSystemPrompt),
        ]),
    input.prompt,
  ], {
    ...createRuntimeSpawnOptions({
      cwd: input.workspacePath,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  });
  const stdout = new LineDecoder();
  const stderr = new LineDecoder();
  const output: string[] = [];
  const errors: string[] = [];

  childProcess.stdout.on("data", (chunk) => {
    for (const line of stdout.push(chunk)) {
      const parsed = parseJsonLine(line);

      if (!parsed.ok) {
        output.push(parsed.line);
        continue;
      }

      for (const event of mapClaudeJsonEvents(parsed.value, "memory_compaction")) {
        if (event.type === "message.delta") {
          output.push(event.content);
        }
      }
    }
  });
  childProcess.stderr.on("data", (chunk) => errors.push(...stderr.push(chunk)));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    childProcess.once("error", reject);
    childProcess.once("close", resolve);
  });

  const lastStdout = stdout.flush();
  const lastStderr = stderr.flush();
  tempFiles.cleanup();

  if (lastStdout !== undefined) {
    output.push(lastStdout);
  }

  if (lastStderr !== undefined) {
    errors.push(lastStderr);
  }

  if (exitCode !== 0) {
    throw new Error(
      errors.join("\n") || `Claude Code compaction exited with code ${exitCode}`,
    );
  }

  return output.join("\n").trim();
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly runtimeKind = "claude-code" as const;

  #dailyMemoryRefreshIntervalMs: number;
  #dailyMemoryRefreshTranscriptMaxBytes: number;
  #executablePath: string;
  #mcpRelay: AgentHubMcpRelayLike | undefined;
  #mcpServerCommand: AgentHubMcpServerCommand;
  #spawnProcess: SpawnRuntimeProcess;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#dailyMemoryRefreshIntervalMs =
      options.dailyMemoryRefreshIntervalMs ?? 4 * 60 * 60 * 1000;
    this.#dailyMemoryRefreshTranscriptMaxBytes =
      options.dailyMemoryRefreshTranscriptMaxBytes ?? 60 * 1024;
    this.#executablePath = options.executablePath ?? "claude";
    this.#mcpRelay = options.mcpRelay;
    this.#mcpServerCommand =
      options.mcpServerCommand ?? createAgentHubMcpServerCommand();
    this.#spawnProcess =
      options.spawnProcess ?? createRuntimeProcessSpawner(spawnChildProcess);
  }

  async detect(): Promise<DaemonRuntime> {
    const childProcess = this.#spawnProcess(this.#executablePath, ["--version"], {
      ...createRuntimeSpawnOptions({
        stdio: ["ignore", "pipe", "pipe"],
      }),
    });
    const stdout = new LineDecoder();
    const stderr = new LineDecoder();
    const output: string[] = [];
    const errors: string[] = [];

    childProcess.stdout.on("data", (chunk) => output.push(...stdout.push(chunk)));
    childProcess.stderr.on("data", (chunk) => errors.push(...stderr.push(chunk)));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      childProcess.once("error", reject);
      childProcess.once("close", resolve);
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
        `Claude Code runtime detection failed: ${errors.join("\n") || exitCode}`,
      );
    }

    return {
      daemonDeviceId: "",
      runtimeKind: "claude-code",
      runtimeVersion: output.join("\n").trim() || undefined,
      executablePath: this.#executablePath,
      capabilities: [
        { name: "stream-json", enabled: true },
        { name: "print-mode", enabled: true },
        { name: "agenthub-mcp", enabled: this.#mcpRelay !== undefined },
        { name: "resume-session", enabled: true },
      ],
      status: "ready",
      lastSeenAt: nowIsoDateTime(),
    };
  }

  run(input: AgentRunInput): AsyncIterable<RunEvent> {
    const queue = new AsyncEventQueue<RunEvent>();
    const safeRunId = input.run.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const tempFiles = new RuntimeTempFiles(`agenthub-claude-${safeRunId}-`);
    const mcpSession = createAgentHubMcpSession({
      eventSink: queue,
      relay: this.#mcpRelay,
      runInput: input,
    });
    const appendSystemPrompt = createClaudeAppendSystemPrompt(
      input.agentInstructions,
      createClaudeAgentHubToolInstructions(input.agentHubMcpTools),
    );
    const appendSystemPromptArgs = appendSystemPrompt === undefined
      ? []
      : [
          "--append-system-prompt-file",
          tempFiles.write("append-system-prompt.txt", appendSystemPrompt),
        ];
    const mcpConfigArgs = mcpSession === undefined
      ? []
      : [
          "--mcp-config",
          tempFiles.write(
            "mcp-config.json",
            createClaudeMcpConfig({
              command: this.#mcpServerCommand,
              session: mcpSession,
            }),
          ),
          "--strict-mcp-config",
        ];
    const resumeSessionId =
      input.run.dispatchMode === "resume"
        ? input.run.runtimeSessionId
        : undefined;
    const createArgs = (prompt: string): string[] => [
      "-p",
      ...(resumeSessionId === undefined ? [] : ["--resume", resumeSessionId]),
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      ...(mcpSession === undefined
        ? []
        : createClaudeAllowedToolsArg(input.agentHubMcpTools)),
      ...appendSystemPromptArgs,
      ...mcpConfigArgs,
      prompt,
    ];
    let completed = false;
    let aborted = false;
    let abortStatus: Extract<RunEvent, { type: "run.completed" }>["status"] =
      "cancelled";
    let runtimeSessionStarted = false;
    let childProcess: ReturnType<SpawnRuntimeProcess> | undefined;

    const complete = (
      status: Extract<RunEvent, { type: "run.completed" }>["status"],
      error?: string,
    ) => {
      if (completed) {
        return;
      }

      completed = true;
      mcpSession?.close();
      tempFiles.cleanup();
      queue.push({
        type: "run.completed",
        runId: input.run.id,
        status,
        error,
        createdAt: nowIsoDateTime(),
      });
      queue.end();
    };

    input.abortSignal?.addEventListener(
      "abort",
      () => {
        aborted = true;
        abortStatus = mapAbortReasonToRunStatus(input.abortSignal?.reason);
        if (childProcess === undefined) {
          complete(abortStatus);
          return;
        }

        childProcess.kill("SIGTERM");
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
      let runPrompt = input.prompt;

      try {
        runPrompt = await buildPromptWithRuntimeMemory({
          agentInstructions: input.agentInstructions,
          basePrompt: input.prompt,
          contextCompression: input.contextCompression,
          eventSink: queue,
          hiddenPrompt: (hiddenInput) => runHiddenClaudePrompt({
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
          runtimeKind: "claude-code",
          workspacePath: input.memoryWorkspacePath ?? input.workspacePath,
        });
      } catch (error) {
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

      if (completed) {
        return;
      }

      childProcess = this.#spawnProcess(this.#executablePath, createArgs(runPrompt), {
        ...createRuntimeSpawnOptions({
          cwd: input.workspacePath,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      });

      attachJsonLineRuntimeOutput({
        eventSink: queue,
        mapJsonValue: (value) => {
          const sessionId = readClaudeSessionId(value);
          const emitRuntimeSessionStarted =
            !runtimeSessionStarted && sessionId !== undefined;

          if (emitRuntimeSessionStarted) {
            runtimeSessionStarted = true;
          }

          return mapClaudeJsonEvents(value, input.run.id, {
            emitRuntimeSessionStarted,
          });
        },
        process: childProcess,
        runId: input.run.id,
      });

      childProcess.once("error", (error) => {
        complete("failed", error instanceof Error ? error.message : String(error));
      });
      childProcess.once("close", (exitCode) => {
        if (aborted) {
          complete(abortStatus);
          return;
        }

        complete(
          exitCode === 0 ? "succeeded" : "failed",
          exitCode === 0 ? undefined : `Claude Code exited with code ${exitCode}`,
        );
      });

      if (input.abortSignal?.aborted === true) {
        aborted = true;
        abortStatus = mapAbortReasonToRunStatus(input.abortSignal.reason);
        childProcess.kill("SIGTERM");
      }
    })();

    return queue;
  }

  async cancel(): Promise<void> {
    return Promise.resolve();
  }
}

export function createClaudeCodeAdapter(
  options?: ClaudeCodeAdapterOptions,
): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter(options);
}
