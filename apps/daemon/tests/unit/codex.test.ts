import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

import type { AgentRunInput } from "@agent-hub/core/runtime";
import { describe, expect, it, vi } from "vitest";

import { CodexAdapter, type AgentHubMcpRelayLike, type SpawnCodexProcess } from "../../src/runtime";

class MockCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  killedWith: NodeJS.Signals | string | undefined;
  stdinText = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      this.stdinText += chunk.toString();
    });
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
  process: MockCodexProcess;
}

function createSpawnMock() {
  const calls: SpawnCall[] = [];
  const spawnProcess: SpawnCodexProcess = (command, args, options) => {
    const process = new MockCodexProcess();
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
        relayUrl: "http://127.0.0.1:4173",
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
    prompt: "hello codex",
    workspacePath: "/tmp/agent-workspace",
    runtime: {
      runtimeKind: "codex",
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

describe("CodexAdapter", () => {
  it("spawns codex exec with json and ephemeral mode", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));
    const call = calls[0];

    call.process.close(0);
    await eventsPromise;

    expect(call.command).toBe("codex");
    expect(call.args).toEqual([
      "exec",
      "--json",
      "--ephemeral",
      "--cd",
      "/tmp/agent-workspace",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-",
    ]);
    expect(call.options).toMatchObject({
      cwd: "/tmp/agent-workspace",
      stdio: "pipe",
    });
  });

  it("writes prompt to stdin", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ prompt: "use this context" })),
    );

    calls[0].process.close(0);
    await eventsPromise;

    expect(calls[0].process.stdinText).toBe("use this context");
  });

  it("passes agent instructions as Codex developer instructions", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const agentInstructions = [
      "You are a focused frontend agent.",
      "Prefer accessible UI and quote \"exact\" constraints.",
    ].join("\n");
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({
        prompt: "ship the page",
        agentInstructions,
      })),
    );

    calls[0].process.close(0);
    await eventsPromise;

    expect(calls[0].args).toContain("-c");
    expect(calls[0].args).toContain(
      `developer_instructions=${JSON.stringify(agentInstructions)}`,
    );
    expect(calls[0].process.stdinText).toBe("ship the page");
  });

  it("injects a per-run AgentHub MCP stdio server and emits MCP tool events", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const { handles, relay, sessions } = createMcpRelayMock();
    const adapter = new CodexAdapter({
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

    expect(calls[0].args).toEqual(
      expect.arrayContaining([
        "-c",
        "mcp_servers.agenthub.command='node'",
        "mcp_servers.agenthub.args=['agenthub-mcp.js']",
        "mcp_servers.agenthub.env.AGENTHUB_MCP_RELAY_URL='http://127.0.0.1:4173'",
        "mcp_servers.agenthub.env.AGENTHUB_MCP_SESSION_TOKEN='session_1'",
        "mcp_servers.agenthub.env.AGENTHUB_MCP_TOOLS='send_message'",
        "mcp_servers.agenthub.cwd='/repo'",
      ]),
    );

    await sessions[0].onToolCall({
      runId: "run_1",
      toolCallId: "tool_1",
      name: "send_message",
      input: { content: "I can help." },
      createdAt: "2026-05-21T00:00:01.000Z",
    });
    calls[0].process.close(0);

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agenthub.tool.call",
          runId: "run_1",
          toolCallId: "tool_1",
          name: "send_message",
          input: { content: "I can help." },
        }),
      ]),
    );
    expect(handles[0].close).toHaveBeenCalledOnce();
  });

  it("formats MCP stdio args without shell-splitting spaces", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const { relay } = createMcpRelayMock();
    const adapter = new CodexAdapter({
      mcpRelay: relay,
      mcpServerCommand: {
        command: "node",
        args: ["--import", "tsx", "E:\\agent-hub\\apps\\daemon\\src\\mcp\\stdio-server.ts"],
      },
      spawnProcess,
    });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ agentHubMcpTools: ["send_message"] })),
    );

    calls[0].process.close(0);
    await eventsPromise;

    expect(calls[0].args).toContain(
      "mcp_servers.agenthub.args=['--import','tsx','E:\\agent-hub\\apps\\daemon\\src\\mcp\\stdio-server.ts']",
    );
  });

  it("stores raw Codex JSONL and emits normalized tool call events", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.stdout.write(
      `${JSON.stringify({ type: "thread.started", thread_id: "thread_1" })}\n`,
    );
    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "item.started",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "/bin/zsh -lc ls",
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      })}\n`,
    );
    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "/bin/zsh -lc ls",
          aggregated_output: "README.md\n",
          exit_code: 0,
          status: "completed",
        },
      })}\n`,
    );
    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 10,
          output_tokens: 3,
        },
      })}\n`,
    );
    calls[0].process.close(0);

    const events = await eventsPromise;

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runtime.event",
          runId: "run_1",
          raw: expect.objectContaining({
            runtimeKind: "codex",
            nativeType: "thread.started",
            payload: expect.objectContaining({
              thread_id: "thread_1",
            }),
          }),
        }),
        expect.objectContaining({
          type: "runtime.event",
          runId: "run_1",
          raw: expect.objectContaining({
            runtimeKind: "codex",
            nativeType: "item.started",
          }),
        }),
        expect.objectContaining({
          type: "tool.call.started",
          runId: "run_1",
          toolCallId: "item_1",
          name: "command_execution",
          input: {
            command: "/bin/zsh -lc ls",
          },
          raw: expect.objectContaining({
            nativeType: "item.started",
          }),
        }),
        expect.objectContaining({
          type: "runtime.event",
          runId: "run_1",
          raw: expect.objectContaining({
            runtimeKind: "codex",
            nativeType: "item.completed",
          }),
        }),
        expect.objectContaining({
          type: "tool.call.completed",
          runId: "run_1",
          toolCallId: "item_1",
          name: "command_execution",
          status: "succeeded",
          output: expect.objectContaining({
            aggregated_output: "README.md\n",
            exit_code: 0,
          }),
          raw: expect.objectContaining({
            nativeType: "item.completed",
          }),
        }),
        expect.objectContaining({
          type: "runtime.event",
          runId: "run_1",
          raw: expect.objectContaining({
            runtimeKind: "codex",
            nativeType: "turn.completed",
            payload: expect.objectContaining({
              usage: expect.objectContaining({
                input_tokens: 10,
                output_tokens: 3,
              }),
            }),
          }),
        }),
        expect.objectContaining({
          type: "run.completed",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("stores raw Codex agent messages and emits message deltas", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "hello-agenthub",
        },
      })}\n`,
    );
    calls[0].process.close(0);

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runtime.event",
          runId: "run_1",
          raw: expect.objectContaining({
            runtimeKind: "codex",
            nativeType: "item.completed",
            payload: expect.objectContaining({
              item: expect.objectContaining({
                type: "agent_message",
                text: "hello-agenthub",
              }),
            }),
          }),
        }),
        expect.objectContaining({
          type: "message.delta",
          runId: "run_1",
          content: "hello-agenthub",
          raw: expect.objectContaining({
            runtimeKind: "codex",
            nativeType: "item.completed",
          }),
        }),
      ]),
    );
  });

  it("does not parse AgentHub JSON tool calls from agent messages", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const jsonToolCall =
      '{"type":"agenthub.tool_call","version":1,"tool":"send_message","input":{"content":"hidden"}}';
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: jsonToolCall,
        },
      })}\n`,
    );
    calls[0].process.close(0);

    const events = await eventsPromise;

    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agenthub.tool.call",
        }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message.delta",
          content: jsonToolCall,
        }),
      ]),
    );
  });

  it("falls back malformed JSONL to stdout log lines", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.stdout.write("not-json\n");
    calls[0].process.close(0);

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "log.line",
          stream: "stdout",
          line: "not-json",
        }),
      ]),
    );
  });

  it("maps stderr to log lines", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.stderr.write("warning\n");
    calls[0].process.close(0);

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "log.line",
          stream: "stderr",
          line: "warning",
        }),
      ]),
    );
  });

  it("completes failed when codex exits with non-zero code", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.close(2);

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run.completed",
          status: "failed",
          error: "Codex exited with code 2",
        }),
      ]),
    );
  });

  it("kills codex and completes cancelled on abort", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const abortController = new AbortController();
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ abortSignal: abortController.signal })),
    );

    abortController.abort();

    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run.completed",
          status: "cancelled",
        }),
      ]),
    );
    expect(calls[0].process.killedWith).toBe("SIGTERM");
  });
});
