import type {
  AgentId,
  DaemonDeviceId,
  IsoDateTime,
} from "@agent-hub/core";

import type { AgentHubRedisClient } from "./run-queue.js";

export const memoryAppendQueueStream = "agenthub:memory:append";
export const memoryAppendQueueGroup = "agenthub-memory-workers";

export interface MemoryAppendQueueJob {
  agentId: AgentId;
  daemonDeviceId: DaemonDeviceId;
  workspacePath: string;
  kind: "daily" | "transcript";
  title?: string;
  content: string;
  tags?: string[];
  date?: string;
  dedupeKey?: string;
  createdAt: IsoDateTime;
}

export interface MemoryAppendQueueMessage {
  id: string;
  job: MemoryAppendQueueJob;
}

export async function enqueueMemoryAppendJob(
  redis: AgentHubRedisClient,
  job: MemoryAppendQueueJob,
): Promise<string> {
  return redis.xAdd(memoryAppendQueueStream, "*", {
    payload: JSON.stringify(job),
  });
}

export async function ensureMemoryAppendQueueGroup(
  redis: AgentHubRedisClient,
): Promise<void> {
  try {
    await redis.xGroupCreate(memoryAppendQueueStream, memoryAppendQueueGroup, "0", {
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

export async function readMemoryAppendQueueMessages(
  redis: AgentHubRedisClient,
  consumerName: string,
  options: { count?: number; blockMs?: number } = {},
): Promise<MemoryAppendQueueMessage[]> {
  const response = await redis.xReadGroup(
    memoryAppendQueueGroup,
    consumerName,
    {
      key: memoryAppendQueueStream,
      id: ">",
    },
    {
      COUNT: options.count ?? 10,
      BLOCK: options.blockMs ?? 1000,
    },
  );

  return response?.flatMap((stream) =>
    stream.messages.flatMap((message) => {
      const payload = message.message.payload;

      return typeof payload === "string"
        ? [{ id: message.id, job: JSON.parse(payload) as MemoryAppendQueueJob }]
        : [];
    })
  ) ?? [];
}

export async function ackMemoryAppendQueueMessage(
  redis: AgentHubRedisClient,
  id: string,
): Promise<void> {
  await redis.xAck(memoryAppendQueueStream, memoryAppendQueueGroup, id);
}
