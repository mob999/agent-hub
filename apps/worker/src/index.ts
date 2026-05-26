import { createServer } from "node:http";

import { loadWorkerEnv } from "@agent-hub/config";
import { createDb } from "@agent-hub/db";
import {
  ackAgentProvisioningQueueMessage,
  ackRunQueueMessage,
  appendRunEvent,
  createLogger,
  createAgentHubRedisClient,
  enqueueRunJob,
  ensureAgentProvisioningQueueGroup,
  ensureRunQueueGroup,
  markAgentProvisioningFailed,
  markAgentProvisioningReady,
  persistConversationArtifactUpload,
  readAgentProvisioningQueueMessages,
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
    });
    await Promise.all(result.dispatchJobs.map((job) => enqueueRunJob(redis, job)));
  },
  onArtifactUpload: async (message) =>
    persistConversationArtifactUpload(db, {
      contentBase64: message.contentBase64,
      filename: message.filename,
      mimeType: message.mimeType,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      runId: message.runId,
      sizeBytes: message.sizeBytes,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
      taskId: message.taskId,
      title: message.title,
    }),
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
        { publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL },
      );
      await Promise.all(result.dispatchJobs.map((job) => enqueueRunJob(redis, job)));
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
}

server.close();
await redis.quit();
