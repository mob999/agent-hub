import type { ConversationId, DaemonDeviceId } from "@agent-hub/core";

import type { AgentHubRedisClient } from "./run-queue.js";

export const projectCloneQueueStream = "agenthub:project:clone";
export const projectCloneQueueGroup = "agenthub-project-workers";

export interface ProjectCloneJob {
  conversationId: ConversationId;
  daemonDeviceId: DaemonDeviceId;
  remoteUrl: string;
}

export interface ProjectCloneQueueMessage {
  id: string;
  job: ProjectCloneJob;
}

export async function enqueueProjectCloneJob(
  redis: AgentHubRedisClient,
  job: ProjectCloneJob,
): Promise<string> {
  return redis.xAdd(projectCloneQueueStream, "*", {
    payload: JSON.stringify(job),
  });
}

export async function ensureProjectCloneQueueGroup(
  redis: AgentHubRedisClient,
): Promise<void> {
  try {
    await redis.xGroupCreate(projectCloneQueueStream, projectCloneQueueGroup, "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("BUSYGROUP")) {
      return;
    }

    throw error;
  }
}

export async function readProjectCloneQueueMessages(
  redis: AgentHubRedisClient,
  consumerName: string,
  options: { blockMs?: number; count?: number } = {},
): Promise<ProjectCloneQueueMessage[]> {
  const response = await redis.xReadGroup(
    projectCloneQueueGroup,
    consumerName,
    {
      key: projectCloneQueueStream,
      id: ">",
    },
    {
      BLOCK: options.blockMs ?? 1000,
      COUNT: options.count ?? 5,
    },
  );

  if (response === null) {
    return [];
  }

  return response.flatMap((stream) =>
    stream.messages.map((message) => {
      const payload = message.message.payload;

      if (typeof payload !== "string") {
        throw new Error(`Invalid project clone payload for message ${message.id}`);
      }

      return {
        id: message.id,
        job: JSON.parse(payload) as ProjectCloneJob,
      };
    }),
  );
}

export async function ackProjectCloneQueueMessage(
  redis: AgentHubRedisClient,
  messageId: string,
): Promise<void> {
  await redis.xAck(projectCloneQueueStream, projectCloneQueueGroup, messageId);
}
