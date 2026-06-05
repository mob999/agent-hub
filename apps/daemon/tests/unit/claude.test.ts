import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import type { SpawnOptions } from "node:child_process";

import type { AgentRunInput } from "@agent-hub/core/runtime";
import { describe, expect, it, vi } from "vitest";

import { ClaudeCodeAdapter, type AgentHubMcpRelayLike } from "../../src/runtime";

class MockClaudeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdinChunks: Buffer[] = [];
  killedWith: NodeJS.Signals | string | undefined;

  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      this.stdinChunks.push(Buffer.from(chunk));
    });
  }

  get stdinText(): string {
    return Buffer.concat(this.stdinChunks).toString("utf8");
  }

  kill(signal?: NodeJS.Signals | string): boolean {
    this.killedWith = signal;
    setImmediate(() => this.emit("close", null));
    return true;
  }

  close(exitCode: number | null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit("close", exitCode));
  }
}

interface SpawnCall {
  args: string[];
  command: string;
  options: SpawnOptions;
  process: MockClaudeProcess;
}

type SpawnClaudeProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => MockClaudeProcess;

function createSpawnMock() {
  const calls: SpawnCall[] = [];
  const spawnProcess: SpawnClaudeProcess = (command, args, options) => {
    const process = new MockClaudeProcess();
    calls.push({ args, command, options, process });
    return process;
  };

  return { calls, spawnProcess };
}

function createMcpRelayMock() {
  const sessions: Array<Parameters<AgentHubMcpRelayLike["createSession"]>[0]> = [];
  const handles: Array<ReturnType<AgentHubMcpRelayLike["createSession"]>> = [];
  const relay: AgentHubMcpRelayLike = {
    createSession: (input) => {
      const handle = {
        enabledTools: input.enabledTools,
        relayUrl: "http://127.0.0.1:4317",
        token: `session_${sessions.length + 1}`,
        close: vi.fn(),
      };

      sessions.push(input);
      handles.push(handle);

      return handle;
    },
  };

  return { handles, relay, sessions };
}

function createRunInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    run: {
      id: "run_1",
      agentId: "agent_1",
      daemonDeviceId: "device_1",
      status: "running",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    },
    prompt: "hello claude",
    workspacePath: "/tmp/agent-workspace",
    runtime: {
      runtimeKind: "claude-code",
      capabilities: [],
      updatedAt: "2026-05-21T00:00:00.000Z",
    },
    ...overrides,
  };
}

