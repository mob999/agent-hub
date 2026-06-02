import { createServer } from "node:http";

import { loadWorkerEnv } from "@agent-hub/config";
import type { RealtimeEvent } from "@agent-hub/core";
import { createDb } from "@agent-hub/db";
import {
  ackAgentProvisioningQueueMessage,
  ackArtifactActionQueueMessage,
  ackMemoryAppendQueueMessage,
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
  ensureRunQueueGroup,
  getArtifactActionAssignment,
  markConversationArtifactActionRunning,
  markAgentProvisioningFailed,
  markAgentProvisioningReady,
  persistConversationArtifactUpload,
  persistStaticSiteDeployment,
  publishRealtimeEvent,
  readAgentProvisioningQueueMessages,
  readArtifactActionQueueMessages,
  readMemoryAppendQueueMessages,
  readRunQueueMessages,
  setDaemonRuntimesStatus,
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
    await publishRealtimeEvents(result.realtimeEvents);
    await Promise.all(result.dispatchJobs.map((job) => enqueueRunJob(redis, job)));
    await Promise.all(result.memoryAppendJobs.map((job) => enqueueMemoryAppendJob(redis, job)));
  },
  onAgentHubToolCall: async (message) => {
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
    await publishRealtimeEvents(result.realtimeEvents);
    await Promise.all(result.dispatchJobs.map((job) => enqueueRunJob(redis, job)));
    await Promise.all(result.memoryAppendJobs.map((job) => enqueueMemoryAppendJob(redis, job)));

    if (result.toolResult !== undefined) {
      return result.toolResult;
    }

    throw new Error(`AgentHub MCP tool call was not accepted: ${message.call.name}`);
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

  const messages = await readRunQueueMessages(
    redis,
    env.AGENTHUB_WORKER_CONSUMER_NAME,
    {
      count: 5,
      blockMs: 500,
    },
  );

  for (const message of messages) {
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
