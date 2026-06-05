import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type {
  AgentId,
  DaemonClientMessage,
  DaemonDeviceId,
  DaemonServerMessage,
  DaemonRuntime,
  ConversationArtifact,
  ConversationDeployment,
  AgentHubMcpToolResult,
  RunEvent,
  RunId,
} from "@agent-hub/core";
import type {
  AgentHubLogger,
  AgentProvisioningJob,
  RunQueueJob,
} from "@agent-hub/server";
import { WebSocket, WebSocketServer } from "ws";

export interface DaemonGatewayOptions {
  logger?: AgentHubLogger;
  verifyDaemonToken(input: {
    deviceId: DaemonDeviceId;
    token: string;
  }): boolean | Promise<boolean>;
  onDaemonConnected?(
    deviceId: DaemonDeviceId,
    runtimes: DaemonRuntime[],
  ): void | Promise<void>;
  onDaemonDisconnected?(deviceId: DaemonDeviceId): void | Promise<void>;
  onRunEvent(event: RunEvent): void | Promise<void>;
  onArtifactUpload?(
    message: Extract<DaemonClientMessage, { type: "artifact.upload" }>,
  ): ConversationArtifact | Promise<ConversationArtifact>;
  onStaticSiteDeploy?(
    message: Extract<DaemonClientMessage, { type: "static_site.deploy" }>,
  ): ConversationDeployment | Promise<ConversationDeployment>;
  onAgentHubToolCall?(
    message: Extract<DaemonClientMessage, { type: "agenthub.tool.call" }>,
  ): AgentHubMcpToolResult | Promise<AgentHubMcpToolResult>;
  onArtifactActionCompleted?(
    message: Extract<DaemonClientMessage, { type: "artifact.action.completed" }>,
  ): void | Promise<void>;
  onMemoryAppendFailed?(
    message: Extract<DaemonClientMessage, { type: "memory.append_failed" }>,
  ): void | Promise<void>;
  onMemoryAppended?(
    message: Extract<DaemonClientMessage, { type: "memory.appended" }>,
  ): void | Promise<void>;
  onProjectCloneCompleted?(
    message: Extract<DaemonClientMessage, { type: "project.clone.completed" }>,
  ): void | Promise<void>;
  onProjectCloneFailed?(
    message: Extract<DaemonClientMessage, { type: "project.clone.failed" }>,
  ): void | Promise<void>;
  onProjectChangeCreated?(
    message: Extract<DaemonClientMessage, { type: "project.change.created" }>,
  ): void | Promise<void>;
  onProjectChangeMergeAck?(
    message: Extract<DaemonClientMessage, { type: "project.change.merge.ack" }>,
  ): void | Promise<void>;
  onProjectChangeMergeRejected?(
    message: Extract<DaemonClientMessage, { type: "project.change.merge.rejected" }>,
  ): void | Promise<void>;
}

interface DaemonConnection {
  deviceId: DaemonDeviceId;
  ws: WebSocket;
  runningRunIds: Set<RunId>;
  lastSeenAt: string;
}

