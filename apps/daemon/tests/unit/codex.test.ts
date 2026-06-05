import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptions } from "node:child_process";

import type { AgentRunInput } from "@agent-hub/core/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  CodexAdapter,
  createAgentHubMcpServerCommand,
  type AgentHubMcpRelayLike,
  type SpawnCodexProcess,
} from "../../src/runtime";

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
  options: SpawnOptions;
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
  await waitFor(() => calls.length > 0, "Expected Codex process to spawn.");

  return calls[0];
}

function promptArg(call: SpawnCall): string {
  return call.args.at(-1) ?? "";
}

describe("CodexAdapter", () => {
  it("builds the development MCP server command with a loadable tsx loader URL", () => {
    const command = createAgentHubMcpServerCommand();

    expect(command.command).toBe(process.execPath);
    expect(command.args[0]).toBe("--import");
    expect(command.args[1]).toContain("tsx");
    expect(command.args[1]).not.toBe("tsx");
    expect(command.args[1]).toMatch(/^file:\/\//);
    expect(command.args[2]).toMatch(/stdio-server\.ts$|stdio-server\.js$/);
  });

  it("spawns codex exec with json and ephemeral mode", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));
    const call = await waitForSpawn(calls);

    call.process.close(0);
    await eventsPromise;

    expect(call.command).toBe("codex");
    expect(call.args).toEqual([
      "exec",
      "--json",
      "--cd",
      "/tmp/agent-workspace",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      expect.stringContaining("hello codex"),
    ]);
    expect(call.options).toMatchObject({
      cwd: "/tmp/agent-workspace",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nhello codex$/);
  });

  it("spawns codex exec resume when a runtime session is available", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({
        run: {
          ...createRunInput().run,
          dispatchMode: "resume",
          runtimeSessionId: "thread_123",
        },
      })),
    );
    const call = await waitForSpawn(calls);

    call.process.close(0);
    await eventsPromise;

    expect(call.args).toEqual([
      "exec",
      "resume",
      "thread_123",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      expect.stringContaining("hello codex"),
    ]);
    expect(call.options).toMatchObject({
      cwd: "/tmp/agent-workspace",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nhello codex$/);
  });

  it("passes prompt as an argument without stdin", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ prompt: "use this context" })),
    );
    const call = await waitForSpawn(calls);

    call.process.close(0);
    await eventsPromise;

    expect(call.process.stdinText).toBe("");
    expect(call.options).toMatchObject({
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nuse this context$/);
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
    const call = await waitForSpawn(calls);

    call.process.close(0);
    await eventsPromise;

    expect(call.args).toContain("-c");
    expect(call.args).toContain(
      `developer_instructions=${JSON.stringify(agentInstructions)}`,
    );
    expect(call.process.stdinText).toBe("");
    expect(promptArg(call)).toContain("<agenthub_memory>");
    expect(promptArg(call)).toMatch(/\n\nship the page$/);
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
    const call = await waitForSpawn(calls);

    expect(call.args).toEqual(
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
    call.process.close(0);

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
    const call = await waitForSpawn(calls);

    call.process.close(0);
    await eventsPromise;

    expect(call.args).toContain(
      "mcp_servers.agenthub.args=['--import','tsx','E:\\agent-hub\\apps\\daemon\\src\\mcp\\stdio-server.ts']",
    );
  });

  it("relays create_task calls through the MCP session", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const { relay, sessions } = createMcpRelayMock();
    const adapter = new CodexAdapter({
      mcpRelay: relay,
      spawnProcess,
    });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({ agentHubMcpTools: ["create_task", "send_message"] })),
    );
    const call = await waitForSpawn(calls);

    expect(call.args).toContain(
      "mcp_servers.agenthub.env.AGENTHUB_MCP_TOOLS='create_task,send_message'",
    );

    const result = await sessions[0].onToolCall({
      runId: "run_1",
      toolCallId: "tool_2",
      name: "create_task",
      input: {
        goalId: "goal_1",
        title: "Write tests",
        assigneeAgentId: "agent_2",
        dependsOnTaskIndexes: [0],
      },
      createdAt: "2026-05-21T00:00:01.000Z",
    });
    call.process.close(0);

    expect(result).toEqual({ accepted: true });
    await expect(eventsPromise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agenthub.tool.call",
          name: "create_task",
          input: expect.objectContaining({
            title: "Write tests",
            goalId: "goal_1",
            dependsOnTaskIndexes: [0],
          }),
        }),
      ]),
    );
  });

  it("returns current group goals through the MCP session", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const { relay, sessions } = createMcpRelayMock();
    const adapter = new CodexAdapter({
      mcpRelay: relay,
      spawnProcess,
    });
    const eventsPromise = collectEvents(
      adapter.run(createRunInput({
        agentHubMcpTools: ["list_goals"],
        agentHubMcpGoals: [
          {
            id: "goal_1",
            ownerUserId: "user_1",
            conversationId: "conversation_1",
            orchestratorAgentId: "agent_1",
            initialRunId: "run_1",
            title: "Research market",
            status: "active",
            tasks: [
              {
                id: "task_1",
                goalId: "goal_1",
                index: 0,
                title: "Research market",
                assigneeAgentId: "agent_2",
                status: "running",
                createdAt: "2026-05-21T00:00:00.000Z",
                updatedAt: "2026-05-21T00:00:00.000Z",
              },
            ],
            createdAt: "2026-05-21T00:00:00.000Z",
            updatedAt: "2026-05-21T00:00:00.000Z",
          },
        ],
      })),
    );
    const call = await waitForSpawn(calls);

    expect(call.args).toContain(
      "mcp_servers.agenthub.env.AGENTHUB_MCP_TOOLS='list_goals'",
    );

    const firstResult = await sessions[0].onToolCall({
      runId: "run_1",
      toolCallId: "tool_3",
      name: "list_goals",
      input: {},
      createdAt: "2026-05-21T00:00:01.000Z",
    });
    const secondResult = await sessions[0].onToolCall({
      runId: "run_1",
      toolCallId: "tool_4",
      name: "list_goals",
      input: { status: "completed" },
      createdAt: "2026-05-21T00:00:03.000Z",
    });
    call.process.close(0);

    expect(firstResult).toMatchObject({
      accepted: true,
      goals: [
        {
          id: "goal_1",
          title: "Research market",
          status: "active",
        },
      ],
    });
    expect(secondResult).toEqual({
      accepted: true,
      goals: [],
    });
    await eventsPromise;
  });

  it("stores raw Codex JSONL and emits normalized tool call events", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));
    const call = await waitForSpawn(calls);

    call.process.stdout.write(
      `${JSON.stringify({ type: "thread.started", thread_id: "thread_1" })}\n`,
    );
    call.process.stdout.write(
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
    call.process.stdout.write(
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
    call.process.stdout.write(
      `${JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 10,
          output_tokens: 3,
        },
      })}\n`,
    );
    call.process.close(0);

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
          type: "runtime.session.started",
          runId: "run_1",
          runtimeKind: "codex",
          sessionId: "thread_1",
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
    const call = await waitForSpawn(calls);

    call.process.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: "hello-agenthub",
        },
      })}\n`,
    );
    call.process.close(0);

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
    const call = await waitForSpawn(calls);

    call.process.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_0",
          type: "agent_message",
          text: jsonToolCall,
        },
      })}\n`,
    );
    call.process.close(0);

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
    const call = await waitForSpawn(calls);

    call.process.stdout.write("not-json\n");
    call.process.close(0);

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
    const call = await waitForSpawn(calls);

    call.process.stderr.write("warning\n");
    call.process.close(0);

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
    const call = await waitForSpawn(calls);

    call.process.close(2);

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
    expect(calls).toHaveLength(0);
  });

  it("kills codex and completes interrupted on preempt abort", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const abortController = new AbortController();
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
});
