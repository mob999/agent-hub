import type { AgentRun, RunEvent, RunId } from "@agent-hub/core";
import {
  daemonDevices,
  runEvents,
  runs,
  type Db,
} from "@agent-hub/db";
import type { RunQueueJob } from "@agent-hub/server";
import { and, asc, eq } from "drizzle-orm";

export async function createRunRecord(
  db: Db,
  input: { ownerUserId: string; job: RunQueueJob },
): Promise<void> {
  await db.insert(runs).values({
    id: input.job.run.id,
    ownerUserId: input.ownerUserId,
    agentId: input.job.run.agentId,
    daemonDeviceId: input.job.daemonDeviceId,
    status: input.job.run.status,
    prompt: input.job.prompt,
    workspacePath: input.job.workspacePath,
    runtime: input.job.runtime,
    createdAt: new Date(input.job.run.createdAt),
    updatedAt: new Date(input.job.run.updatedAt),
  });
}

export async function getRunForUser(
  db: Db,
  input: { runId: RunId; ownerUserId: string },
) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, input.runId), eq(runs.ownerUserId, input.ownerUserId)))
    .limit(1);

  return run ?? null;
}

export async function getRunEventsForUser(
  db: Db,
  input: { runId: RunId; ownerUserId: string },
): Promise<RunEvent[] | null> {
  const run = await getRunForUser(db, input);

  if (run === null) {
    return null;
  }

  const events = await db
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(eq(runEvents.runId, input.runId))
    .orderBy(asc(runEvents.createdAt));

  return events.map((event) => event.payload as RunEvent);
}

export async function appendRunEvent(db: Db, event: RunEvent): Promise<void> {
  await db.insert(runEvents).values({
    runId: event.runId,
    eventType: event.type,
    payload: event,
    createdAt: new Date(event.createdAt),
  });

  const nextStatus =
    event.type === "run.started"
      ? "running"
      : event.type === "run.completed"
        ? event.status
        : undefined;

  await db
    .update(runs)
    .set({
      ...(nextStatus === undefined ? {} : { status: nextStatus }),
      updatedAt: new Date(event.createdAt),
    })
    .where(eq(runs.id, event.runId));
}

export async function upsertDaemonDevice(
  db: Db,
  input: { id: string; status: "online" | "offline"; lastSeenAt?: Date },
): Promise<void> {
  const now = new Date();

  await db
    .insert(daemonDevices)
    .values({
      id: input.id,
      status: input.status,
      lastSeenAt: input.lastSeenAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: daemonDevices.id,
      set: {
        status: input.status,
        lastSeenAt: input.lastSeenAt ?? now,
        updatedAt: now,
      },
    });
}

export async function listDaemonDevices(db: Db) {
  return db.select().from(daemonDevices).orderBy(asc(daemonDevices.id));
}

export function toAgentRun(row: typeof runs.$inferSelect): AgentRun {
  return {
    id: row.id,
    agentId: row.agentId,
    daemonDeviceId: row.daemonDeviceId,
    status: row.status as AgentRun["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
