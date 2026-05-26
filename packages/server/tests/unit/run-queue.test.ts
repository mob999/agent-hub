import { describe, expect, it, vi } from "vitest";

import type { AgentHubRedisClient, RunQueueJob } from "../../src";
import {
  ackArtifactActionQueueMessage,
  ackRunQueueMessage,
  artifactActionQueueGroup,
  artifactActionQueueStream,
  enqueueArtifactActionJob,
  enqueueRunJob,
  ensureRunQueueGroup,
  readArtifactActionQueueMessages,
  readRunQueueMessages,
  runQueueGroup,
  runQueueStream,
} from "../../src";

function createRunQueueJob(): RunQueueJob {
  const now = "2026-05-25T00:00:00.000Z";

  return {
    daemonDeviceId: "local-dev",
    prompt: "hello",
    workspacePath: "/workspace",
    run: {
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "codex",
      daemonDeviceId: "local-dev",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    },
    runtime: {
      runtimeKind: "codex",
      capabilities: [],
      updatedAt: now,
    },
  };
}

describe("run queue", () => {
  it("enqueues run jobs as JSON payloads", async () => {
    const redis = {
      xAdd: vi.fn().mockResolvedValue("1-0"),
    };
    const job = createRunQueueJob();

    await expect(
      enqueueRunJob(redis as unknown as AgentHubRedisClient, job),
    ).resolves.toBe("1-0");

    expect(redis.xAdd).toHaveBeenCalledWith(runQueueStream, "*", {
      payload: JSON.stringify(job),
    });
  });

  it("creates the consumer group and ignores BUSYGROUP", async () => {
    const redis = {
      xGroupCreate: vi.fn().mockResolvedValue("OK"),
    };

    await ensureRunQueueGroup(redis as unknown as AgentHubRedisClient);

    expect(redis.xGroupCreate).toHaveBeenCalledWith(
      runQueueStream,
      runQueueGroup,
      "0",
      { MKSTREAM: true },
    );

    redis.xGroupCreate.mockRejectedValueOnce(
      new Error("BUSYGROUP Consumer Group name already exists"),
    );
    await expect(
      ensureRunQueueGroup(redis as unknown as AgentHubRedisClient),
    ).resolves.toBeUndefined();
  });

  it("reads run jobs from Redis Streams", async () => {
    const job = createRunQueueJob();
    const redis = {
      xReadGroup: vi.fn().mockResolvedValue([
        {
          name: runQueueStream,
          messages: [
            {
              id: "1-0",
              message: {
                payload: JSON.stringify(job),
              },
            },
          ],
        },
      ]),
    };

    await expect(
      readRunQueueMessages(redis as unknown as AgentHubRedisClient, "worker-a"),
    ).resolves.toEqual([{ id: "1-0", job }]);
  });

  it("acks messages", async () => {
    const redis = {
      xAck: vi.fn().mockResolvedValue(1),
    };

    await ackRunQueueMessage(
      redis as unknown as AgentHubRedisClient,
      "1-0",
    );

    expect(redis.xAck).toHaveBeenCalledWith(runQueueStream, runQueueGroup, "1-0");
  });

  it("enqueues and reads artifact action jobs", async () => {
    const job = {
      actionId: "00000000-0000-4000-8000-000000000010",
      actionType: "apply" as const,
      artifactId: "00000000-0000-4000-8000-000000000011",
      daemonDeviceId: "local-dev",
      workspacePath: "/workspace",
    };
    const redis = {
      xAdd: vi.fn().mockResolvedValue("2-0"),
      xReadGroup: vi.fn().mockResolvedValue([
        {
          name: artifactActionQueueStream,
          messages: [
            {
              id: "2-0",
              message: {
                payload: JSON.stringify(job),
              },
            },
          ],
        },
      ]),
      xAck: vi.fn().mockResolvedValue(1),
    };

    await expect(
      enqueueArtifactActionJob(redis as unknown as AgentHubRedisClient, job),
    ).resolves.toBe("2-0");
    await expect(
      readArtifactActionQueueMessages(
        redis as unknown as AgentHubRedisClient,
        "worker-a",
      ),
    ).resolves.toEqual([{ id: "2-0", job }]);
    await ackArtifactActionQueueMessage(
      redis as unknown as AgentHubRedisClient,
      "2-0",
    );

    expect(redis.xAdd).toHaveBeenCalledWith(artifactActionQueueStream, "*", {
      payload: JSON.stringify(job),
    });
    expect(redis.xAck).toHaveBeenCalledWith(
      artifactActionQueueStream,
      artifactActionQueueGroup,
      "2-0",
    );
  });
});
