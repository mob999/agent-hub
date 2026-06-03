import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

import type { AgentRunInput, RunEvent } from "@agent-hub/core";
import { describe, expect, it } from "vitest";

import { appendMemory } from "../../src/memory";
import { ClaudeCodeAdapter, CodexAdapter, type SpawnCodexProcess } from "../../src/runtime";

class MockCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  stdinText = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      this.stdinText += chunk.toString();
    });
  }

  kill(): boolean {
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

function createRunInput(
  workspacePath: string,
  overrides: Partial<AgentRunInput> = {},
): AgentRunInput {
  return {
    run: {
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      daemonDeviceId: "local-dev",
      status: "running",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    prompt: "latest user request",
    workspacePath,
    runtime: {
      runtimeKind: "codex",
      capabilities: [],
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

async function collectEvents(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const collected: RunEvent[] = [];

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

describe("runtime context compression integration", () => {
  it("runs hidden compaction, writes daily memory, and injects the summary into the normal run", async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-context-compression-"));
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({ spawnProcess });
    const compressedSummary = "Compressed: user wants a durable memory feature and transcript links.";
    const compressibleText = [
      "Older message 1: long context about memory design.",
      "Older message 2: old secret context that should be summarized.",
    ].join("\n");
    const eventsPromise = collectEvents(
      adapter.run(
        createRunInput(workspacePath, {
          prompt: "this prompt will be replaced after compression",
          contextCompression: {
            compressibleText,
            promptTemplate: [
              "Before latest request.",
              "<compressed_older_context>",
              "{{compressed_context}}",
              "</compressed_older_context>",
              "Latest request: please continue.",
            ].join("\n"),
            thresholdChars: 1,
          },
        }),
      ),
    );

    try {
      await waitFor(() => calls.length === 2, "Expected hidden compaction process to spawn.");
      const normalRun = calls[0]?.process;
      const hiddenCompaction = calls[1]?.process;

      expect(normalRun).toBeDefined();
      expect(hiddenCompaction).toBeDefined();
      expect(calls[1]?.args).toContain("-c");
      expect(hiddenCompaction?.stdinText).toBe(compressibleText);

      hiddenCompaction?.stdout.write(
        `${JSON.stringify({
          type: "item.completed",
          item: {
            id: "msg_1",
            type: "agent_message",
            text: compressedSummary,
          },
        })}\n`,
      );
      hiddenCompaction?.close(0);

      await waitFor(
        () => normalRun?.stdinText.includes(compressedSummary) === true,
        "Expected normal run prompt to contain compressed context.",
      );

      expect(normalRun?.stdinText).toContain("<agenthub_memory>");
      expect(normalRun?.stdinText).toContain(compressedSummary);
      expect(normalRun?.stdinText).toContain("Latest request: please continue.");
      expect(normalRun?.stdinText).not.toContain("{{compressed_context}}");
      expect(normalRun?.stdinText).not.toContain("old secret context that should be summarized");

      normalRun?.close(0);
      const events = await eventsPromise;
      const compactedEvent = events.find(
        (event) =>
          event.type === "runtime.event" &&
          event.raw.nativeType === "memory.compacted",
      );
      const dailyMemory = await readFile(
        path.join(
          workspacePath,
          "memory",
          `${new Date().toISOString().slice(0, 10)}.md`,
        ),
        "utf8",
      );

      expect(compactedEvent).toBeDefined();
      expect(dailyMemory).toContain("Context compression");
      expect(dailyMemory).toContain(compressedSummary);
      expect(dailyMemory).toContain("[Full conversation transcript](./transcripts/");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("runs Claude hidden compaction through the same memory wrapper", async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-claude-context-compression-"));
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new ClaudeCodeAdapter({ spawnProcess });
    const compressedSummary = "Compressed by Claude: user wants task handoff and deployment links.";
    const compressibleText = [
      "Older message 1: long context about Claude adapter parity.",
      "Older message 2: old context that should be summarized.",
    ].join("\n");
    const eventsPromise = collectEvents(
      adapter.run(
        createRunInput(workspacePath, {
          prompt: "this prompt will be replaced after compression",
          runtime: {
            runtimeKind: "claude-code",
            capabilities: [],
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
          contextCompression: {
            compressibleText,
            promptTemplate: [
              "Before latest request.",
              "<compressed_older_context>",
              "{{compressed_context}}",
              "</compressed_older_context>",
              "Latest request: please continue with Claude.",
            ].join("\n"),
            thresholdChars: 1,
          },
        }),
      ),
    );

    try {
      await waitFor(() => calls.length === 2, "Expected hidden Claude compaction process to spawn.");
      const normalRun = calls[0]?.process;
      const hiddenCompaction = calls[1]?.process;

      expect(normalRun).toBeDefined();
      expect(hiddenCompaction).toBeDefined();
      expect(calls[1]?.args).toContain("--append-system-prompt-file");
      expect(hiddenCompaction?.stdinText).toBe(compressibleText);

      hiddenCompaction?.stdout.write(
        `${JSON.stringify({
          type: "assistant",
          message: {
            id: "message_1",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: compressedSummary }],
          },
        })}\n`,
      );
      hiddenCompaction?.close(0);

      await waitFor(
        () => normalRun?.stdinText.includes(compressedSummary) === true,
        "Expected normal Claude run prompt to contain compressed context.",
      );

      expect(normalRun?.stdinText).toContain("<agenthub_memory>");
      expect(normalRun?.stdinText).toContain(compressedSummary);
      expect(normalRun?.stdinText).toContain("Latest request: please continue with Claude.");
      expect(normalRun?.stdinText).not.toContain("{{compressed_context}}");
      expect(normalRun?.stdinText).not.toContain("old context that should be summarized");

      normalRun?.close(0);
      const events = await eventsPromise;
      const compactedEvent = events.find(
        (event) =>
          event.type === "runtime.event" &&
          event.raw.nativeType === "memory.compacted",
      );
      const dailyMemory = await readFile(
        path.join(
          workspacePath,
          "memory",
          `${new Date().toISOString().slice(0, 10)}.md`,
        ),
        "utf8",
      );

      expect(compactedEvent).toBeDefined();
      expect(dailyMemory).toContain("Context compression");
      expect(dailyMemory).toContain(compressedSummary);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("runs a hidden periodic daily memory refresh when transcript exists below compression threshold", async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-periodic-memory-"));
    const { calls, spawnProcess } = createSpawnMock();
    const adapter = new CodexAdapter({
      dailyMemoryRefreshIntervalMs: 24 * 60 * 60 * 1000,
      spawnProcess,
    });
    const dailySummary = "Periodic summary: user asked for deployment routing and memory updates.";

    try {
      await appendMemory({
        workspacePath,
        kind: "transcript",
        title: "Recent conversation",
        content: [
          "Conversation: #测试群",
          "User: 部署列表页面需要路由。",
          "Agent: 已经开始修改部署面板。",
        ].join("\n"),
        dedupeKey: "message:test-periodic-memory",
      });
      const eventsPromise = collectEvents(
        adapter.run(createRunInput(workspacePath, {
          prompt: "continue latest work",
        })),
      );

      await waitFor(() => calls.length === 2, "Expected periodic memory process to spawn.");
      const normalRun = calls[0]?.process;
      const periodicRefresh = calls[1]?.process;

      expect(normalRun).toBeDefined();
      expect(periodicRefresh).toBeDefined();
      expect(periodicRefresh?.stdinText).toContain("部署列表页面需要路由");

      periodicRefresh?.stdout.write(
        `${JSON.stringify({
          type: "item.completed",
          item: {
            id: "msg_1",
            type: "agent_message",
            text: dailySummary,
          },
        })}\n`,
      );
      periodicRefresh?.close(0);

      await waitFor(
        () => normalRun?.stdinText.includes(dailySummary) === true,
        "Expected normal run memory prompt to contain periodic summary.",
      );

      normalRun?.close(0);
      const events = await eventsPromise;
      const refreshedEvent = events.find(
        (event) =>
          event.type === "runtime.event" &&
          event.raw.nativeType === "memory.periodic_refreshed",
      );
      const dailyMemory = await readFile(
        path.join(
          workspacePath,
          "memory",
          `${new Date().toISOString().slice(0, 10)}.md`,
        ),
        "utf8",
      );

      expect(refreshedEvent).toBeDefined();
      expect(dailyMemory).toContain("Periodic daily memory update");
      expect(dailyMemory).toContain(dailySummary);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
