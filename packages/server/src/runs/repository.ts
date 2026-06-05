import type {
  AgentRun,
  AgentRunSummary,
  RealtimeEvent,
  RunEvent,
  RunId,
} from "@agent-hub/core";
import {
  daemonDevices,
  runEvents,
  runs,
  type Db,
} from "@agent-hub/db";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";

import type { RunQueueJob } from "../queue/index.js";
import {
  appendRunEventToConversationMessage,
  type AppendRunEventResult,
} from "../conversations/index.js";
import { createRealtimeEvent } from "../realtime/index.js";

export async function createRunRecord(
  db: Db,
  input: { ownerUserId: string; job: RunQueueJob },
): Promise<void> {
  await db.insert(runs).values({
    id: input.job.run.id,
    ownerUserId: input.ownerUserId,
    conversationId: input.job.conversationId,
    agentId: input.job.run.agentId,
    daemonDeviceId: input.job.daemonDeviceId,
    status: input.job.run.status,
    runtimeSessionId: input.job.runtimeSessionId,
    parentRunId: input.job.run.parentRunId,
    preemptedByRunId: input.job.run.preemptedByRunId,
    dispatchMode: input.job.dispatchMode ?? input.job.run.dispatchMode ?? "new",
    prompt: input.job.prompt,
    workspacePath: input.job.workspacePath,
    memoryWorkspacePath: input.job.memoryWorkspacePath ?? input.job.workspacePath,
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

export async function getRunById(db: Db, runId: RunId) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);

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

export async function listRunsForUser(
  db: Db,
  input: { ownerUserId: string; limit?: number },
): Promise<AgentRunSummary[]> {
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.ownerUserId, input.ownerUserId))
    .orderBy(desc(runs.createdAt))
    .limit(input.limit ?? 50);

  return rows.map((run) => ({
    run: toAgentRun(run),
    prompt: run.prompt,
    conversationId: run.conversationId ?? undefined,
  }));
}

export async function appendRunEvent(
  db: Db,
  event: RunEvent,
  options: Parameters<typeof appendRunEventToConversationMessage>[2] = {},
): Promise<AppendRunEventResult> {
  const realtimeEvents: RealtimeEvent[] = [];

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
  const nextRuntimeSessionId =
    event.type === "runtime.session.started" ? event.sessionId : undefined;

  const [run] = await db
    .update(runs)
    .set({
      ...(nextStatus === undefined ? {} : { status: nextStatus }),
      ...(nextRuntimeSessionId === undefined
        ? {}
        : { runtimeSessionId: nextRuntimeSessionId }),
      updatedAt: new Date(event.createdAt),
    })
    .where(eq(runs.id, event.runId))
    .returning();

  if (run !== undefined) {
    realtimeEvents.push(
      createRealtimeEvent({
        conversationId: run.conversationId ?? undefined,
        event,
        ownerUserId: run.ownerUserId,
        runId: event.runId,
        type: "run.event.created",
      }),
      createRealtimeEvent({
        conversationId: run.conversationId ?? undefined,
        ownerUserId: run.ownerUserId,
        run: toAgentRun(run),
        type: "run.updated",
      }),
    );
  }

  const conversationResult = await appendRunEventToConversationMessage(
    db,
    event,
    options,
  );

  return {
    dispatchJobs: conversationResult.dispatchJobs,
    memoryAppendJobs: conversationResult.memoryAppendJobs,
    projectMergeRequests: conversationResult.projectMergeRequests,
    toolResult: conversationResult.toolResult,
    realtimeEvents: [
      ...realtimeEvents,
      ...conversationResult.realtimeEvents,
    ],
  };
}

export async function upsertDaemonDevice(
  db: Db,
  input: { id: string; status: "online" | "offline"; lastSeenAt?: Date },
): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(daemonDevices)
    .where(eq(daemonDevices.id, input.id))
    .limit(1);

  if (existing !== undefined && existing.deletedAt !== null) {
    return;
  }

  if (existing !== undefined) {
    await db
      .update(daemonDevices)
      .set({
        status: input.status,
        lastSeenAt: input.lastSeenAt ?? now,
        updatedAt: now,
      })
      .where(eq(daemonDevices.id, input.id));
    return;
  }

  await db
    .insert(daemonDevices)
    .values({
      id: input.id,
      name: input.id,
      status: input.status,
      lastSeenAt: input.lastSeenAt ?? now,
      updatedAt: now,
    });
}

