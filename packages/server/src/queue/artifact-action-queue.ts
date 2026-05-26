import type {
  ConversationArtifactActionId,
  ConversationArtifactActionType,
  ConversationArtifactId,
  ConversationArtifactRevisionId,
  DaemonDeviceId,
} from "@agent-hub/core";

import type { AgentHubRedisClient } from "./run-queue.js";

export const artifactActionQueueStream = "agenthub:artifact-action:queue";
export const artifactActionQueueGroup = "agenthub-workers";

export interface ArtifactActionQueueJob {
  actionId: ConversationArtifactActionId;
  actionType: ConversationArtifactActionType;
  artifactId: ConversationArtifactId;
  daemonDeviceId: DaemonDeviceId;
  revisionId?: ConversationArtifactRevisionId;
  workspacePath: string;
}

export interface ArtifactActionQueueMessage {
  id: string;
  job: ArtifactActionQueueJob;
}

export async function enqueueArtifactActionJob(
  redis: AgentHubRedisClient,
  job: ArtifactActionQueueJob,
): Promise<string> {
  return redis.xAdd(artifactActionQueueStream, "*", {
    payload: JSON.stringify(job),
  });
}

export async function ensureArtifactActionQueueGroup(
  redis: AgentHubRedisClient,
): Promise<void> {
  try {
    await redis.xGroupCreate(artifactActionQueueStream, artifactActionQueueGroup, "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("BUSYGROUP")) {
      return;
    }

    throw error;
  }
}

export async function readArtifactActionQueueMessages(
  redis: AgentHubRedisClient,
  consumerName: string,
  options: { count?: number; blockMs?: number } = {},
): Promise<ArtifactActionQueueMessage[]> {
  const response = await redis.xReadGroup(
    artifactActionQueueGroup,
    consumerName,
    {
      key: artifactActionQueueStream,
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
        throw new Error(
          `Invalid artifact action queue payload for message ${message.id}`,
        );
      }

      return {
        id: message.id,
        job: JSON.parse(payload) as ArtifactActionQueueJob,
      };
    }),
  );
}

export async function ackArtifactActionQueueMessage(
  redis: AgentHubRedisClient,
  messageId: string,
): Promise<void> {
  await redis.xAck(artifactActionQueueStream, artifactActionQueueGroup, messageId);
}
