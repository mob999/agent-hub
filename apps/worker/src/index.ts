import { createServer } from "node:http";

import { loadWorkerEnv } from "@agent-hub/config";
import { createDb } from "@agent-hub/db";
import {
  ackRunQueueMessage,
  appendRunEvent,
  createLogger,
  createAgentHubRedisClient,
  ensureRunQueueGroup,
  readRunQueueMessages,
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
  onDaemonConnected: async (deviceId) => {
    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "online",
    });
  },
  onDaemonDisconnected: async (deviceId) => {
    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "offline",
    });
  },
  onRunEvent: async (event) => {
    await appendRunEvent(db, event);
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
  const messages = await readRunQueueMessages(
    redis,
    env.AGENTHUB_WORKER_CONSUMER_NAME,
    {
      count: 5,
      blockMs: 5000,
    },
  );

  for (const message of messages) {
    const assigned = gateway.assignRun(message.job);

    if (!assigned) {
      await appendRunEvent(db, {
        type: "run.completed",
        runId: message.job.run.id,
        status: "failed",
        error: `Daemon ${message.job.daemonDeviceId} is not connected.`,
        createdAt: new Date().toISOString(),
      });
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

