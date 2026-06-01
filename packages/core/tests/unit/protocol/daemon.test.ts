import { describe, expect, it } from "vitest";

import type { DaemonClientMessage, DaemonServerMessage } from "../../../src";

describe("daemon protocol", () => {
  it("expresses daemon runtime discovery without an agent binding", () => {
    const message: DaemonClientMessage = {
      type: "daemon.hello",
      deviceId: "local-dev",
      token: "token",
      runtimes: [
        {
          daemonDeviceId: "local-dev",
          runtimeKind: "codex",
          capabilities: [{ name: "json-events", enabled: true }],
          status: "ready",
          lastSeenAt: "2026-05-25T00:00:00.000Z",
        },
      ],
      sentAt: "2026-05-25T00:00:00.000Z",
    };

    expect(message.runtimes[0]?.runtimeKind).toBe("codex");
  });

  it("expresses daemon-side agent provisioning requests", () => {
    const message: DaemonServerMessage = {
      type: "agent.create",
      daemonDeviceId: "local-dev",
      agent: {
        id: "00000000-0000-4000-8000-000000000001",
        ownerUserId: "00000000-0000-4000-8000-000000000002",
        name: "Codex",
        defaultRuntimeKind: "codex",
        status: "active",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      runtime: {
        runtimeKind: "codex",
        capabilities: [],
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      sentAt: "2026-05-25T00:00:00.000Z",
    };

    expect(message.type).toBe("agent.create");
    expect(message.agent.defaultRuntimeKind).toBe(message.runtime.runtimeKind);
  });

  it("expresses run assignment agent instructions", () => {
    const message: DaemonServerMessage = {
      type: "run.assigned",
      agentId: "00000000-0000-4000-8000-000000000001",
      daemonDeviceId: "local-dev",
      prompt: "hello",
      agentInstructions: "Use this agent profile.",
      contextCompression: {
        compressibleText: "older conversation",
        promptTemplate: "summary:\n{{compressed_context}}\nlatest:\nhello",
        thresholdChars: 1000,
      },
      workspacePath: "/workspace",
      run: {
        id: "00000000-0000-4000-8000-000000000002",
        agentId: "00000000-0000-4000-8000-000000000001",
        daemonDeviceId: "local-dev",
        status: "queued",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      runtime: {
        runtimeKind: "codex",
        capabilities: [],
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    };

    expect(message.agentInstructions).toBe("Use this agent profile.");
    expect(message.contextCompression?.thresholdChars).toBe(1000);
  });

  it("expresses daemon memory append messages", () => {
    const request: DaemonServerMessage = {
      type: "memory.append",
      requestId: "memory_1",
      workspacePath: "/workspace",
      kind: "transcript",
      content: "User: hello",
      date: "2026-06-01",
      dedupeKey: "message_1",
      sentAt: "2026-06-01T00:00:00.000Z",
    };
    const response: DaemonClientMessage = {
      type: "memory.appended",
      requestId: request.requestId,
      entryId: "entry_1",
      file: "memory/transcripts/2026-06-01.md",
      sentAt: "2026-06-01T00:00:01.000Z",
    };

    expect(request.kind).toBe("transcript");
    expect(response.file).toContain("transcripts");
  });
});
