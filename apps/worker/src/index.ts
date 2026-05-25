import { loadWorkerEnv } from "@agent-hub/config";
import {
  ackRunQueueMessage,
  createLogger,
  createAgentHubRedisClient,
  ensureRunQueueGroup,
  publishDaemonAssignment,
  readRunQueueMessages,
} from "@agent-hub/server";

const env = loadWorkerEnv();
const redis = createAgentHubRedisClient(env.REDIS_URL);
const logger = createLogger({
  bindings: {
    consumer: env.AGENTHUB_WORKER_CONSUMER_NAME,
    service: "worker",
  },
});

await redis.connect();
await ensureRunQueueGroup(redis);

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
    await publishDaemonAssignment(redis, message.job);
    await ackRunQueueMessage(redis, message.id);
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

await redis.quit();

