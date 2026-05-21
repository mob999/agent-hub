import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

import type { AgentRunInput } from "@agent-hub/core/runtime";
import { describe, expect, it } from "vitest";

import { CodexAdapter, type SpawnCodexProcess } from "../../src/runtime";

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

  it("maps stdout JSONL into run events", async () => {
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const eventsPromise = collectEvents(adapter.run(createRunInput()));

    calls[0].process.stdout.write(
      `${JSON.stringify({ type: "message.delta", delta: "hello" })}\n`,
    );
    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "tool_call_started",
        id: "tool_1",
        name: "Read",
        input: { path: "README.md" },
      })}\n`,
    );
    calls[0].process.stdout.write(
      `${JSON.stringify({
        type: "tool_call_completed",
        id: "tool_1",
        output: { ok: true },
      })}\n`,
    );
    calls[0].process.close(0);

    const events = await eventsPromise;

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "message.delta",
          runId: "run_1",
          content: "hello",
        }),
        expect.objectContaining({
          type: "tool.call.started",
          runId: "run_1",
          toolCallId: "tool_1",
          name: "Read",
        }),
        expect.objectContaining({
          type: "tool.call.completed",
          runId: "run_1",
          toolCallId: "tool_1",
          status: "succeeded",
        }),
        expect.objectContaining({
          type: "run.completed",
          status: "succeeded",
        }),
      ]),
    );
  });

  it("maps real Codex agent message item events", async () => {
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
          type: "message.delta",
          runId: "run_1",
          content: "hello-agenthub",
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
