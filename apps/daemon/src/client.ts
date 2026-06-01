import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadDaemonEnv } from "@agent-hub/config";
import type {
  DaemonRuntime,
  DaemonClientMessage,
  DaemonServerMessage,
  AgentHubMcpToolCall,
  AgentHubMcpToolResult,
  AgentHubDeployStaticSiteToolResult,
  AgentHubUploadArtifactToolResult,
  AgentRunArtifactUpload,
  AgentRunStaticSiteDeploy,
  RunId,
} from "@agent-hub/core";
import { createLogger } from "@agent-hub/server";
import WebSocket from "ws";

import { appendMemory } from "./memory";
import { AgentHubMcpRelay } from "./mcp/relay";
import {
  createAgentHubMcpServerCommand,
  createRuntimeAdapters,
  getRuntimeAdapter,
} from "./runtime";
import {
  assertPathInsideWorkspace,
  getAgentWorkspacePath,
  initializeAgentWorkspace,
  resolveWorkspacePath,
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

interface PendingDaemonRequest<T> {
  resolve(result: T): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
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
const artifactUploadTimeoutMs = 30_000;
const mcpToolCallTimeoutMs = 30_000;
const runPreemptTimeoutMs = 10_000;

type RunAbortReason = "cancelled" | "interrupted";
interface ActiveRun {
  abortController: AbortController;
  abortReason?: RunAbortReason;
  done: Promise<void>;
  resolveDone(): void;
}

async function handleArtifactAction(input: {
  env: ReturnType<typeof loadDaemonEnv>;
  message: Extract<DaemonServerMessage, { type: "artifact.action.assigned" }>;
}): Promise<Record<string, unknown> | undefined> {
  const { env, message } = input;

  assertPathInsideWorkspace(env.AGENTHUB_WORKSPACE_ROOT, message.workspacePath);

  if (message.actionType === "apply") {
    const targetPath = message.sourcePath ?? message.filename;
    const resolvedTargetPath = resolveWorkspacePath(message.workspacePath, targetPath);
    await mkdir(path.dirname(resolvedTargetPath), { recursive: true });
    await writeFile(resolvedTargetPath, Buffer.from(message.contentBase64, "base64"));

    return {
      targetPath: path.relative(message.workspacePath, resolvedTargetPath),
    };
  }

  if (message.actionType === "preview") {
    return {
      started: false,
    };
  }

  if (message.actionType === "publish") {
    return {
      message: "Local publish action recorded.",
      publishedAt: nowIsoDateTime(),
    };
  }

  throw new Error(`Unsupported artifact action: ${message.actionType}`);
}

export async function startDaemon(): Promise<void> {
  const env = loadDaemonEnv();
  const mcpRelay = new AgentHubMcpRelay();
  await mcpRelay.start();
  const adapters = createRuntimeAdapters({
    dailyMemoryRefreshIntervalMs:
      env.AGENTHUB_DAILY_MEMORY_REFRESH_INTERVAL_MINUTES * 60 * 1000,
    dailyMemoryRefreshTranscriptMaxBytes:
      env.AGENTHUB_DAILY_MEMORY_REFRESH_TRANSCRIPT_MAX_BYTES,
    CODEX_EXECUTABLE_PATH: env.CODEX_EXECUTABLE_PATH,
    CLAUDE_CODE_EXECUTABLE_PATH: env.CLAUDE_CODE_EXECUTABLE_PATH,
    mcpRelay,
    mcpServerCommand: createAgentHubMcpServerCommand(),
  });
  const logger = createLogger({
    bindings: {
      deviceId: env.AGENTHUB_DEVICE_ID,
      service: "daemon",
    },
  });
  const activeRuns = new Map<RunId, ActiveRun>();
  const pendingArtifactUploads = new Map<
    string,
    PendingDaemonRequest<AgentHubUploadArtifactToolResult>
  >();
  const pendingStaticSiteDeployments = new Map<
    string,
    PendingDaemonRequest<AgentHubDeployStaticSiteToolResult>
  >();
  const pendingMcpToolCalls = new Map<
    string,
    {
      resolve(result: AgentHubMcpToolResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
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
      const activeRun = activeRuns.get(message.runId);

      if (activeRun !== undefined) {
        activeRun.abortReason = "cancelled";
        activeRun.abortController.abort("cancelled");
      }
      logger.info({ runId: message.runId }, "Run cancellation requested");
      return;
    }

    if (
      message.type === "artifact.upload.ack" ||
      message.type === "artifact.upload.rejected"
    ) {
      const pending = pendingArtifactUploads.get(message.uploadId);

      if (pending === undefined) {
        return;
      }

      clearTimeout(pending.timer);
      pendingArtifactUploads.delete(message.uploadId);

      if (message.type === "artifact.upload.ack") {
        pending.resolve({
          accepted: true,
          artifact: message.artifact,
        });
      } else {
        pending.reject(new Error(message.reason));
      }
      return;
    }

    if (
      message.type === "static_site.deploy.ack" ||
      message.type === "static_site.deploy.rejected"
    ) {
      const pending = pendingStaticSiteDeployments.get(message.deploymentId);
      if (pending === undefined) {
        return;
      }

      clearTimeout(pending.timer);
      pendingStaticSiteDeployments.delete(message.deploymentId);
      if (message.type === "static_site.deploy.ack") {
        pending.resolve({ accepted: true, deployment: message.deployment });
      } else {
        pending.reject(new Error(message.reason));
      }
      return;
    }

    if (
      message.type === "agenthub.tool.call.result" ||
      message.type === "agenthub.tool.call.rejected"
    ) {
      const pending = pendingMcpToolCalls.get(message.requestId);

      if (pending === undefined) {
        return;
      }

      clearTimeout(pending.timer);
      pendingMcpToolCalls.delete(message.requestId);

      if (message.type === "agenthub.tool.call.result") {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.reason));
      }
      return;
    }

    if (message.type === "artifact.action.assigned") {
      void (async () => {
        try {
          const result = await handleArtifactAction({
            env,
            message,
          });

          send(ws, {
            type: "artifact.action.completed",
            actionId: message.actionId,
            result,
            status: "succeeded",
            sentAt: nowIsoDateTime(),
          });
        } catch (error) {
          send(ws, {
            type: "artifact.action.completed",
            actionId: message.actionId,
            error: error instanceof Error ? error.message : String(error),
            status: "failed",
            sentAt: nowIsoDateTime(),
          });
          logger.error(
            { err: error, actionId: message.actionId },
            "Artifact action failed",
          );
        }
      })();
      return;
    }

    if (message.type === "memory.append") {
      void (async () => {
        try {
          assertPathInsideWorkspace(
            env.AGENTHUB_WORKSPACE_ROOT,
            message.workspacePath,
          );
          const result = await appendMemory({
            workspacePath: message.workspacePath,
            kind: message.kind,
            title: message.title,
            content: message.content,
            tags: message.tags,
            date: message.date,
            dedupeKey: message.dedupeKey,
          });
          send(ws, {
            type: "memory.appended",
            requestId: message.requestId,
            entryId: result.entryId,
            file: result.file,
            sentAt: nowIsoDateTime(),
          });
        } catch (error) {
          send(ws, {
            type: "memory.append_failed",
            requestId: message.requestId,
            reason: error instanceof Error ? error.message : String(error),
            sentAt: nowIsoDateTime(),
          });
          logger.error(
            { err: error, requestId: message.requestId },
            "Memory append failed",
          );
        }
      })();
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

    void (async () => {
      const preemptRunIds = message.preemptRunIds ?? [];

      for (const runId of preemptRunIds) {
        const activeRun = activeRuns.get(runId);

        if (activeRun === undefined) {
          continue;
        }

        activeRun.abortReason = "interrupted";
        activeRun.abortController.abort("interrupted");
        logger.info(
          { newRunId: message.run.id, preemptedRunId: runId },
          "Preempting active run before accepting new run",
        );

        await Promise.race([
          activeRun.done,
          new Promise((resolve) => setTimeout(resolve, runPreemptTimeoutMs)),
        ]);
      }

      if (activeRuns.has(message.run.id)) {
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
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const activeRun: ActiveRun = {
        abortController,
        done,
        resolveDone,
      };
      activeRuns.set(message.run.id, activeRun);

      let adapter;

      try {
        adapter = getRuntimeAdapter({
          adapters,
          runtimeKind: message.runtime.runtimeKind,
        });
      } catch (error) {
        send(ws, {
          type: "run.rejected",
          runId: message.run.id,
          reason: error instanceof Error ? error.message : String(error),
          sentAt: nowIsoDateTime(),
        });
        logger.warn(
          {
            err: error,
            runId: message.run.id,
            runtimeKind: message.runtime.runtimeKind,
          },
          "Rejected run because runtime adapter is unavailable",
        );
        activeRuns.delete(message.run.id);
        activeRun.resolveDone();
        return;
      }

      send(ws, {
        type: "run.accepted",
        runId: message.run.id,
        sentAt: nowIsoDateTime(),
      });
      logger.info(
        { runId: message.run.id, workspacePath: message.workspacePath },
        "Accepted daemon run",
      );

      const uploadArtifact = (
        upload: AgentRunArtifactUpload,
      ): Promise<AgentHubUploadArtifactToolResult> => {
        const uploadId = randomUUID();

        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingArtifactUploads.delete(uploadId);
            reject(new Error("Artifact upload timed out."));
          }, artifactUploadTimeoutMs);

          pendingArtifactUploads.set(uploadId, {
            resolve,
            reject,
            timer,
          });
          send(ws, {
            type: "artifact.upload",
            uploadId,
            runId: message.run.id,
            goalId: upload.goalId,
            taskIndex: upload.taskIndex,
            messageTarget: upload.messageTarget,
            kind: upload.kind,
            title: upload.title,
            filename: upload.filename,
            entrypoint: upload.entrypoint,
            files: upload.files,
            sizeBytes: upload.sizeBytes,
            sourcePath: upload.sourcePath,
            contentBase64: upload.contentBase64,
            sentAt: nowIsoDateTime(),
          });
        });
      };

      const callAgentHubMcpTool = (
        call: AgentHubMcpToolCall,
      ): Promise<AgentHubMcpToolResult> => {
        const requestId = randomUUID();

        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingMcpToolCalls.delete(requestId);
            reject(new Error("AgentHub MCP tool call timed out."));
          }, mcpToolCallTimeoutMs);

          pendingMcpToolCalls.set(requestId, {
            resolve,
            reject,
            timer,
          });
          send(ws, {
            type: "agenthub.tool.call",
            requestId,
            call,
            sentAt: nowIsoDateTime(),
          });
        });
      };

      const deployStaticSite = (
        deployment: AgentRunStaticSiteDeploy,
      ): Promise<AgentHubDeployStaticSiteToolResult> => {
        const deploymentId = randomUUID();

        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingStaticSiteDeployments.delete(deploymentId);
            reject(new Error("Static site deployment timed out."));
          }, artifactUploadTimeoutMs);

          pendingStaticSiteDeployments.set(deploymentId, {
            resolve,
            reject,
            timer,
          });
          send(ws, {
            type: "static_site.deploy",
            deploymentId,
            runId: message.run.id,
            goalId: deployment.goalId,
            taskIndex: deployment.taskIndex,
            title: deployment.title,
            entrypoint: deployment.entrypoint,
            files: deployment.files,
            sentAt: nowIsoDateTime(),
          });
        });
      };

      void (async () => {
        try {
          for await (const event of adapter.run({
            run: message.run,
            prompt: message.prompt,
            contextCompression: message.contextCompression,
            agentInstructions: message.agentInstructions,
            workspacePath: message.workspacePath,
            runtime: message.runtime,
            agentHubMcpTools: message.agentHubMcpTools,
            agentHubMcpGoals: message.agentHubMcpGoals,
            uploadArtifact,
            deployStaticSite,
            callAgentHubMcpTool,
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
          activeRun.resolveDone();
          activeRuns.delete(message.run.id);
          logger.info({ runId: message.run.id }, "Daemon run finished");
        }
      })();
    })();
  };

  const connect = (): void => {
    const ws = new WebSocket(
      toDaemonWebSocketUrl(env.AGENTHUB_DAEMON_GATEWAY_URL),
    );

    ws.on("open", async () => {
      reconnectDelayMs = initialReconnectDelayMs;
      let runtimes: DaemonRuntime[] = [];

      for (const adapter of Object.values(adapters)) {
        try {
          runtimes.push({
            ...(await adapter.detect()),
            daemonDeviceId: env.AGENTHUB_DEVICE_ID,
          });
        } catch (error) {
          logger.warn(
            { err: error, runtimeKind: adapter.runtimeKind },
            "Daemon runtime detection failed",
          );
        }
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
        runningRunIds: Array.from(activeRuns.keys()),
        sentAt: nowIsoDateTime(),
      });
    }, 10_000);

    ws.on("message", (data) => {
      handleMessage(ws, data);
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      for (const activeRun of activeRuns.values()) {
        activeRun.abortReason = "cancelled";
        activeRun.abortController.abort("cancelled");
      }
      for (const [uploadId, pending] of pendingArtifactUploads) {
        clearTimeout(pending.timer);
        pendingArtifactUploads.delete(uploadId);
        pending.reject(new Error("Daemon websocket closed during artifact upload."));
      }
      for (const [deploymentId, pending] of pendingStaticSiteDeployments) {
        clearTimeout(pending.timer);
        pendingStaticSiteDeployments.delete(deploymentId);
        pending.reject(new Error("Daemon websocket closed during static site deployment."));
      }
      for (const [requestId, pending] of pendingMcpToolCalls) {
        clearTimeout(pending.timer);
        pendingMcpToolCalls.delete(requestId);
        pending.reject(new Error("Daemon websocket closed during MCP tool call."));
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