interface PendingAgentProvisioning {
  daemonDeviceId: DaemonDeviceId;
  resolve(message: Extract<DaemonClientMessage, { type: "agent.created" }>): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
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
  #pendingAgentProvisioning = new Map<AgentId, PendingAgentProvisioning>();
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
          void Promise.resolve(
            this.#options.verifyDaemonToken({
              deviceId: message.deviceId,
              token: message.token,
            }),
          ).then((accepted) => {
            if (!accepted) {
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
              this.#options.onDaemonConnected?.(message.deviceId, message.runtimes),
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
          }).catch((error) => {
            this.#options.logger?.warn(
              { err: toError(error), deviceId: message.deviceId },
              "Daemon token verification failed",
            );
            ws.close(1008, "Invalid daemon token");
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
          return;
        }

        if (message.type === "artifact.upload") {
          void Promise.resolve(this.#options.onArtifactUpload?.(message))
            .then((artifact) => {
              if (artifact === undefined) {
                throw new Error("Artifact upload handler is not configured.");
              }

              send(ws, {
                type: "artifact.upload.ack",
                uploadId: message.uploadId,
                artifact,
                sentAt: nowIsoDateTime(),
              });
            })
            .catch((error) => {
              const err = toError(error);
              send(ws, {
                type: "artifact.upload.rejected",
                uploadId: message.uploadId,
                reason: err.message,
                sentAt: nowIsoDateTime(),
              });
              this.#options.logger?.error(
                { err, runId: message.runId, uploadId: message.uploadId },
                "Failed to persist artifact upload",
              );
            });
          return;
        }

        if (message.type === "agenthub.tool.call") {
          void Promise.resolve(this.#options.onAgentHubToolCall?.(message))
            .then((result) => {
              if (result === undefined) {
                throw new Error("AgentHub MCP tool call handler is not configured.");
              }

              send(ws, {
                type: "agenthub.tool.call.result",
                requestId: message.requestId,
                result,
                sentAt: nowIsoDateTime(),
              });
            })
            .catch((error) => {
              const err = toError(error);
              send(ws, {
                type: "agenthub.tool.call.rejected",
                requestId: message.requestId,
                reason: err.message,
                sentAt: nowIsoDateTime(),
              });
              this.#options.logger?.error(
                {
                  err,
                  runId: message.call.runId,
                  toolName: message.call.name,
                },
                "Failed to handle AgentHub MCP tool call",
              );
            });
          return;
        }

        if (message.type === "agent.created") {
          const pending = this.#pendingAgentProvisioning.get(message.agentId);

          if (pending !== undefined) {
            clearTimeout(pending.timer);
            this.#pendingAgentProvisioning.delete(message.agentId);
            pending.resolve(message);
          }
          return;
        }

        if (message.type === "agent.create_failed") {
          const pending = this.#pendingAgentProvisioning.get(message.agentId);

          if (pending !== undefined) {
            clearTimeout(pending.timer);
            this.#pendingAgentProvisioning.delete(message.agentId);
            pending.reject(new Error(message.reason));
          }
          return;
        }

        if (message.type === "artifact.action.completed") {
          void Promise.resolve(
            this.#options.onArtifactActionCompleted?.(message),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), actionId: message.actionId },
              "Failed to persist artifact action result",
            );
          });
          return;
        }

        if (message.type === "static_site.deploy") {
          void Promise.resolve(this.#options.onStaticSiteDeploy?.(message))
            .then((deployment) => {
              if (deployment === undefined) {
                throw new Error("Static site deployment handler is not configured.");
              }

              send(ws, {
                type: "static_site.deploy.ack",
                deploymentId: message.deploymentId,
                deployment,
                sentAt: nowIsoDateTime(),
              });
            })
            .catch((error) => {
              const err = toError(error);
              send(ws, {
                type: "static_site.deploy.rejected",
                deploymentId: message.deploymentId,
                reason: err.message,
                sentAt: nowIsoDateTime(),
              });
              this.#options.logger?.error(
                { err, runId: message.runId, deploymentId: message.deploymentId },
                "Failed to persist static site deployment",
              );
            });
          return;
        }

        if (message.type === "memory.appended") {
          void Promise.resolve(this.#options.onMemoryAppended?.(message)).catch(
            (error) => {
              this.#options.logger?.error(
                { err: toError(error), requestId: message.requestId },
                "Failed to handle memory append ack",
              );
            },
          );
          return;
        }

        if (message.type === "memory.append_failed") {
          void Promise.resolve(this.#options.onMemoryAppendFailed?.(message)).catch(
            (error) => {
              this.#options.logger?.error(
                { err: toError(error), requestId: message.requestId },
                "Failed to handle memory append rejection",
              );
            },
          );
          return;
        }

        if (message.type === "project.clone.completed") {
          void Promise.resolve(
            this.#options.onProjectCloneCompleted?.(message),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), conversationId: message.conversationId },
              "Failed to persist project clone completion",
            );
          });
          return;
        }

        if (message.type === "project.clone.failed") {
          void Promise.resolve(
            this.#options.onProjectCloneFailed?.(message),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), conversationId: message.conversationId },
              "Failed to persist project clone failure",
            );
          });
          return;
        }

        if (message.type === "project.change.created") {
          void Promise.resolve(
            this.#options.onProjectChangeCreated?.(message),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), changeId: message.change.id },
              "Failed to persist project change",
            );
          });
          return;
        }

        if (message.type === "project.change.merge.ack") {
          void Promise.resolve(
            this.#options.onProjectChangeMergeAck?.(message),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), changeId: message.changeId },
              "Failed to persist project change merge ack",
            );
          });
          return;
        }

        if (message.type === "project.change.merge.rejected") {
          void Promise.resolve(
            this.#options.onProjectChangeMergeRejected?.(message),
          ).catch((error) => {
            this.#options.logger?.error(
              { err: toError(error), changeId: message.changeId },
              "Failed to persist project change merge rejection",
            );
          });
          return;
        }
      });

      ws.on("close", () => {
        if (connection !== undefined) {
          this.#connections.delete(connection.deviceId);
          for (const [agentId, pending] of this.#pendingAgentProvisioning) {
            if (pending.daemonDeviceId === connection.deviceId) {
              clearTimeout(pending.timer);
              this.#pendingAgentProvisioning.delete(agentId);
              pending.reject(new Error("Daemon disconnected while creating agent."));
            }
          }
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

  provisionAgent(
    job: AgentProvisioningJob,
    options: { timeoutMs?: number } = {},
  ): Promise<Extract<DaemonClientMessage, { type: "agent.created" }>> {
    const connection = this.#connections.get(job.daemonDeviceId);

    if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
      this.#options.logger?.warn(
        {
          agentId: job.agent.id,
          daemonDeviceId: job.daemonDeviceId,
        },
        "Cannot create agent because daemon is not connected",
      );
      return Promise.reject(
        new Error(`Daemon ${job.daemonDeviceId} is not connected.`),
      );
    }

    if (this.#pendingAgentProvisioning.has(job.agent.id)) {
      return Promise.reject(
        new Error(`Agent ${job.agent.id} is already being created.`),
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 30_000;
      const timer = setTimeout(() => {
        this.#pendingAgentProvisioning.delete(job.agent.id);
        reject(new Error("Agent provisioning timed out."));
      }, timeoutMs);

      this.#pendingAgentProvisioning.set(job.agent.id, {
        daemonDeviceId: job.daemonDeviceId,
        resolve,
        reject,
        timer,
      });

      send(connection.ws, {
        type: "agent.create",
        agent: job.agent,
        daemonDeviceId: job.daemonDeviceId,
        runtime: job.runtime,
        sentAt: nowIsoDateTime(),
      });
      this.#options.logger?.info(
        {
          agentId: job.agent.id,
          daemonDeviceId: job.daemonDeviceId,
        },
        "Requested daemon agent provisioning",
      );
    });
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

  assignRun(job: RunQueueJob): boolean {
    return this.assign({
      type: "run.assigned",
      agentId: job.run.agentId,
      daemonDeviceId: job.daemonDeviceId,
      run: job.run,
      prompt: job.prompt,
      dispatchMode: job.dispatchMode,
      runtimeSessionId: job.runtimeSessionId,
      preemptRunIds: job.preemptRunIds,
      agentInstructions: job.agentInstructions,
      contextCompression: job.contextCompression,
      workspacePath: job.workspacePath,
      memoryWorkspacePath: job.memoryWorkspacePath,
      projectRun: job.projectRun,
      runtime: job.runtime,
      agentHubMcpTools: job.agentHubMcpTools,
      agentHubMcpGoals: job.agentHubMcpGoals,
    });
  }

  assignArtifactAction(
    message: Extract<DaemonServerMessage, { type: "artifact.action.assigned" }> & {
      daemonDeviceId: DaemonDeviceId;
    },
  ): boolean {
    const connection = this.#connections.get(message.daemonDeviceId);

    if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
      this.#options.logger?.warn(
        {
          actionId: message.actionId,
          daemonDeviceId: message.daemonDeviceId,
        },
        "Cannot assign artifact action because daemon is not connected",
      );
      return false;
    }

    const { daemonDeviceId: _daemonDeviceId, ...serverMessage } = message;
    send(connection.ws, serverMessage);
    this.#options.logger?.info(
      {
        actionId: message.actionId,
        daemonDeviceId: message.daemonDeviceId,
      },
      "Assigned artifact action to daemon",
    );
    return true;
  }

  assignMemoryAppend(
    message: Extract<DaemonServerMessage, { type: "memory.append" }> & {
      daemonDeviceId: DaemonDeviceId;
    },
  ): boolean {
    const connection = this.#connections.get(message.daemonDeviceId);

    if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
      this.#options.logger?.warn(
        {
          daemonDeviceId: message.daemonDeviceId,
          requestId: message.requestId,
        },
        "Cannot assign memory append because daemon is not connected",
      );
      return false;
    }

    const { daemonDeviceId: _daemonDeviceId, ...serverMessage } = message;
    send(connection.ws, serverMessage);
    this.#options.logger?.info(
      {
        daemonDeviceId: message.daemonDeviceId,
        requestId: message.requestId,
      },
      "Assigned memory append to daemon",
    );
    return true;
  }

  assignProjectClone(
    message: Extract<DaemonServerMessage, { type: "project.clone" }> & {
      daemonDeviceId: DaemonDeviceId;
    },
  ): boolean {
    const connection = this.#connections.get(message.daemonDeviceId);

    if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
      this.#options.logger?.warn(
        {
          conversationId: message.conversationId,
          daemonDeviceId: message.daemonDeviceId,
        },
        "Cannot assign project clone because daemon is not connected",
      );
      return false;
    }

    const { daemonDeviceId: _daemonDeviceId, ...serverMessage } = message;
    send(connection.ws, serverMessage);
    this.#options.logger?.info(
      {
        conversationId: message.conversationId,
        daemonDeviceId: message.daemonDeviceId,
      },
      "Assigned project clone to daemon",
    );
    return true;
  }

  assignProjectChangeMerge(
    message: Extract<DaemonServerMessage, { type: "project.change.merge" }> & {
      daemonDeviceId: DaemonDeviceId;
    },
  ): boolean {
    const connection = this.#connections.get(message.daemonDeviceId);

    if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
      this.#options.logger?.warn(
        {
          changeId: message.changeId,
          daemonDeviceId: message.daemonDeviceId,
        },
        "Cannot assign project merge because daemon is not connected",
      );
      return false;
    }

    const { daemonDeviceId: _daemonDeviceId, ...serverMessage } = message;
    send(connection.ws, serverMessage);
    this.#options.logger?.info(
      {
        changeId: message.changeId,
        daemonDeviceId: message.daemonDeviceId,
      },
      "Assigned project merge to daemon",
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
