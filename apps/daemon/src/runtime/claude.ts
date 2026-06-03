import { spawn as spawnChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentRunArtifactUpload,
  AgentAdapter,
  AgentRunInput,
} from "@agent-hub/core/runtime";
import type {
  AgentHubListGoalsToolResult,
  AgentHubMcpToolInput,
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  AgentHubUploadArtifactToolResult,
  DaemonRuntime,
  RunEvent,
  RunId,
  RuntimeRawEvent,
} from "@agent-hub/core/protocol";

import type { AgentHubMcpSessionHandle } from "../mcp/relay";
import { LineDecoder, parseJsonLine } from "./jsonl";
import {
  AsyncEventQueue,
  createLogLineEvent,
  createRuntimeEvent,
  createRuntimeSpawnOptions,
  nowIsoDateTime,
  type SpawnRuntimeProcess,
} from "./common";
import type {
  AgentHubMcpRelayLike,
  AgentHubMcpServerCommand,
} from "./codex";

export interface ClaudeCodeAdapterOptions {
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

function mapClaudeJsonEvents(value: unknown, runId: RunId): RunEvent[] {
  const createdAt = nowIsoDateTime();

  if (!isRecord(value)) {
    return [createRuntimeEvent(runId, createClaudeRawEvent(value, undefined), createdAt)];
  }

  const nativeType = readString(value, "type");
  const raw = createClaudeRawEvent(value, nativeType);
  const events: RunEvent[] = [createRuntimeEvent(runId, raw, createdAt)];

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

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly runtimeKind = "claude-code" as const;

  #executablePath: string;
  #mcpRelay: AgentHubMcpRelayLike | undefined;
  #mcpServerCommand: AgentHubMcpServerCommand | undefined;
  #spawnProcess: SpawnRuntimeProcess;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#executablePath = options.executablePath ?? "claude";
    this.#mcpRelay = options.mcpRelay;
    this.#mcpServerCommand = options.mcpServerCommand;
    this.#spawnProcess = options.spawnProcess ?? spawnChildProcess;
  }

  async detect(): Promise<DaemonRuntime> {
    const childProcess = this.#spawnProcess(this.#executablePath, ["--version"], {
      ...createRuntimeSpawnOptions({
        stdio: "pipe",
      }),
    });
    childProcess.stdin.end();
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
      ],
      status: "ready",
      lastSeenAt: nowIsoDateTime(),
    };
  }

  run(input: AgentRunInput): AsyncIterable<RunEvent> {
    const queue = new AsyncEventQueue<RunEvent>();
    const safeRunId = input.run.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    let runtimeTempDir: string | undefined;
    const writeRuntimeFile = (filename: string, content: string): string => {
      runtimeTempDir ??= mkdtempSync(join(tmpdir(), `agenthub-claude-${safeRunId}-`));
      const filePath = join(runtimeTempDir, filename);

      writeFileSync(filePath, content, "utf8");

      return filePath;
    };
    const cleanupRuntimeFiles = () => {
      if (runtimeTempDir === undefined) {
        return;
      }

      rmSync(runtimeTempDir, { force: true, recursive: true });
      runtimeTempDir = undefined;
    };
    const mcpGoals: AgentHubListGoalsToolResult["goals"] = [
      ...(input.agentHubMcpGoals ?? []),
    ];
    const mcpSession = this.#mcpRelay?.createSession({
      enabledTools: input.agentHubMcpTools ?? [],
      runId: input.run.id,
      workspacePath: input.workspacePath,
      onArtifactUpload: input.uploadArtifact,
      onToolCall: async (call) => {
        if (input.callAgentHubMcpTool !== undefined) {
          return input.callAgentHubMcpTool(call);
        }

        queue.push({
          type: "agenthub.tool.call",
          runId: call.runId,
          toolCallId: call.toolCallId,
          name: call.name,
          input: call.input,
          createdAt: call.createdAt,
        });

        if (call.name === "list_goals") {
          const status = "status" in call.input &&
            typeof call.input.status === "string"
            ? call.input.status
            : undefined;

          return {
            accepted: true,
            goals: status === undefined
              ? mcpGoals.map((goal) => ({ ...goal }))
              : mcpGoals
                  .filter((goal) => goal.status === status)
                  .map((goal) => ({ ...goal })),
          };
        }

        return { accepted: true };
      },
    });
    const appendSystemPrompt = createClaudeAppendSystemPrompt(
      input.agentInstructions,
      createClaudeAgentHubToolInstructions(input.agentHubMcpTools),
    );
    const appendSystemPromptArgs = appendSystemPrompt === undefined
      ? []
      : [
          "--append-system-prompt-file",
          writeRuntimeFile("append-system-prompt.txt", appendSystemPrompt),
        ];
    const mcpConfigArgs = mcpSession === undefined
      ? []
      : [
          "--mcp-config",
          writeRuntimeFile(
            "mcp-config.json",
            createClaudeMcpConfig({
              command: this.#mcpServerCommand ?? {
                command: process.execPath,
                args: [],
              },
              session: mcpSession,
            }),
          ),
          "--strict-mcp-config",
        ];
    const args = [
      "-p",
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
    ];
    const childProcess = this.#spawnProcess(this.#executablePath, args, {
      ...createRuntimeSpawnOptions({
        cwd: input.workspacePath,
        stdio: "pipe",
      }),
    });
    childProcess.stdin.write(input.prompt);
    childProcess.stdin.end();
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
      cleanupRuntimeFiles();
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

      for (const event of mapClaudeJsonEvents(parsed.value, input.run.id)) {
        queue.push(event);
      }
    };

    childProcess.stdout.on("data", (chunk) => {
      for (const line of stdout.push(chunk)) {
        handleStdoutLine(line);
      }
    });
    childProcess.stdout.on("end", () => {
      const line = stdout.flush();

      if (line !== undefined) {
        handleStdoutLine(line);
      }
    });

    childProcess.stderr.on("data", (chunk) => {
      for (const line of stderr.push(chunk)) {
        queue.push(createLogLineEvent(input.run.id, "stderr", line));
      }
    });
    childProcess.stderr.on("end", () => {
      const line = stderr.flush();

      if (line !== undefined) {
        queue.push(createLogLineEvent(input.run.id, "stderr", line));
      }
    });

    childProcess.once("error", (error) => {
      complete("failed", error instanceof Error ? error.message : String(error));
    });
    childProcess.once("close", (exitCode) => {
      if (aborted) {
        complete("cancelled");
        return;
      }

      complete(
        exitCode === 0 ? "succeeded" : "failed",
        exitCode === 0 ? undefined : `Claude Code exited with code ${exitCode}`,
      );
    });

    input.abortSignal?.addEventListener(
      "abort",
      () => {
        aborted = true;
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
