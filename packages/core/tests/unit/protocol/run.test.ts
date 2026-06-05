import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../src/protocol";

describe("run protocol", () => {
  it("expresses runtime log lines", () => {
    const event = {
      type: "log.line",
      runId: "run_1",
      stream: "stdout",
      line: "hello",
      createdAt: "2026-05-21T00:00:00.000Z",
    } satisfies RunEvent;

    expect(event.type).toBe("log.line");
  });

  it("expresses runtime tool calls", () => {
    const started = {
      type: "tool.call.started",
      runId: "run_1",
      toolCallId: "tool_1",
      name: "Read",
      input: { path: "README.md" },
      createdAt: "2026-05-21T00:00:00.000Z",
    } satisfies RunEvent;
    const completed = {
      type: "tool.call.completed",
      runId: "run_1",
      toolCallId: "tool_1",
      status: "succeeded",
      output: { ok: true },
      createdAt: "2026-05-21T00:00:01.000Z",
    } satisfies RunEvent;

    expect(started.name).toBe("Read");
    expect(completed.status).toBe("succeeded");
  });

  it("expresses raw runtime events next to normalized events", () => {
    const rawPayload = {
      type: "item.started",
      item: {
        id: "item_1",
        type: "command_execution",
        command: "/bin/zsh -lc ls",
      },
    };
    const rawEvent = {
      type: "runtime.event",
      runId: "run_1",
      raw: {
        runtimeKind: "codex",
        nativeType: "item.started",
        payload: rawPayload,
      },
      createdAt: "2026-05-21T00:00:00.000Z",
    } satisfies RunEvent;
    const mappedEvent = {
      type: "tool.call.started",
      runId: "run_1",
      toolCallId: "item_1",
      name: "command_execution",
      input: { command: "/bin/zsh -lc ls" },
      raw: {
        runtimeKind: "codex",
        nativeType: "item.started",
        payload: rawPayload,
      },
      createdAt: "2026-05-21T00:00:00.000Z",
    } satisfies RunEvent;

    expect(rawEvent.raw.nativeType).toBe("item.started");
    expect(mappedEvent.raw.payload).toBe(rawPayload);
  });

  it("expresses AgentHub MCP tool calls", () => {
    const event = {
      type: "agenthub.tool.call",
      runId: "run_1",
      toolCallId: "tool_1",
      name: "send_message",
      input: { content: "I can take this one." },
      createdAt: "2026-05-21T00:00:00.000Z",
    } satisfies RunEvent;

    expect(event.name).toBe("send_message");
    expect(event.input.content).toBe("I can take this one.");
  });

  it("expresses AgentHub MCP tool results", () => {
    const succeeded = {
      type: "agenthub.tool.result",
      runId: "run_1",
      toolCallId: "tool_1",
      name: "send_message",
      status: "succeeded",
      output: { accepted: true, messageId: "msg_1" },
      createdAt: "2026-05-21T00:00:01.000Z",
    } satisfies RunEvent;
    const failed = {
      type: "agenthub.tool.result",
      runId: "run_1",
      toolCallId: "tool_2",
      name: "read_artifact",
      status: "failed",
      error: "Artifact was not found.",
      createdAt: "2026-05-21T00:00:02.000Z",
    } satisfies RunEvent;

    expect(succeeded.output).toEqual({ accepted: true, messageId: "msg_1" });
    expect(failed.error).toBe("Artifact was not found.");
  });
});
