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
});

