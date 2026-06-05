import { randomUUID } from "node:crypto";

import type { RunEvent } from "@agent-hub/core";
import {
  createDb,
  daemonDevices,
  runEvents,
  runs,
  sessions,
  users,
} from "@agent-hub/db";
import type { RunQueueJob } from "@agent-hub/server";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendRunEvent,
  createRunRecord,
  getRunEventsForUser,
  getRunForUser,
  listDaemonDevices,
  listRunsForUser,
  listRunningRunIdsByDaemonDevice,
  softDeleteDaemonDeviceForUser,
  toAgentRun,
  updateDaemonDeviceForUser,
  upsertDaemonDevice,
} from "@agent-hub/server";

const runDbIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeDb = runDbIntegrationTests ? describe : describe.skip;

function createJob(id = randomUUID()): RunQueueJob {
  const now = "2026-05-25T00:00:00.000Z";

  return {
    daemonDeviceId: "local-dev",
    prompt: "hello",
    workspacePath: "/workspace",
    run: {
      id,
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

describeDb("run repository integration", () => {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const db = createDb(databaseUrl);
  const userIds: string[] = [];
  const runIds: string[] = [];
  const daemonDeviceIds: string[] = [];

  async function createUser(email: string): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash: "test-password-hash",
      })
      .returning({ id: users.id });

    userIds.push(user.id);
    return user.id;
  }

  beforeAll(() => {
    if (databaseUrl.length === 0) {
      throw new Error(
        "RUN_DB_INTEGRATION_TESTS=true requires TEST_DATABASE_URL or DATABASE_URL.",
      );
    }
  });

  afterAll(async () => {
    if (runIds.length > 0) {
      await db.delete(runEvents).where(inArray(runEvents.runId, runIds));
      await db.delete(runs).where(inArray(runs.id, runIds));
    }

    if (daemonDeviceIds.length > 0) {
      await db
        .delete(daemonDevices)
        .where(inArray(daemonDevices.id, daemonDeviceIds));
    }

    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  it("creates runs, appends events, and enforces owner scoped reads", async () => {
    const ownerUserId = await createUser(
      `run-owner-${randomUUID()}@example.com`,
    );
    const otherUserId = await createUser(
      `run-other-${randomUUID()}@example.com`,
    );
    const job = createJob();
    runIds.push(job.run.id);

    await createRunRecord(db, { ownerUserId, job });

    const queuedEvent: RunEvent = {
      type: "run.queued",
      runId: job.run.id,
      agentId: job.run.agentId,
      daemonDeviceId: job.daemonDeviceId,
      createdAt: "2026-05-25T00:00:00.000Z",
    };
    const startedEvent: RunEvent = {
      type: "run.started",
      runId: job.run.id,
      workspacePath: job.workspacePath,
      createdAt: "2026-05-25T00:00:01.000Z",
    };
    const completedEvent: RunEvent = {
      type: "run.completed",
      runId: job.run.id,
      status: "succeeded",
      createdAt: "2026-05-25T00:00:02.000Z",
    };

    await appendRunEvent(db, queuedEvent);
    await appendRunEvent(db, startedEvent);
    const runningRunIdsAfterStart = await listRunningRunIdsByDaemonDevice(db);
    await appendRunEvent(db, completedEvent);

    const run = await getRunForUser(db, {
      runId: job.run.id,
      ownerUserId,
    });
    const otherUserRun = await getRunForUser(db, {
      runId: job.run.id,
      ownerUserId: otherUserId,
    });
    const events = await getRunEventsForUser(db, {
      runId: job.run.id,
      ownerUserId,
    });
    const ownerRuns = await listRunsForUser(db, { ownerUserId });
    const otherUserRuns = await listRunsForUser(db, { ownerUserId: otherUserId });
    const runningRunIdsByDevice = await listRunningRunIdsByDaemonDevice(db);

    expect(run).not.toBeNull();
    expect(toAgentRun(run!)).toMatchObject({
      id: job.run.id,
      status: "succeeded",
    });
    expect(otherUserRun).toBeNull();
    expect(events).toEqual([queuedEvent, startedEvent, completedEvent]);
    expect(ownerRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prompt: job.prompt,
          run: expect.objectContaining({
            id: job.run.id,
            status: "succeeded",
          }),
        }),
      ]),
    );
    expect(otherUserRuns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run: expect.objectContaining({ id: job.run.id }),
        }),
      ]),
    );
    expect(runningRunIdsAfterStart.get(job.daemonDeviceId)).toContain(
      job.run.id,
    );
    expect(runningRunIdsByDevice.get(job.daemonDeviceId) ?? []).not.toContain(
      job.run.id,
    );
  });

  it("upserts daemon device status", async () => {
    const deviceId = `test-device-${randomUUID()}`;
    daemonDeviceIds.push(deviceId);

    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "online",
      lastSeenAt: new Date("2026-05-25T00:00:00.000Z"),
    });
    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "offline",
      lastSeenAt: new Date("2026-05-25T00:00:01.000Z"),
    });

    const devices = await listDaemonDevices(db);
    const device = devices.find((candidate) => candidate.id === deviceId);

    expect(device).toMatchObject({
      id: deviceId,
      name: deviceId,
      status: "offline",
    });
  });

  it("updates and soft-deletes owner scoped daemon devices", async () => {
    const ownerUserId = await createUser(
      `daemon-owner-${randomUUID()}@example.com`,
    );
    const otherUserId = await createUser(
      `daemon-other-${randomUUID()}@example.com`,
    );
    const deviceId = `test-device-${randomUUID()}`;
    daemonDeviceIds.push(deviceId);

    await db.insert(daemonDevices).values({
      id: deviceId,
      ownerUserId,
      name: "Office workstation",
      status: "offline",
    });

    expect(
      await updateDaemonDeviceForUser(db, {
        deviceId,
        ownerUserId: otherUserId,
        name: "Other rename",
      }),
    ).toBeNull();

    const renamed = await updateDaemonDeviceForUser(db, {
      deviceId,
      ownerUserId,
      name: "Studio workstation",
    });

    expect(renamed).toMatchObject({
      id: deviceId,
      name: "Studio workstation",
    });

    const deleted = await softDeleteDaemonDeviceForUser(db, {
      deviceId,
      ownerUserId,
    });

    expect(deleted).toMatchObject({
      id: deviceId,
      status: "disabled",
    });

    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "online",
      lastSeenAt: new Date("2026-05-25T00:00:03.000Z"),
    });

    const devices = await listDaemonDevices(db);
    const device = devices.find((candidate) => candidate.id === deviceId);

    expect(device).toMatchObject({
      id: deviceId,
      name: "Studio workstation",
      status: "disabled",
    });
    expect(device?.deletedAt).not.toBeNull();
  });
});