export async function createDaemonDeviceForUser(
  db: Db,
  input: {
    id: string;
    name: string;
    ownerUserId: string;
    registrationShell: "powershell" | "sh";
  },
) {
  const now = new Date();
  const [device] = await db
    .insert(daemonDevices)
    .values({
      id: input.id,
      ownerUserId: input.ownerUserId,
      name: input.name,
      registrationShell: input.registrationShell,
      status: "offline",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return device;
}

export async function getDaemonDeviceForUser(
  db: Db,
  input: { deviceId: string; ownerUserId: string },
) {
  const [device] = await db
    .select()
    .from(daemonDevices)
    .where(
      and(
        eq(daemonDevices.id, input.deviceId),
        or(
          eq(daemonDevices.ownerUserId, input.ownerUserId),
          isNull(daemonDevices.ownerUserId),
        ),
        isNull(daemonDevices.deletedAt),
      ),
    )
    .limit(1);

  return device ?? null;
}

export async function getActiveDaemonDeviceById(
  db: Db,
  input: { deviceId: string },
) {
  const [device] = await db
    .select()
    .from(daemonDevices)
    .where(
      and(
        eq(daemonDevices.id, input.deviceId),
        isNull(daemonDevices.deletedAt),
      ),
    )
    .limit(1);

  return device ?? null;
}

export async function updateDaemonDeviceForUser(
  db: Db,
  input: { deviceId: string; name: string; ownerUserId: string },
) {
  const [device] = await db
    .update(daemonDevices)
    .set({
      name: input.name,
      ownerUserId: input.ownerUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(daemonDevices.id, input.deviceId),
        or(
          eq(daemonDevices.ownerUserId, input.ownerUserId),
          isNull(daemonDevices.ownerUserId),
        ),
        isNull(daemonDevices.deletedAt),
      ),
    )
    .returning();

  return device ?? null;
}

export async function softDeleteDaemonDeviceForUser(
  db: Db,
  input: { deviceId: string; ownerUserId: string },
) {
  const now = new Date();
  const [device] = await db
    .update(daemonDevices)
    .set({
      deletedAt: now,
      ownerUserId: input.ownerUserId,
      status: "disabled",
      updatedAt: now,
    })
    .where(
      and(
        eq(daemonDevices.id, input.deviceId),
        or(
          eq(daemonDevices.ownerUserId, input.ownerUserId),
          isNull(daemonDevices.ownerUserId),
        ),
        isNull(daemonDevices.deletedAt),
      ),
    )
    .returning();

  return device ?? null;
}

export async function listDaemonDevices(db: Db) {
  return db.select().from(daemonDevices).orderBy(asc(daemonDevices.id));
}

export async function listRunningRunIdsByDaemonDevice(
  db: Db,
): Promise<Map<string, string[]>> {
  const runningRuns = await db
    .select({
      daemonDeviceId: runs.daemonDeviceId,
      runId: runs.id,
    })
    .from(runs)
    .where(eq(runs.status, "running"))
    .orderBy(asc(runs.createdAt));

  const runIdsByDevice = new Map<string, string[]>();

  for (const run of runningRuns) {
    const runIds = runIdsByDevice.get(run.daemonDeviceId) ?? [];
    runIds.push(run.runId);
    runIdsByDevice.set(run.daemonDeviceId, runIds);
  }

  return runIdsByDevice;
}

export function toAgentRun(row: typeof runs.$inferSelect): AgentRun {
  return {
    id: row.id,
    agentId: row.agentId,
    daemonDeviceId: row.daemonDeviceId,
    status: row.status as AgentRun["status"],
    runtimeSessionId: row.runtimeSessionId ?? undefined,
    parentRunId: row.parentRunId ?? undefined,
    preemptedByRunId: row.preemptedByRunId ?? undefined,
    dispatchMode: row.dispatchMode as AgentRun["dispatchMode"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
