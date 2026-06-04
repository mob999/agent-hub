import { createServer } from "node:http";

import { randomUUID } from "node:crypto";

import { loadWorkerEnv } from "@agent-hub/config";
import type {
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  RealtimeEvent,
  RunEvent,
  ToolCallStatus,
} from "@agent-hub/core";
import { createDb } from "@agent-hub/db";
import {
  ackAgentProvisioningQueueMessage,
  ackArtifactActionQueueMessage,
  ackMemoryAppendQueueMessage,
  ackProjectCloneQueueMessage,
  ackRunQueueMessage,
  appendRunEvent,
  completeConversationArtifactAction,
  createArtifactActionMemoryAppendJobs,
  createArtifactUploadMemoryAppendJobs,
  createAgentHubRedisClient,
  createLogger,
  createRealtimeEvent,
  enqueueRunJob,
  enqueueMemoryAppendJob,
  ensureAgentProvisioningQueueGroup,
  ensureArtifactActionQueueGroup,
  ensureMemoryAppendQueueGroup,
  ensureProjectCloneQueueGroup,
  ensureRunQueueGroup,
  getArtifactActionAssignment,
  getConversationForUser,
  getRunById,
  markConversationArtifactActionRunning,
  markAgentProvisioningFailed,
  markAgentProvisioningReady,
  markProjectCloneFailed,
  markProjectCloneReady,
  persistProjectChange,
  persistConversationArtifactUpload,
  persistStaticSiteDeployment,
  publishRealtimeEvent,
  readAgentProvisioningQueueMessages,
  readArtifactActionQueueMessages,
  readMemoryAppendQueueMessages,
  readProjectCloneQueueMessages,
  readRunQueueMessages,
  setDaemonRuntimesStatus,
  updateProjectChangeStatus,
  upsertDaemonRuntime,
  upsertDaemonDevice,
} from "@agent-hub/server";

import { DaemonGateway } from "./daemon/gateway.js";

const env = loadWorkerEnv();
const db = createDb(env.DATABASE_URL);
const redis = createAgentHubRedisClient(env.REDIS_URL);
const logger = createLogger({
  bindings: {
    consumer: env.AGENTHUB_WORKER_CONSUMER_NAME,
    service: "worker",
  },
});

async function publishConversationUpdated(input: {
  conversationId: string;
  ownerUserId: string;
}): Promise<void> {
  const conversation = await getConversationForUser(db, input);

  await publishRealtimeEvents([
    createRealtimeEvent({
      conversation: conversation ?? undefined,
      conversationId: input.conversationId,
      ownerUserId: input.ownerUserId,
      type: "conversation.updated",
    }),
  ]);
}