async function collectEvents(
  events: AsyncIterable<unknown>,
): Promise<unknown[]> {
  const collected: unknown[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(message);
}

async function waitForSpawn(calls: SpawnCall[]): Promise<SpawnCall> {
  await waitFor(() => calls.length > 0, "Expected Claude process to spawn.");

  return calls[0];
}

function promptArg(call: SpawnCall): string {
  return call.args.at(-1) ?? "";
}

describe("ClaudeCodeAdapter", () => {
  it("spawns claude print mode with stream-json output and bypass permissions", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));
    const call = await waitForSpawn(calls);

    expect(call.command).toBe("claude");
    expect(call.args).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      expect.stringContaining("hello claude"),
    ]);
    expect(call.options).toMatchObject({
      cwd: "/tmp/agent-workspace",
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(call.process.stdinText).toBe("");
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nhello claude$/);
    call.process.close(0);
    await eventsPromise;
  });

  it("passes the prompt as an argument without stdin", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));
    const call = await waitForSpawn(calls);

    expect(call.process.stdinText).toBe("");
    expect(call.options).toMatchObject({
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nhello claude$/);

    call.process.close(0);
    await eventsPromise;
  });

  it("resumes an existing Claude session when the run dispatch mode is resume", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({
        run: {
          id: "run_2",
          agentId: "agent_1",
          daemonDeviceId: "device_1",
          status: "running",
          runtimeSessionId: "claude-session-1",
          dispatchMode: "resume",
          createdAt: "2026-05-21T00:00:00.000Z",
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      })),
    );
    const call = await waitForSpawn(calls);

    expect(call.args).toEqual([
      "-p",
      "--resume",
      "claude-session-1",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      expect.stringContaining("hello claude"),
    ]);
    expect(call.process.stdinText).toBe("");
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nhello claude$/);

    call.process.close(0);
    await eventsPromise;
  });

  it("injects AgentHub MCP config through Claude mcp-config", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const { handles, relay } = createMcpRelayMock();
    const adapter = new ClaudeCodeAdapter({
      mcpRelay: relay,
      mcpServerCommand: {
        command: "node",
        args: ["agenthub-mcp.js"],
        cwd: "/repo",
      },
      spawnProcess,
    });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ agentHubMcpTools: ["send_message"] })),
    );
    const call = await waitForSpawn(calls);

    expect(call.args).toContain("--mcp-config");
    expect(call.args).toContain("--strict-mcp-config");
    expect(call.args).toContain("--allowedTools");
    expect(call.args).toContain("mcp__agenthub__send_message");
    const mcpConfigPath = call.args[call.args.indexOf("--mcp-config") + 1];
    expect(JSON.parse(readFileSync(mcpConfigPath, "utf8"))).toEqual({
      mcpServers: {
        agenthub: {
          type: "stdio",
          alwaysLoad: true,
          command: "node",
          args: ["agenthub-mcp.js"],
          cwd: "/repo",
          env: {
            AGENTHUB_MCP_RELAY_URL: "http://127.0.0.1:4317",
            AGENTHUB_MCP_SESSION_TOKEN: "session_1",
            AGENTHUB_MCP_TOOLS: "send_message",
          },
        },
      },
    });
    expect(call.args).toContain("--append-system-prompt-file");
    const appendSystemPromptPath = call.args[
      call.args.indexOf("--append-system-prompt-file") + 1
    ];
    expect(readFileSync(appendSystemPromptPath, "utf8")).toBe(
      [
        "AgentHub MCP tool names in Claude Code are namespaced.",
        "Whenever prior instructions mention a bare AgentHub tool name, call the corresponding Claude tool name instead:",
        "- send_message -> mcp__agenthub__send_message",
        "Do not call the bare tool names directly in Claude Code.",
      ].join("\n"),
    );
    expect(call.process.stdinText).toBe("");
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nhello claude$/);

    call.process.close(0);
    await eventsPromise;
    expect(handles[0].close).toHaveBeenCalledOnce();
  });

  it("stores raw Claude stream-json events and emits normalized message and tool call events", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));
    const call = await waitForSpawn(calls);

    call.process.stdout.write(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session_1",
      })}\n`,
    );
    call.process.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: {
          id: "message_1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "hello-agenthub" }],
        },
      })}\n`,
    );
    call.process.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: {
          id: "message_2",
          type: "message",
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "tool_1",
            name: "Read",
            input: { file_path: "/tmp/agent-workspace/README.md" },
          }],
        },
      })}\n`,
    );
    call.process.stdout.write(
      `${JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool_1",
            content: "ok",
          }],
        },
      })}\n`,
    );
    call.process.close(0);

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runtime.event",
          raw: expect.objectContaining({
            runtimeKind: "claude-code",
            nativeType: "system",
          }),
        }),
        expect.objectContaining({
          type: "runtime.session.started",
          runtimeKind: "claude-code",
          sessionId: "session_1",
        }),
        expect.objectContaining({
          type: "message.delta",
          content: "hello-agenthub",
          raw: expect.objectContaining({
            runtimeKind: "claude-code",
            nativeType: "assistant",
          }),
        }),
        expect.objectContaining({
          type: "tool.call.started",
          toolCallId: "tool_1",
          name: "Read",
          input: { file_path: "/tmp/agent-workspace/README.md" },
        }),
        expect.objectContaining({
          type: "tool.call.completed",
          toolCallId: "tool_1",
          status: "succeeded",
          output: "ok",
        }),
        expect.objectContaining({
          type: "run.completed",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("emits a single runtime session event from the first Claude session id", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));
    const call = await waitForSpawn(calls);

    call.process.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        session_id: "session_from_assistant",
        message: {
          id: "message_1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      })}\n`,
    );
    call.process.stdout.write(
      `${JSON.stringify({
        type: "result",
        session_id: "session_from_result",
        result: "hello",
      })}\n`,
    );
    call.process.close(0);

    const events = await eventsPromise;
    const sessionEvents = events.filter((event) =>
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "runtime.session.started"
    );

    expect(sessionEvents).toEqual([
      expect.objectContaining({
        sessionId: "session_from_assistant",
      }),
    ]);
  });

  it("completes as interrupted when Claude is aborted by run preemption", async () => {
    const abortController = new AbortController();
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ abortSignal: abortController.signal })),
    );

    abortController.abort("interrupted");

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run.completed",
          status: "interrupted",
        }),
      ]),
    );
    expect(calls).toHaveLength(0);
  });

  it("completes as cancelled when Claude is aborted without preemption", async () => {
    const abortController = new AbortController();
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ abortSignal: abortController.signal })),
    );

    abortController.abort("cancelled");

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run.completed",
          status: "cancelled",
        }),
      ]),
    );
    expect(calls).toHaveLength(0);
  });

  it("detects Claude through --version", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({
      executablePath: "claude-cc-deepseek",
      spawnProcess,
    });
    const detectPromise = adapter.detect();

    calls[0].process.stdout.write("2.1.132 (Claude Code)\n");
    calls[0].process.close(0);

    await expect(detectPromise).resolves.toMatchObject({
      runtimeKind: "claude-code",
      executablePath: "claude-cc-deepseek",
      runtimeVersion: "2.1.132 (Claude Code)",
      capabilities: expect.arrayContaining([
        { name: "resume-session", enabled: true },
      ]),
      status: "ready",
    });
    expect(calls[0].process.stdinText).toBe("");
    expect(calls[0].options).toMatchObject({
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
});
