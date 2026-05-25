import { createClient, type RedisClientType } from "redis";

import type {
  DaemonDeviceId,
  DaemonRunAssignment,
} from "@agent-hub/core";

export const runQueueStream = "agenthub:run:queue";
export const runQueueGroup = "agenthub-workers";

export interface RunQueueJob extends DaemonRunAssignment {
  daemonDeviceId: DaemonDeviceId;
}

export interface RunQueueMessage {
  id: string;
  job: RunQueueJob;
}

export type AgentHubRedisClient = RedisClientType;

export function createAgentHubRedisClient(redisUrl: string): AgentHubRedisClient {
  return createClient({ url: redisUrl });
}

export async function enqueueRunJob(
  redis: AgentHubRedisClient,
  job: RunQueueJob,
): Promise<string> {
  return redis.xAdd(runQueueStream, "*", {
    payload: JSON.stringify(job),
  });
}

export async function ensureRunQueueGroup(
  redis: AgentHubRedisClient,
): Promise<void> {
  try {
    await redis.xGroupCreate(runQueueStream, runQueueGroup, "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("BUSYGROUP")
    ) {
      return;
    }

    throw error;
  }
}

export async function readRunQueueMessages(
  redis: AgentHubRedisClient,
  consumerName: string,
  options: { count?: number; blockMs?: number } = {},
): Promise<RunQueueMessage[]> {
  const response = await redis.xReadGroup(
    runQueueGroup,
    consumerName,
    {
      key: runQueueStream,
      id: ">",
    },
    {
      COUNT: options.count ?? 5,
      BLOCK: options.blockMs ?? 5000,
    },
  );

  if (response === null) {
    return [];
  }

  return response.flatMap((stream) =>
    stream.messages.map((message) => {
      const payload = message.message.payload;

      if (typeof payload !== "string") {
        throw new Error(`Invalid run queue payload for message ${message.id}`);
      }

      return {
        id: message.id,
        job: JSON.parse(payload) as RunQueueJob,
      };
    }),
  );
}

export async function ackRunQueueMessage(
  redis: AgentHubRedisClient,
  messageId: string,
): Promise<void> {
  await redis.xAck(runQueueStream, runQueueGroup, messageId);
}
