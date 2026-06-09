import type {
  ConversationProjectChangeId,
  DaemonDeviceId,
  DaemonProjectChangedFile,
  DaemonProjectFileEntry,
} from "@agent-hub/core";

import type { AgentHubRedisClient } from "./run-queue.js";

export const daemonRpcQueueStream = "agenthub:daemon-rpc:requests";
export const daemonRpcQueueGroup = "agenthub-daemon-rpc-workers";
export const daemonRpcResponseKeyPrefix = "agenthub:daemon-rpc:response:";
export const daemonRpcResponseTtlSeconds = 30;

export type DaemonProjectRpcOperation =
  | {
      type: "project.files.list";
      baseRepoPath: string;
    }
  | {
      type: "project.file.read";
      baseRepoPath: string;
      path: string;
    }
  | {
      type: "project.file.write";
      baseRepoPath: string;
      content: string;
      path: string;
    }
  | {
      type: "project.change.files.list";
      baseCommit?: string;
      headCommit?: string;
      worktreePath: string;
    }
  | {
      type: "project.change.file.read";
      baseCommit?: string;
      headCommit?: string;
      path: string;
      worktreePath: string;
    };

export interface DaemonRpcJob {
  daemonDeviceId: DaemonDeviceId;
  operation: DaemonProjectRpcOperation;
  requestId: string;
}

export interface DaemonRpcQueueMessage {
  id: string;
  job: DaemonRpcJob;
}

export type DaemonRpcResult =
  | {
      type: "project.files.list";
      files: DaemonProjectFileEntry[];
    }
  | {
      type: "project.file.read";
      contentBase64: string;
      sizeBytes: number;
    }
  | {
      type: "project.file.write";
      baseHead?: string;
    }
  | {
      type: "project.change.files.list";
      files: DaemonProjectChangedFile[];
    }
  | {
      type: "project.change.file.read";
      binary: boolean;
      file: DaemonProjectChangedFile;
      newContent: string;
      oldContent: string;
    };

export type DaemonRpcResponse =
  | {
      ok: true;
      result: DaemonRpcResult;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export function daemonRpcResponseKey(requestId: string): string {
  return `${daemonRpcResponseKeyPrefix}${requestId}`;
}

export async function enqueueDaemonRpcJob(
  redis: AgentHubRedisClient,
  job: DaemonRpcJob,
): Promise<string> {
  return redis.xAdd(daemonRpcQueueStream, "*", {
    payload: JSON.stringify(job),
  });
}

export async function writeDaemonRpcResponse(
  redis: AgentHubRedisClient,
  requestId: string,
  response: DaemonRpcResponse,
): Promise<void> {
  await redis.set(daemonRpcResponseKey(requestId), JSON.stringify(response), {
    EX: daemonRpcResponseTtlSeconds,
  });
}

export async function readDaemonRpcResponse(
  redis: AgentHubRedisClient,
  requestId: string,
): Promise<DaemonRpcResponse | null> {
  const payload = await redis.get(daemonRpcResponseKey(requestId));

  return typeof payload === "string"
    ? JSON.parse(payload) as DaemonRpcResponse
    : null;
}

export async function deleteDaemonRpcResponse(
  redis: AgentHubRedisClient,
  requestId: string,
): Promise<void> {
  await redis.del(daemonRpcResponseKey(requestId));
}

export async function ensureDaemonRpcQueueGroup(
  redis: AgentHubRedisClient,
): Promise<void> {
  try {
    await redis.xGroupCreate(daemonRpcQueueStream, daemonRpcQueueGroup, "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("BUSYGROUP")) {
      return;
    }

    throw error;
  }
}

export async function readDaemonRpcQueueMessages(
  redis: AgentHubRedisClient,
  consumerName: string,
  options: { blockMs?: number; count?: number } = {},
): Promise<DaemonRpcQueueMessage[]> {
  const response = await redis.xReadGroup(
    daemonRpcQueueGroup,
    consumerName,
    {
      key: daemonRpcQueueStream,
      id: ">",
    },
    {
      BLOCK: options.blockMs ?? 500,
      COUNT: options.count ?? 10,
    },
  );

  if (response === null) {
    return [];
  }

  return response.flatMap((stream) =>
    stream.messages.map((message) => {
      const payload = message.message.payload;

      if (typeof payload !== "string") {
        throw new Error(`Invalid daemon RPC payload for message ${message.id}`);
      }

      return {
        id: message.id,
        job: JSON.parse(payload) as DaemonRpcJob,
      };
    }),
  );
}

export async function ackDaemonRpcQueueMessage(
  redis: AgentHubRedisClient,
  messageId: string,
): Promise<void> {
  await redis.xAck(daemonRpcQueueStream, daemonRpcQueueGroup, messageId);
}
