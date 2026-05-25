import { pathToFileURL } from "node:url";

import { loadDaemonEnv } from "@agent-hub/config";
import type {
  DaemonRuntime,
  DaemonClientMessage,
  DaemonServerMessage,
  RunId,
} from "@agent-hub/core";
import { createLogger } from "@agent-hub/server";
import WebSocket from "ws";

import { CodexAdapter } from "./runtime/codex";
import {
  assertPathInsideWorkspace,
  getAgentWorkspacePath,
  initializeAgentWorkspace,
} from "./workspace";

function nowIsoDateTime(): string {
  return new Date().toISOString();
}

function toDaemonWebSocketUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/daemon/connect";
  url.search = "";
  return url.toString();
}

function send(ws: WebSocket, message: DaemonClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function parseServerMessage(data: WebSocket.RawData): DaemonServerMessage | undefined {
  try {
    return JSON.parse(data.toString()) as DaemonServerMessage;
  } catch {
    return undefined;
  }
}

const initialReconnectDelayMs = 1_000;
const maxReconnectDelayMs = 10_000;

export async function startDaemon(): Promise<void> {
  const env = loadDaemonEnv();
  const adapter = new CodexAdapter({
    executablePath: env.CODEX_EXECUTABLE_PATH,
  });
  const logger = createLogger({
    bindings: {
      deviceId: env.AGENTHUB_DEVICE_ID,
      service: "daemon",
    },
  });
  const abortControllers = new Map<RunId, AbortController>();
  let reconnectDelayMs = initialReconnectDelayMs;

  const handleMessage = (ws: WebSocket, data: WebSocket.RawData): void => {
    const message = parseServerMessage(data);

    if (message === undefined) {
      return;
    }

    if (message.type === "daemon.hello.ack") {
      logger.info({ deviceId: message.deviceId }, "Daemon connected");
      return;
    }

    if (message.type === "run.cancel") {
      abortControllers.get(message.runId)?.abort();
      logger.info({ runId: message.runId }, "Run cancellation requested");
      return;
    }

    if (message.type === "agent.create") {
      void (async () => {
        try {
          if (message.daemonDeviceId !== env.AGENTHUB_DEVICE_ID) {
            throw new Error(
              `Agent create target ${message.daemonDeviceId} does not match daemon ${env.AGENTHUB_DEVICE_ID}`,
            );
          }

          const initialized = await initializeAgentWorkspace({
            agentId: message.agent.id,
            daemonDeviceId: message.daemonDeviceId,
            workspacePath: getAgentWorkspacePath(env.AGENTHUB_WORKSPACE_ROOT, {
              agentId: message.agent.id,
              daemonDeviceId: message.daemonDeviceId,
            }),
            runtime: message.runtime,
          });

          send(ws, {
            type: "agent.created",
            agentId: message.agent.id,
            daemonDeviceId: message.daemonDeviceId,
            workspace: initialized.workspace,
            runtime: initialized.runtime,
            sentAt: nowIsoDateTime(),
          });
          logger.info(
            {
              agentId: message.agent.id,
              workspacePath: initialized.workspace.workspacePath,
            },
            "Agent workspace initialized",
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          send(ws, {
            type: "agent.create_failed",
            agentId: message.agent.id,
            daemonDeviceId: message.daemonDeviceId,
            reason,
            sentAt: nowIsoDateTime(),
          });
          logger.error(
            { err: error, agentId: message.agent.id },
            "Agent workspace initialization failed",
          );
        }
      })();
      return;
    }

    if (message.type !== "run.assigned") {
      return;
    }

    if (abortControllers.has(message.run.id)) {
      return;
    }

    try {
      assertPathInsideWorkspace(
        env.AGENTHUB_WORKSPACE_ROOT,
        message.workspacePath,
      );
    } catch (error) {
      send(ws, {
        type: "run.rejected",
        runId: message.run.id,
        reason: error instanceof Error ? error.message : String(error),
        sentAt: nowIsoDateTime(),
      });
      logger.warn(
        { runId: message.run.id, workspacePath: message.workspacePath },
        "Rejected run because workspace path is outside daemon root",
      );
      return;
    }

    const abortController = new AbortController();
    abortControllers.set(message.run.id, abortController);
    send(ws, {
      type: "run.accepted",
      runId: message.run.id,
      sentAt: nowIsoDateTime(),
    });
    logger.info(
      { runId: message.run.id, workspacePath: message.workspacePath },
      "Accepted daemon run",
    );

    void (async () => {
      try {
        for await (const event of adapter.run({
          run: message.run,
          prompt: message.prompt,
          agentInstructions: message.agentInstructions,
          workspacePath: message.workspacePath,
          runtime: message.runtime,
          abortSignal: abortController.signal,
        })) {
          send(ws, {
            type: "run.event",
            runId: message.run.id,
            event,
            sentAt: nowIsoDateTime(),
          });
        }
      } catch (error) {
        logger.error({ err: error, runId: message.run.id }, "Daemon run failed");
        send(ws, {
          type: "run.event",
          runId: message.run.id,
          event: {
            type: "run.completed",
            runId: message.run.id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            createdAt: nowIsoDateTime(),
          },
          sentAt: nowIsoDateTime(),
        });
      } finally {
        abortControllers.delete(message.run.id);
        logger.info({ runId: message.run.id }, "Daemon run finished");
      }
    })();
  };

  const connect = (): void => {
    const ws = new WebSocket(
      toDaemonWebSocketUrl(env.AGENTHUB_DAEMON_GATEWAY_URL),
    );

    ws.on("open", async () => {
      reconnectDelayMs = initialReconnectDelayMs;
      let runtimes: DaemonRuntime[] = [];

      try {
        runtimes = [
          {
            ...(await adapter.detect()),
            daemonDeviceId: env.AGENTHUB_DEVICE_ID,
          },
        ];
      } catch (error) {
        logger.warn(
          { err: error },
          "Codex runtime detection failed",
        );
      }

      send(ws, {
        type: "daemon.hello",
        deviceId: env.AGENTHUB_DEVICE_ID,
        token: env.AGENTHUB_DAEMON_TOKEN,
        runtimes,
        sentAt: nowIsoDateTime(),
      });
    });

    const heartbeat = setInterval(() => {
      send(ws, {
        type: "daemon.heartbeat",
        deviceId: env.AGENTHUB_DEVICE_ID,
        runningRunIds: Array.from(abortControllers.keys()),
        sentAt: nowIsoDateTime(),
      });
    }, 10_000);

    ws.on("message", (data) => {
      handleMessage(ws, data);
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      for (const abortController of abortControllers.values()) {
        abortController.abort();
      }

      const nextReconnectDelayMs = reconnectDelayMs;
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, maxReconnectDelayMs);
      logger.info(
        { reconnectDelayMs: nextReconnectDelayMs },
        "Daemon websocket closed; reconnecting",
      );
      setTimeout(connect, nextReconnectDelayMs);
    });

    ws.on("error", (error) => {
      logger.error({ err: error }, "Daemon websocket error");
    });
  };

  connect();
}

export function isDirectDaemonEntry(importMetaUrl: string): boolean {
  return process.argv[1] !== undefined &&
    importMetaUrl === pathToFileURL(process.argv[1]).href;
}
