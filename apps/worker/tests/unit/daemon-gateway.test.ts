import { createServer, type Server } from "node:http";

import type { RunEvent } from "@agent-hub/core";
import type { RunQueueJob } from "@agent-hub/server";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { DaemonGateway } from "../../src/daemon/gateway.js";

const token = "test-daemon-token";

function createRunQueueJob(): RunQueueJob {
  const now = "2026-05-25T00:00:00.000Z";

  return {
    daemonDeviceId: "local-dev",
    prompt: "hello",
    workspacePath: "/workspace",
    run: {
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "codex",
      daemonDeviceId: "local-dev",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    },
    runtime: {
      runtimeKind: "codex",
      capabilities: [],
      updatedAt: now,
    },
  };
}

async function createGatewayServer(gateway: DaemonGateway) {
  const server = createServer();
  server.on("upgrade", (request, socket, head) => {
    if (!gateway.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP address.");
  }

  return {
    server,
    url: `ws://127.0.0.1:${address.port}/daemon/connect`,
  };
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

async function waitForJsonMessage<T>(ws: WebSocket): Promise<T> {
  return new Promise<T>((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString()) as T));
  });
}

function sendHello(ws: WebSocket): void {
  ws.send(
    JSON.stringify({
      type: "daemon.hello",
      deviceId: "local-dev",
      token,
      runtimes: [
        {
          daemonDeviceId: "local-dev",
          runtimeKind: "codex",
          capabilities: [],
          status: "ready",
          lastSeenAt: "2026-05-25T00:00:00.000Z",
        },
      ],
      sentAt: "2026-05-25T00:00:00.000Z",
    }),
  );
}

describe("DaemonGateway", () => {
  let server: Server | undefined;
  let ws: WebSocket | undefined;

  afterEach(async () => {
    ws?.close();
    if (server !== undefined) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
  });

  it("accepts daemon hello and tracks the online device", async () => {
    const connectedDevices: string[] = [];
    const gateway = new DaemonGateway({
      daemonToken: token,
      onDaemonConnected: (deviceId, runtimes) => {
        connectedDevices.push(`${deviceId}:${runtimes[0]?.runtimeKind}`);
      },
      onRunEvent: () => undefined,
    });
    const listening = await createGatewayServer(gateway);
    server = listening.server;
    ws = new WebSocket(listening.url);

    await waitForOpen(ws);
    sendHello(ws);

    await expect(waitForJsonMessage(ws)).resolves.toMatchObject({
      type: "daemon.hello.ack",
      deviceId: "local-dev",
    });
    expect(connectedDevices).toEqual(["local-dev:codex"]);
    expect(gateway.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "local-dev",
        status: "online",
      }),
    ]);
  });

  it("assigns runs to connected daemons and rejects offline assignment", async () => {
    const gateway = new DaemonGateway({
      daemonToken: token,
      onRunEvent: () => undefined,
    });
    const listening = await createGatewayServer(gateway);
    server = listening.server;
    const job = createRunQueueJob();

    expect(gateway.assignRun(job)).toBe(false);

    ws = new WebSocket(listening.url);
    await waitForOpen(ws);
    sendHello(ws);
    await waitForJsonMessage(ws);

    const assignedMessage = waitForJsonMessage(ws);
    expect(gateway.assignRun(job)).toBe(true);
    await expect(assignedMessage).resolves.toMatchObject({
      type: "run.assigned",
      run: {
        id: job.run.id,
      },
    });
  });

  it("forwards daemon run events to the callback", async () => {
    const events: RunEvent[] = [];
    const gateway = new DaemonGateway({
      daemonToken: token,
      onRunEvent: (event) => events.push(event),
    });
    const listening = await createGatewayServer(gateway);
    server = listening.server;
    ws = new WebSocket(listening.url);

    await waitForOpen(ws);
    sendHello(ws);
    await waitForJsonMessage(ws);

    const event: RunEvent = {
      type: "run.completed",
      runId: "00000000-0000-4000-8000-000000000001",
      status: "succeeded",
      createdAt: "2026-05-25T00:00:00.000Z",
    };
    ws.send(
      JSON.stringify({
        type: "run.event",
        runId: event.runId,
        event,
        sentAt: "2026-05-25T00:00:00.000Z",
      }),
    );

    await expect
      .poll(() => events.length)
      .toBe(1);
    expect(events).toEqual([event]);
  });

  it("provisions agents through a connected daemon", async () => {
    const gateway = new DaemonGateway({
      daemonToken: token,
      onRunEvent: () => undefined,
    });
    const listening = await createGatewayServer(gateway);
    server = listening.server;
    ws = new WebSocket(listening.url);

    await waitForOpen(ws);
    sendHello(ws);
    await waitForJsonMessage(ws);

    const job = {
      agent: {
        id: "00000000-0000-4000-8000-000000000002",
        ownerUserId: "00000000-0000-4000-8000-000000000003",
        name: "Codex",
        defaultRuntimeKind: "codex" as const,
        status: "active" as const,
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      daemonDeviceId: "local-dev",
      runtime: {
        runtimeKind: "codex" as const,
        capabilities: [],
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    };
    const createMessage = waitForJsonMessage<{
      type: string;
      agent: { id: string };
    }>(ws);
    const provisioned = gateway.provisionAgent(job);

    await expect(createMessage).resolves.toMatchObject({
      type: "agent.create",
      agent: { id: job.agent.id },
    });
    ws.send(
      JSON.stringify({
        type: "agent.created",
        agentId: job.agent.id,
        daemonDeviceId: "local-dev",
        workspace: {
          agentId: job.agent.id,
          daemonDeviceId: "local-dev",
          workspacePath: "/workspace/local-dev/agent",
          status: "ready",
          syncMode: "local-only",
          createdAt: "2026-05-25T00:00:00.000Z",
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
        runtime: job.runtime,
        sentAt: "2026-05-25T00:00:01.000Z",
      }),
    );

    await expect(provisioned).resolves.toMatchObject({
      type: "agent.created",
      agentId: job.agent.id,
    });
  });
});
