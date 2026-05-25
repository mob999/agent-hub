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
});