async function publishRealtimeEvents(events: RealtimeEvent[]): Promise<void> {
  await Promise.all(
    events.map(async (event) => {
      try {
        await publishRealtimeEvent(redis, event);
      } catch (error) {
        logger.warn(
          { err: error, eventId: event.eventId, type: event.type },
          "Failed to publish realtime event",
        );
      }
    }),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function processRunAppendResult(
  result: Awaited<ReturnType<typeof appendRunEvent>>,
): Promise<void> {
  await publishRealtimeEvents(result.realtimeEvents);
  await Promise.all(result.dispatchJobs.map((job) => enqueueRunJob(redis, job)));
  await Promise.all(result.memoryAppendJobs.map((job) => enqueueMemoryAppendJob(redis, job)));
  await Promise.all(
    result.projectMergeRequests.map(async (request) => {
      const assigned = gateway.assignProjectChangeMerge({
        type: "project.change.merge",
        requestId: randomUUID(),
        changeId: request.changeId,
        baseRepoPath: request.baseRepoPath,
        branchName: request.branchName,
        daemonDeviceId: request.daemonDeviceId,
        message: request.message,
        sentAt: new Date().toISOString(),
      });

      if (assigned) {
        return;
      }

      await updateProjectChangeStatus(db, {
        changeId: request.changeId,
        status: "failed",
        summary: "Project change merge failed because the target daemon is offline.",
      });
    }),
  );
}

async function appendAgentHubToolResultEvent(input: {
  error?: string;
  name?: AgentHubMcpToolName;
  output?: AgentHubMcpToolResult;
  runId: string;
  status: ToolCallStatus;
  toolCallId: string;
}): Promise<void> {
  const event: RunEvent = {
    type: "agenthub.tool.result",
    runId: input.runId,
    toolCallId: input.toolCallId,
    name: input.name,
    status: input.status,
    output: input.output,
    error: input.error,
    createdAt: new Date().toISOString(),
  };
  const result = await appendRunEvent(db, event, {
    publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
    publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
    storageRoot: env.AGENTHUB_STORAGE_ROOT,
  });
  await processRunAppendResult(result);
}

const gateway = new DaemonGateway({
  daemonToken: env.AGENTHUB_DAEMON_TOKEN,
  logger,
  onDaemonConnected: async (deviceId, runtimes) => {
    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "online",
    });
    await Promise.all(
      runtimes.map((runtime) =>
        upsertDaemonRuntime(db, {
          ...runtime,
          daemonDeviceId: deviceId,
          status: "ready",
        }),
      ),
    );
  },
  onDaemonDisconnected: async (deviceId) => {
    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "offline",
    });
    await setDaemonRuntimesStatus(db, {
      daemonDeviceId: deviceId,
      status: "unavailable",
    });
  },
  onRunEvent: async (event) => {
    const result = await appendRunEvent(db, event, {
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
    });
    await processRunAppendResult(result);
  },
  onAgentHubToolCall: async (message) => {
    try {
      const result = await appendRunEvent(db, {
        type: "agenthub.tool.call",
        runId: message.call.runId,
        toolCallId: message.call.toolCallId,
        name: message.call.name,
        input: message.call.input,
        createdAt: message.call.createdAt,
      }, {
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
        publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
        storageRoot: env.AGENTHUB_STORAGE_ROOT,
      });
      await processRunAppendResult(result);

      if (result.toolResult !== undefined) {
        await appendAgentHubToolResultEvent({
          runId: message.call.runId,
          toolCallId: message.call.toolCallId,
          name: message.call.name,
          status: "succeeded",
          output: result.toolResult,
        }).catch((error) => {
          logger.warn(
            {
              err: toError(error),
              runId: message.call.runId,
              toolName: message.call.name,
            },
            "Failed to persist AgentHub MCP tool result",
          );
        });
        return result.toolResult;
      }

      throw new Error(`AgentHub MCP tool call was not accepted: ${message.call.name}`);
    } catch (error) {
      const err = toError(error);
      await appendAgentHubToolResultEvent({
        runId: message.call.runId,
        toolCallId: message.call.toolCallId,
        name: message.call.name,
        status: "failed",
        error: err.message,
      }).catch((appendError) => {
        logger.warn(
          {
            err: toError(appendError),
            runId: message.call.runId,
            toolName: message.call.name,
          },
          "Failed to persist failed AgentHub MCP tool result",
        );
      });
      throw err;
    }
  },
  onArtifactUpload: async (message) => {
    const artifact = await persistConversationArtifactUpload(db, {
      contentBase64: message.contentBase64,
      entrypoint: message.entrypoint,
      filename: message.filename,
      files: message.files,
      kind: message.kind,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      runId: message.runId,
      messageTarget: message.messageTarget,
      sizeBytes: message.sizeBytes,
      sourcePath: message.sourcePath,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
      goalId: message.goalId,
      taskIndex: message.taskIndex,
      title: message.title,
    });
    const memoryAppendJobs = await createArtifactUploadMemoryAppendJobs(db, {
      artifact,
    });
    await publishRealtimeEvents([
      createRealtimeEvent({
        artifact,
        conversationId: artifact.conversationId,
        ownerUserId: artifact.ownerUserId,
        type: "artifact.created",
      }),
    ]);
    await Promise.all(memoryAppendJobs.map((job) => enqueueMemoryAppendJob(redis, job)));

    return artifact;
  },
  onStaticSiteDeploy: async (message) => {
    return persistStaticSiteDeployment(db, {
      entrypoint: message.entrypoint,
      files: message.files,
      goalId: message.goalId,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      runId: message.runId,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
      taskIndex: message.taskIndex,
      title: message.title,
    });
  },
  onArtifactActionCompleted: async (message) => {
    const result = await completeConversationArtifactAction(db, {
      actionId: message.actionId,
      error: message.error,
      result: message.result,
      status: message.status,
    });
    if (result !== null) {
      const memoryAppendJobs = await createArtifactActionMemoryAppendJobs(db, {
        action: result.action,
      });
      await publishRealtimeEvents([
        createRealtimeEvent({
          action: result.action,
          artifactId: result.action.artifactId,
          conversationId: result.conversationId,
          ownerUserId: result.ownerUserId,
          type: "artifact.action.updated",
        }),
      ]);
      await Promise.all(memoryAppendJobs.map((job) => enqueueMemoryAppendJob(redis, job)));
    }
  },
  onMemoryAppended: async (message) => {
    logger.info(
      { file: message.file, requestId: message.requestId },
      "Memory append completed",
    );
  },
  onMemoryAppendFailed: async (message) => {
    logger.warn(
      { reason: message.reason, requestId: message.requestId },
      "Memory append rejected by daemon",
    );
  },
  onProjectCloneCompleted: async (message) => {
    const result = await markProjectCloneReady(db, {
      conversationId: message.conversationId,
      baseRepoPath: message.baseRepoPath,
      defaultBranch: message.defaultBranch,
      baseHead: message.baseHead,
    });
    if (result.status === "updated") {
      await publishConversationUpdated({
        conversationId: result.project.conversationId,
        ownerUserId: result.project.ownerUserId,
      });
    }
    logger.info(
      {
        baseRepoPath: message.baseRepoPath,
        conversationId: message.conversationId,
      },
      "Project clone completed",
    );
  },
  onProjectCloneFailed: async (message) => {
    const result = await markProjectCloneFailed(db, {
      conversationId: message.conversationId,
      error: message.reason,
    });
    if (result.status === "updated") {
      await publishConversationUpdated({
        conversationId: result.project.conversationId,
        ownerUserId: result.project.ownerUserId,
      });
    }
    logger.warn(
      {
        conversationId: message.conversationId,
        reason: message.reason,
      },
      "Project clone failed",
    );
  },
  onProjectChangeCreated: async (message) => {
    const change = await persistProjectChange(db, {
      change: message.change,
      diff: message.diff,
    });
    await publishRealtimeEvents([
      createRealtimeEvent({
        conversationId: change.conversationId,
        ownerUserId: change.ownerUserId,
        type: "conversation.updated",
      }),
    ]);
    logger.info(
      {
        changeId: message.change.id,
        conversationId: message.change.conversationId,
      },
      "Project change created",
    );
  },
  onProjectChangeMergeAck: async (message) => {
    const change = await updateProjectChangeStatus(db, {
      changeId: message.changeId,
      status: "merged",
    });
    if (change !== null) {
      await publishRealtimeEvents([
        createRealtimeEvent({
          conversationId: change.conversationId,
          ownerUserId: change.ownerUserId,
          type: "conversation.updated",
        }),
      ]);
    }
    logger.info({ changeId: message.changeId }, "Project change merge acked");
  },
  onProjectChangeMergeRejected: async (message) => {
    const change = await updateProjectChangeStatus(db, {
      changeId: message.changeId,
      status: "failed",
      summary: message.reason,
    });
    if (change !== null) {
      await publishRealtimeEvents([
        createRealtimeEvent({
          conversationId: change.conversationId,
          ownerUserId: change.ownerUserId,
          type: "conversation.updated",
        }),
      ]);
    }
    logger.warn(
      { changeId: message.changeId, reason: message.reason },
      "Project change merge rejected",
    );
  },
});
const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
});

