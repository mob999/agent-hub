import type {
  AgentRun,
  RealtimeEvent,
  RunDispatchMode,
  RunEvent,
  RunId,
} from "@agent-hub/core";
import {
  conversationGoals,
  conversationGoalTasks,
  runEvents,
  runs,
  type Db,
} from "@agent-hub/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { RunQueueJob } from "../queue/index.js";
import { createRealtimeEvent } from "../realtime/index.js";

export interface RunDispatchPreparation {
  dispatchMode: RunDispatchMode;
  handedOffTaskContexts: RunDispatchTaskContext[];
  parentRunId?: RunId;
  preemptRunIds: RunId[];
  realtimeEvents: RealtimeEvent[];
  runtimeSessionId?: string;
}

export interface RunDispatchTaskContext {
  goalId: string;
  goalTitle: string;
  taskDescription?: string;
  taskId: string;
  taskIndex: number;
  taskTitle: string;
}

function toDispatchAgentRun(row: typeof runs.$inferSelect): AgentRun {
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

export async function prepareRunDispatch(
  db: Db,
  input: {
    agentId: string;
    conversationId?: string;
    createdAt: Date;
    daemonDeviceId: string;
    handoffActiveTaskRuns?: boolean;
    newRunId: RunId;
    ownerUserId: string;
  },
): Promise<RunDispatchPreparation> {
  if (input.conversationId === undefined) {
    return {
      dispatchMode: "new",
      handedOffTaskContexts: [],
      preemptRunIds: [],
      realtimeEvents: [],
    };
  }

  const activeRuns = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.ownerUserId, input.ownerUserId),
        eq(runs.conversationId, input.conversationId),
        eq(runs.agentId, input.agentId),
        ne(runs.id, input.newRunId),
        inArray(runs.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(runs.createdAt));

  const runtimeSessionId =
    activeRuns.find((run) => run.runtimeSessionId !== null)?.runtimeSessionId ??
    undefined;
  const parentRunId = activeRuns[0]?.id;
  const preemptRunIds = activeRuns
    .filter((run) => run.status === "running")
    .map((run) => run.id);
  const realtimeEvents: RealtimeEvent[] = [];
  const interruptedAt = input.createdAt.toISOString();
  const activeRunIds = activeRuns.map((run) => run.id);
  const handedOffTaskContexts: RunDispatchTaskContext[] = [];

  if (input.handoffActiveTaskRuns !== false && activeRunIds.length > 0) {
    const handedOffTasks = await db
      .update(conversationGoalTasks)
      .set({
        assigneeRunId: input.newRunId,
        blockedReason: null,
        updatedAt: input.createdAt,
      })
      .where(inArray(conversationGoalTasks.assigneeRunId, activeRunIds))
      .returning({
        description: conversationGoalTasks.description,
        goalId: conversationGoalTasks.goalId,
        id: conversationGoalTasks.id,
        index: conversationGoalTasks.index,
        title: conversationGoalTasks.title,
      });
    const handedOffGoals = handedOffTasks.length === 0
      ? []
      : await db
          .select({
            conversationId: conversationGoals.conversationId,
            id: conversationGoals.id,
            ownerUserId: conversationGoals.ownerUserId,
            title: conversationGoals.title,
          })
          .from(conversationGoals)
          .where(inArray(conversationGoals.id, handedOffTasks.map((task) => task.goalId)));
    const handedOffGoalsById = new Map(
      handedOffGoals.map((goal) => [goal.id, goal]),
    );

    handedOffTaskContexts.push(
      ...handedOffTasks.flatMap((task) => {
        const goal = handedOffGoalsById.get(task.goalId);

        return goal === undefined
          ? []
          : [
              {
                goalId: task.goalId,
                goalTitle: goal.title,
                taskDescription: task.description ?? undefined,
                taskId: task.id,
                taskIndex: task.index,
                taskTitle: task.title,
              },
            ];
      }),
    );

    realtimeEvents.push(
      ...handedOffTasks.flatMap((task) => {
        const goal = handedOffGoalsById.get(task.goalId);

        return goal === undefined
          ? []
          : [
              createRealtimeEvent({
                conversationId: goal.conversationId,
                ownerUserId: goal.ownerUserId,
                taskId: task.id,
                type: "task.updated" as const,
              }),
            ];
      }),
    );
  } else if (activeRunIds.length > 0) {
    const interruptedTasks = await db
      .update(conversationGoalTasks)
      .set({
        status: "interrupted",
        blockedReason: "Interrupted by a newer run for this agent.",
        updatedAt: input.createdAt,
      })
      .where(inArray(conversationGoalTasks.assigneeRunId, activeRunIds))
      .returning({
        goalId: conversationGoalTasks.goalId,
        id: conversationGoalTasks.id,
      });
    const interruptedGoals = interruptedTasks.length === 0
      ? []
      : await db
          .select({
            conversationId: conversationGoals.conversationId,
            id: conversationGoals.id,
            ownerUserId: conversationGoals.ownerUserId,
          })
          .from(conversationGoals)
          .where(inArray(conversationGoals.id, interruptedTasks.map((task) => task.goalId)));
    const interruptedGoalsById = new Map(
      interruptedGoals.map((goal) => [goal.id, goal]),
    );

    realtimeEvents.push(
      ...interruptedTasks.flatMap((task) => {
        const goal = interruptedGoalsById.get(task.goalId);

        return goal === undefined
          ? []
          : [
              createRealtimeEvent({
                conversationId: goal.conversationId,
                ownerUserId: goal.ownerUserId,
                taskId: task.id,
                type: "task.updated" as const,
              }),
            ];
      }),
    );
  }

  for (const activeRun of activeRuns) {
    const interruptedEvent: RunEvent = {
      type: "run.completed",
      runId: activeRun.id,
      status: "interrupted",
      error: `Run was preempted by ${input.newRunId}.`,
      createdAt: interruptedAt,
    };
    const [updatedRun] = await db
      .update(runs)
      .set({
        status: "interrupted",
        preemptedByRunId: input.newRunId,
        updatedAt: input.createdAt,
      })
      .where(eq(runs.id, activeRun.id))
      .returning();

    await db.insert(runEvents).values({
      runId: activeRun.id,
      eventType: interruptedEvent.type,
      payload: interruptedEvent,
      createdAt: input.createdAt,
    });

    if (updatedRun !== undefined) {
      realtimeEvents.push(
        createRealtimeEvent({
          conversationId: updatedRun.conversationId ?? undefined,
          event: interruptedEvent,
          ownerUserId: updatedRun.ownerUserId,
          runId: updatedRun.id,
          type: "run.event.created",
        }),
        createRealtimeEvent({
          conversationId: updatedRun.conversationId ?? undefined,
          ownerUserId: updatedRun.ownerUserId,
          run: toDispatchAgentRun(updatedRun),
          type: "run.updated",
        }),
      );
    }
  }

  return {
    dispatchMode: runtimeSessionId === undefined ? "new" : "resume",
    handedOffTaskContexts,
    parentRunId,
    preemptRunIds,
    realtimeEvents,
    runtimeSessionId,
  };
}

export function applyRunDispatchPreparation(
  job: RunQueueJob,
  preparation: RunDispatchPreparation,
): RunQueueJob {
  return {
    ...job,
    dispatchMode: preparation.dispatchMode,
    runtimeSessionId: preparation.runtimeSessionId,
    preemptRunIds: preparation.preemptRunIds,
    run: {
      ...job.run,
      dispatchMode: preparation.dispatchMode,
      parentRunId: preparation.parentRunId,
      runtimeSessionId: preparation.runtimeSessionId,
    },
  };
}
