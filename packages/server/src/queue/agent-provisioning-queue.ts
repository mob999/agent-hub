import type {
  AgentDetails,
  AgentRuntimeConfig,
  DaemonDeviceId,
} from "@agent-hub/core";

import type { AgentHubRedisClient } from "./run-queue.js";

export const agentProvisioningQueueStream = "agenthub:agent:provisioning";
export const agentProvisioningQueueGroup = "agenthub-agent-workers";

export interface AgentProvisioningJob {
  agent: AgentDetails["agent"];
  daemonDeviceId: DaemonDeviceId;
  runtime: AgentRuntimeConfig;
}

export interface AgentProvisioningQueueMessage {
  id: string;
  job: AgentProvisioningJob;
}

export async function enqueueAgentProvisioningJob(
  redis: AgentHubRedisClient,
  job: AgentProvisioningJob,
): Promise<string> {
  return redis.xAdd(agentProvisioningQueueStream, "*", {
    payload: JSON.stringify(job),
  });
}

export async function ensureAgentProvisioningQueueGroup(
  redis: AgentHubRedisClient,
): Promise<void> {
  try {
    await redis.xGroupCreate(
      agentProvisioningQueueStream,
      agentProvisioningQueueGroup,
      "0",
      {
        MKSTREAM: true,
      },
    );
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

export async function readAgentProvisioningQueueMessages(
  redis: AgentHubRedisClient,
  consumerName: string,
  options: { count?: number; blockMs?: number } = {},
): Promise<AgentProvisioningQueueMessage[]> {
  const response = await redis.xReadGroup(
    agentProvisioningQueueGroup,
    consumerName,
    {
      key: agentProvisioningQueueStream,
      id: ">",
    },
    {
      COUNT: options.count ?? 5,
      BLOCK: options.blockMs ?? 1000,
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
          `Invalid agent provisioning payload for message ${message.id}`,
        );
      }

      return {
        id: message.id,
        job: JSON.parse(payload) as AgentProvisioningJob,
      };
    }),
  );
}

export async function ackAgentProvisioningQueueMessage(
  redis: AgentHubRedisClient,
  messageId: string,
): Promise<void> {
  await redis.xAck(agentProvisioningQueueStream, agentProvisioningQueueGroup, messageId);
}
