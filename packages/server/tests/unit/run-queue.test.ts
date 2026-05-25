import { describe, expect, it, vi } from "vitest";

import type { AgentHubRedisClient, RunQueueJob } from "../../src";
import {
  ackRunQueueMessage,
  daemonAssignmentChannel,
  enqueueRunJob,
  ensureRunQueueGroup,
  publishDaemonAssignment,
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

  it("acks messages and publishes daemon assignments", async () => {
    const redis = {
      publish: vi.fn().mockResolvedValue(1),
      xAck: vi.fn().mockResolvedValue(1),
    };
    const job = createRunQueueJob();

    await ackRunQueueMessage(
      redis as unknown as AgentHubRedisClient,
      "1-0",
    );
    await publishDaemonAssignment(
      redis as unknown as AgentHubRedisClient,
      job,
    );

    expect(redis.xAck).toHaveBeenCalledWith(runQueueStream, runQueueGroup, "1-0");
    expect(redis.publish).toHaveBeenCalledWith(
      daemonAssignmentChannel,
      JSON.stringify({
        type: "run.assigned",
        agentId: "codex",
        daemonDeviceId: "local-dev",
        run: job.run,
        prompt: job.prompt,
        workspacePath: job.workspacePath,
        runtime: job.runtime,
      }),
    );
  });
});
