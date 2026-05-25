import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type {
  DaemonClientMessage,
  DaemonDeviceId,
  DaemonServerMessage,
  RunEvent,
  RunId,
} from "@agent-hub/core";
import type { AgentHubLogger } from "@agent-hub/server";
import { WebSocket, WebSocketServer } from "ws";

export interface DaemonGatewayOptions {
  daemonToken: string;
  logger?: AgentHubLogger;
  onDaemonConnected?(deviceId: DaemonDeviceId): void | Promise<void>;
  onDaemonDisconnected?(deviceId: DaemonDeviceId): void | Promise<void>;
  onRunEvent(event: RunEvent): void | Promise<void>;
}

interface DaemonConnection {
  deviceId: DaemonDeviceId;
  ws: WebSocket;
  runningRunIds: Set<RunId>;
  lastSeenAt: string;
}

function nowIsoDateTime(): string {
  return new Date().toISOString();
}

function parseMessage(data: WebSocket.RawData): DaemonClientMessage | undefined {
  try {
    return JSON.parse(data.toString()) as DaemonClientMessage;
  } catch {
    return undefined;
  }
}

function send(ws: WebSocket, message: DaemonServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class DaemonGateway {
  readonly webSocketServer = new WebSocketServer({ noServer: true });

  #connections = new Map<DaemonDeviceId, DaemonConnection>();
  #options: DaemonGatewayOptions;

  constructor(options: DaemonGatewayOptions) {
    this.#options = options;

    this.webSocketServer.on("connection", (ws) => {
      let connection: DaemonConnection | undefined;

      ws.on("message", (data) => {
        const message = parseMessage(data);

        if (message === undefined) {
          ws.close(1003, "Invalid daemon message");
          return;
        }

        if (message.type === "daemon.hello") {
          if (message.token !== this.#options.daemonToken) {
            ws.close(1008, "Invalid daemon token");
            return;
          }

          connection = {
            deviceId: message.deviceId,
            ws,
            runningRunIds: new Set(),
            lastSeenAt: nowIsoDateTime(),
          };
          this.#connections.set(message.deviceId, connection);
          void Promise.resolve(
            this.#options.onDaemonConnected?.(message.deviceId),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), deviceId: message.deviceId },
              "Failed to persist daemon connection state",
            );
          });
          this.#options.logger?.info(
            { deviceId: message.deviceId },
            "Daemon connected",
          );
          send(ws, {
            type: "daemon.hello.ack",
            deviceId: message.deviceId,
            serverTime: nowIsoDateTime(),
          });
          return;
        }

        if (connection === undefined) {
          ws.close(1008, "Daemon hello required");
          return;
        }

        connection.lastSeenAt = nowIsoDateTime();

        if (message.type === "daemon.heartbeat") {
          connection.runningRunIds = new Set(message.runningRunIds);
          return;
        }

        if (message.type === "run.accepted") {
          connection.runningRunIds.add(message.runId);
          return;
        }

        if (message.type === "run.rejected") {
          connection.runningRunIds.delete(message.runId);
          void Promise.resolve(
            this.#options.onRunEvent({
              type: "run.completed",
              runId: message.runId,
              status: "failed",
              error: message.reason,
              createdAt: nowIsoDateTime(),
            }),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), runId: message.runId },
              "Failed to persist daemon run rejection",
            );
          });
          return;
        }

        if (message.type === "run.event") {
          if (message.event.type === "run.completed") {
            connection.runningRunIds.delete(message.runId);
          }
          void Promise.resolve(this.#options.onRunEvent(message.event)).catch(
            (error) => {
              this.#options.logger?.error(
                {
                  err: toError(error),
                  runId: message.runId,
                  eventType: message.event.type,
                },
                "Failed to persist daemon run event",
              );
            },
          );
        }
      });

      ws.on("close", () => {
        if (connection !== undefined) {
          this.#connections.delete(connection.deviceId);
          void Promise.resolve(
            this.#options.onDaemonDisconnected?.(connection.deviceId),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), deviceId: connection?.deviceId },
              "Failed to persist daemon disconnection state",
            );
          });
          this.#options.logger?.info(
            { deviceId: connection.deviceId },
            "Daemon disconnected",
          );
        }
      });
    });
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    if (request.url !== "/daemon/connect") {
      return false;
    }

    this.webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      this.webSocketServer.emit("connection", ws, request);
    });
    return true;
  }

  assign(message: DaemonServerMessage): boolean {
    if (message.type !== "run.assigned") {
      return false;
    }

    const connection = this.#connections.get(message.daemonDeviceId);

    if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
      this.#options.logger?.warn(
        {
          daemonDeviceId: message.daemonDeviceId,
          runId: message.run.id,
        },
        "Cannot assign run because daemon is not connected",
      );
      return false;
    }

    send(connection.ws, message);
    this.#options.logger?.info(
      {
        daemonDeviceId: message.daemonDeviceId,
        runId: message.run.id,
      },
      "Assigned run to daemon",
    );
    return true;
  }

  listDevices() {
    return Array.from(this.#connections.values()).map((connection) => ({
      deviceId: connection.deviceId,
      lastSeenAt: connection.lastSeenAt,
      runningRunIds: Array.from(connection.runningRunIds),
      status: "online" as const,
    }));
  }
}