server.on("upgrade", (request, socket, head) => {
  if (!gateway.handleUpgrade(request, socket, head)) {
    socket.destroy();
  }
});

await redis.connect();
await ensureRunQueueGroup(redis);
await ensureAgentProvisioningQueueGroup(redis);
await ensureArtifactActionQueueGroup(redis);
await ensureMemoryAppendQueueGroup(redis);
await ensureProjectCloneQueueGroup(redis);
await new Promise<void>((resolve) => {
  server.listen(env.WORKER_PORT, resolve);
});

logger.info(
  { port: env.WORKER_PORT, url: `http://localhost:${env.WORKER_PORT}` },
  "Worker gateway listening",
);
logger.info("Worker listening for run jobs");

let shuttingDown = false;

function requestShutdown(): void {
  shuttingDown = true;
}

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);

while (!shuttingDown) {
  const agentMessages = await readAgentProvisioningQueueMessages(
    redis,
    env.AGENTHUB_WORKER_CONSUMER_NAME,
    {
      count: 5,
      blockMs: 500,
    },
  );

  for (const message of agentMessages) {
    try {
      const result = await gateway.provisionAgent(message.job);
      if (result.workspace.workspacePath === undefined) {
        throw new Error("Daemon did not return an agent workspace path.");
      }

      await markAgentProvisioningReady(db, {
        agentId: message.job.agent.id,
        daemonDeviceId: message.job.daemonDeviceId,
        workspacePath: result.workspace.workspacePath,
        runtime: result.runtime,
        updatedAt: new Date(result.sentAt),
      });
      logger.info(
        {
          agentId: message.job.agent.id,
          messageId: message.id,
        },
        "Provisioned agent workspace",
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await markAgentProvisioningFailed(db, {
        agentId: message.job.agent.id,
        error: errorMessage,
      });
      logger.error(
        {
          err: error,
          agentId: message.job.agent.id,
          messageId: message.id,
        },
        "Failed to provision agent workspace",
      );
    }

    await ackAgentProvisioningQueueMessage(redis, message.id);
  }

  const projectCloneMessages = await readProjectCloneQueueMessages(
    redis,
    env.AGENTHUB_WORKER_CONSUMER_NAME,
    {
      count: 5,
      blockMs: 500,
    },
  );

  for (const message of projectCloneMessages) {
    const assigned = gateway.assignProjectClone({
      type: "project.clone",
      requestId: message.id,
      conversationId: message.job.conversationId,
      daemonDeviceId: message.job.daemonDeviceId,
      remoteUrl: message.job.remoteUrl,
      sentAt: new Date().toISOString(),
    });

    if (!assigned) {
      const result = await markProjectCloneFailed(db, {
        conversationId: message.job.conversationId,
        error: `Daemon ${message.job.daemonDeviceId} is not connected.`,
      });
      if (result.status === "updated") {
        await publishConversationUpdated({
          conversationId: result.project.conversationId,
          ownerUserId: result.project.ownerUserId,
        });
      }
      logger.warn(
        {
          conversationId: message.job.conversationId,
          daemonDeviceId: message.job.daemonDeviceId,
        },
        "Failed to assign project clone because daemon is offline",
      );
    }

    await ackProjectCloneQueueMessage(redis, message.id);
  }

  const messages = await readRunQueueMessages(
    redis,
    env.AGENTHUB_WORKER_CONSUMER_NAME,
    {
      count: 5,
      blockMs: 500,
    },
  );

  for (const message of messages) {
    const run = await getRunById(db, message.job.run.id);

    if (run === null || run.status !== "queued") {
      await ackRunQueueMessage(redis, message.id);
      logger.info(
        {
          messageId: message.id,
          runId: message.job.run.id,
          status: run?.status ?? "missing",
        },
        "Skipped stale run queue job",
      );
      continue;
    }

    const assigned = gateway.assignRun(message.job);

    if (!assigned) {
      const result = await appendRunEvent(
        db,
        {
          type: "run.completed",
          runId: message.job.run.id,
          status: "failed",
          error: `Daemon ${message.job.daemonDeviceId} is not connected.`,
          createdAt: new Date().toISOString(),
        },
        {
          publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
          publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
          storageRoot: env.AGENTHUB_STORAGE_ROOT,
        },
      );
      await publishRealtimeEvents(result.realtimeEvents);
      await Promise.all(result.dispatchJobs.map((job) => enqueueRunJob(redis, job)));
      await Promise.all(result.memoryAppendJobs.map((job) => enqueueMemoryAppendJob(redis, job)));
    }

    await ackRunQueueMessage(redis, message.id);
    if (assigned) {
      logger.info(
        {
          daemonDeviceId: message.job.daemonDeviceId,
          messageId: message.id,
          runId: message.job.run.id,
        },
        "Dispatched run to daemon",
      );
    }
  }

  const artifactActionMessages = await readArtifactActionQueueMessages(
    redis,
    env.AGENTHUB_WORKER_CONSUMER_NAME,
    {
      count: 5,
      blockMs: 500,
    },
  );

  for (const message of artifactActionMessages) {
    try {
      const assignment = await getArtifactActionAssignment(db, {
        actionId: message.job.actionId,
        storageRoot: env.AGENTHUB_STORAGE_ROOT,
      });

      if (assignment === null) {
        const result = await completeConversationArtifactAction(db, {
          actionId: message.job.actionId,
          error: "Artifact action assignment was not found.",
          status: "failed",
        });
        if (result !== null) {
          await publishRealtimeEvents([
            createRealtimeEvent({
              action: result.action,
              artifactId: result.action.artifactId,
              conversationId: result.conversationId,
              ownerUserId: result.ownerUserId,
              type: "artifact.action.updated",
            }),
          ]);
        }
        await ackArtifactActionQueueMessage(redis, message.id);
        continue;
      }

      const runningAction = await markConversationArtifactActionRunning(db, {
        actionId: message.job.actionId,
      });
      if (runningAction !== null) {
        await publishRealtimeEvents([
          createRealtimeEvent({
            action: runningAction.action,
            artifactId: runningAction.action.artifactId,
            conversationId: runningAction.conversationId,
            ownerUserId: runningAction.ownerUserId,
            type: "artifact.action.updated",
          }),
        ]);
      }

      const assigned = gateway.assignArtifactAction({
        type: "artifact.action.assigned",
        actionId: assignment.actionId,
        actionType: assignment.actionType,
        artifactId: assignment.artifactId,
        contentBase64: assignment.contentBase64,
        daemonDeviceId: assignment.daemonDeviceId,
        filename: assignment.filename,
        sentAt: new Date().toISOString(),
        sourcePath: assignment.sourcePath,
        workspacePath: assignment.workspacePath,
      });

      if (!assigned) {
        const result = await completeConversationArtifactAction(db, {
          actionId: message.job.actionId,
          error: `Daemon ${assignment.daemonDeviceId} is not connected.`,
          status: "failed",
        });
        if (result !== null) {
          await publishRealtimeEvents([
            createRealtimeEvent({
              action: result.action,
              artifactId: result.action.artifactId,
              conversationId: result.conversationId,
              ownerUserId: result.ownerUserId,
              type: "artifact.action.updated",
            }),
          ]);
        }
      }

      await ackArtifactActionQueueMessage(redis, message.id);
      logger.info(
        {
          actionId: message.job.actionId,
          actionType: message.job.actionType,
          daemonDeviceId: assignment.daemonDeviceId,
          messageId: message.id,
        },
        assigned
          ? "Dispatched artifact action to daemon"
          : "Failed to dispatch artifact action to daemon",
      );
    } catch (error) {
      const result = await completeConversationArtifactAction(db, {
        actionId: message.job.actionId,
        error: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
      if (result !== null) {
        await publishRealtimeEvents([
          createRealtimeEvent({
            action: result.action,
            artifactId: result.action.artifactId,
            conversationId: result.conversationId,
            ownerUserId: result.ownerUserId,
            type: "artifact.action.updated",
          }),
        ]);
      }
      await ackArtifactActionQueueMessage(redis, message.id);
      logger.error(
        {
          err: error,
          actionId: message.job.actionId,
          messageId: message.id,
        },
        "Failed to process artifact action queue message",
      );
    }
  }

  const memoryMessages = await readMemoryAppendQueueMessages(
    redis,
    env.AGENTHUB_WORKER_CONSUMER_NAME,
    {
      count: 10,
      blockMs: 500,
    },
  );

  for (const message of memoryMessages) {
    const assigned = gateway.assignMemoryAppend({
      type: "memory.append",
      requestId: message.id,
      workspacePath: message.job.workspacePath,
      kind: message.job.kind,
      title: message.job.title,
      content: message.job.content,
      tags: message.job.tags,
      date: message.job.date,
      dedupeKey: message.job.dedupeKey,
      sentAt: new Date().toISOString(),
      daemonDeviceId: message.job.daemonDeviceId,
    });

    if (assigned) {
      await ackMemoryAppendQueueMessage(redis, message.id);
      logger.info(
        {
          agentId: message.job.agentId,
          daemonDeviceId: message.job.daemonDeviceId,
          kind: message.job.kind,
          messageId: message.id,
        },
        "Dispatched memory append to daemon",
      );
    }
  }
}

server.close();
await redis.quit();
