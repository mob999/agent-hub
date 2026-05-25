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
      capabilities: [],
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
      onDaemonConnected: (deviceId) => connectedDevices.push(deviceId),
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
    expect(connectedDevices).toEqual(["local-dev"]);
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
});
