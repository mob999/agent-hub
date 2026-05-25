import { loadWorkerEnv } from "@agent-hub/config";
import {
  ackRunQueueMessage,
  createAgentHubRedisClient,
  ensureRunQueueGroup,
  publishDaemonAssignment,
  readRunQueueMessages,
} from "@agent-hub/server";

const env = loadWorkerEnv();
const redis = createAgentHubRedisClient(env.REDIS_URL);

await redis.connect();
await ensureRunQueueGroup(redis);

console.log(
  `Worker ${env.AGENTHUB_WORKER_CONSUMER_NAME} listening for run jobs`,
);

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
    console.log(
      `Dispatched run ${message.job.run.id} to daemon ${message.job.daemonDeviceId}`,
    );
  }
}

await redis.quit();

