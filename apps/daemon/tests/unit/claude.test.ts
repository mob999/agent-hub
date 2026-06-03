import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

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
  options: SpawnOptionsWithoutStdio;
  process: MockClaudeProcess;
}

type SpawnClaudeProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
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

describe("ClaudeCodeAdapter", () => {
  it("spawns claude print mode with stream-json output and bypass permissions", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.close(0);
    await eventsPromise;

    expect(calls[0].command).toBe("claude");
    expect(calls[0].args).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
    ]);
    expect(calls[0].process.stdinText).toBe("hello claude");
    expect(calls[0].options).toMatchObject({
      cwd: "/tmp/agent-workspace",
      stdio: "pipe",
    });
  });

  it("writes the prompt to stdin and closes stdin", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    expect(calls[0].process.stdinText).toBe("hello claude");
    expect(calls[0].process.stdin.writableEnded).toBe(true);

    calls[0].process.close(0);
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

    expect(calls[0].args).toContain("--mcp-config");
    expect(calls[0].args).toContain("--strict-mcp-config");
    expect(calls[0].args).toContain("--allowedTools");
    expect(calls[0].args).toContain("mcp__agenthub__send_message");
    const mcpConfigPath = calls[0].args[calls[0].args.indexOf("--mcp-config") + 1];
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
    expect(calls[0].args).toContain("--append-system-prompt-file");
    const appendSystemPromptPath = calls[0].args[
      calls[0].args.indexOf("--append-system-prompt-file") + 1
    ];
    expect(readFileSync(appendSystemPromptPath, "utf8")).toBe(
      [
        "AgentHub MCP tool names in Claude Code are namespaced.",
        "Whenever prior instructions mention a bare AgentHub tool name, call the corresponding Claude tool name instead:",
        "- send_message -> mcp__agenthub__send_message",
        "Do not call the bare tool names directly in Claude Code.",
      ].join("\n"),
    );
    expect(calls[0].process.stdinText).toBe("hello claude");

    calls[0].process.close(0);
    await eventsPromise;
    expect(handles[0].close).toHaveBeenCalledOnce();
  });

  it("stores raw Claude stream-json events and emits normalized message and tool call events", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session_1",
      })}\n`,
    );
    calls[0].process.stdout.write(
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
    calls[0].process.stdout.write(
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
    calls[0].process.stdout.write(
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
    calls[0].process.close(0);

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
      status: "ready",
    });
    expect(calls[0].process.stdin.writableEnded).toBe(true);
  });
});
