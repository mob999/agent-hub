import type {
  ConversationId,
  ConversationProject,
  ConversationProjectChange,
} from "@agent-hub/core";
import {
  conversationGoalTasks,
  conversationProjectChanges,
  conversationProjects,
  conversations,
  type Db,
} from "@agent-hub/db";
import { and, desc, eq } from "drizzle-orm";

import {
  toConversationProject,
  toConversationProjectChange,
} from "./mappers.js";
import type { UpdateProjectCloneResult } from "./types.js";

export async function markProjectCloneReady(
  db: Db,
  input: {
    conversationId: ConversationId;
    baseRepoPath: string;
    defaultBranch?: string;
    baseHead?: string;
  },
): Promise<UpdateProjectCloneResult> {
  const [project] = await db
    .update(conversationProjects)
    .set({
      baseRepoPath: input.baseRepoPath,
      defaultBranch: input.defaultBranch,
      baseHead: input.baseHead,
      cloneStatus: "ready",
      cloneError: null,
      updatedAt: new Date(),
    })
    .where(eq(conversationProjects.conversationId, input.conversationId))
    .returning();

  return project === undefined
    ? { status: "not-found" }
    : { status: "updated", project: toConversationProject(project) };
}

export async function markProjectCloneFailed(
  db: Db,
  input: { conversationId: ConversationId; error: string },
): Promise<UpdateProjectCloneResult> {
  const [project] = await db
    .update(conversationProjects)
    .set({
      cloneStatus: "failed",
      cloneError: input.error,
      updatedAt: new Date(),
    })
    .where(eq(conversationProjects.conversationId, input.conversationId))
    .returning();

  return project === undefined
    ? { status: "not-found" }
    : { status: "updated", project: toConversationProject(project) };
}

export async function markProjectBaseHead(
  db: Db,
  input: {
    conversationId: ConversationId;
    baseHead?: string;
  },
): Promise<UpdateProjectCloneResult> {
  const [project] = await db
    .update(conversationProjects)
    .set({
      baseHead: input.baseHead,
      updatedAt: new Date(),
    })
    .where(eq(conversationProjects.conversationId, input.conversationId))
    .returning();

  return project === undefined
    ? { status: "not-found" }
    : { status: "updated", project: toConversationProject(project) };
}

export async function getProjectForConversation(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId?: string },
): Promise<ConversationProject | null> {
  const conditions = [eq(conversationProjects.conversationId, input.conversationId)];

  if (input.ownerUserId !== undefined) {
    conditions.push(eq(conversationProjects.ownerUserId, input.ownerUserId));
  }

  const [project] = await db
    .select()
    .from(conversationProjects)
    .where(and(...conditions))
    .limit(1);

  return project === undefined ? null : toConversationProject(project);
}

async function hasActiveProjectConversationForUser(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId: string },
): Promise<boolean> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.type, "project"),
        eq(conversations.status, "active"),
      ),
    )
    .limit(1);

  return conversation !== undefined;
}

export async function listProjectChangesForConversation(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    status?: ConversationProjectChange["status"];
  },
): Promise<ConversationProjectChange[] | null> {
  if (!(await hasActiveProjectConversationForUser(db, input))) {
    return null;
  }

  const conditions = [
    eq(conversationProjectChanges.conversationId, input.conversationId),
    eq(conversationProjectChanges.ownerUserId, input.ownerUserId),
  ];

  if (input.status !== undefined) {
    conditions.push(eq(conversationProjectChanges.status, input.status));
  }

  const rows = await db
    .select()
    .from(conversationProjectChanges)
    .where(and(...conditions))
    .orderBy(desc(conversationProjectChanges.createdAt));

  return rows.map(toConversationProjectChange);
}

export async function getProjectChangeForConversation(
  db: Db,
  input: {
    changeId: ConversationProjectChange["id"];
    conversationId?: ConversationId;
    ownerUserId: string;
  },
): Promise<ConversationProjectChange | null> {
  const conditions = [
    eq(conversationProjectChanges.id, input.changeId),
    eq(conversationProjectChanges.ownerUserId, input.ownerUserId),
  ];

  if (input.conversationId !== undefined) {
    conditions.push(eq(conversationProjectChanges.conversationId, input.conversationId));
  }

  const [row] = await db
    .select()
    .from(conversationProjectChanges)
    .where(and(...conditions))
    .limit(1);

  return row === undefined ? null : toConversationProjectChange(row);
}

export async function getProjectChangeWithDiffForConversation(
  db: Db,
  input: {
    changeId: ConversationProjectChange["id"];
    conversationId?: ConversationId;
    ownerUserId: string;
  },
): Promise<{ change: ConversationProjectChange; diff: string } | null> {
  const conditions = [
    eq(conversationProjectChanges.id, input.changeId),
    eq(conversationProjectChanges.ownerUserId, input.ownerUserId),
  ];

  if (input.conversationId !== undefined) {
    conditions.push(eq(conversationProjectChanges.conversationId, input.conversationId));
  }

  const [row] = await db
    .select()
    .from(conversationProjectChanges)
    .where(and(...conditions))
    .limit(1);

  return row === undefined
    ? null
    : {
        change: toConversationProjectChange(row),
        diff: row.diff ?? "",
      };
}

export async function persistProjectChange(
  db: Db,
  input: {
    change: ConversationProjectChange;
    diff?: string;
  },
): Promise<ConversationProjectChange> {
  const now = new Date(input.change.updatedAt);
  const [linkedTask] = input.change.goalId === undefined ||
    input.change.taskIndex === undefined
    ? await db
        .select({
          goalId: conversationGoalTasks.goalId,
          taskIndex: conversationGoalTasks.index,
        })
        .from(conversationGoalTasks)
        .where(eq(conversationGoalTasks.assigneeRunId, input.change.runId))
        .limit(1)
    : [];
  const goalId = input.change.goalId ?? linkedTask?.goalId;
  const taskIndex = input.change.taskIndex ?? linkedTask?.taskIndex;
  const [row] = await db
    .insert(conversationProjectChanges)
    .values({
      id: input.change.id,
      ownerUserId: input.change.ownerUserId,
      conversationId: input.change.conversationId,
      goalId,
      taskIndex,
      agentId: input.change.agentId,
      runId: input.change.runId,
      branchName: input.change.branchName,
      worktreePath: input.change.worktreePath,
      baseCommit: input.change.baseCommit,
      headCommit: input.change.headCommit,
      status: input.change.status,
      summary: input.change.summary,
      diffStat: input.change.diffStat,
      diff: input.diff,
      createdAt: new Date(input.change.createdAt),
      updatedAt: now,
      mergedAt:
        input.change.mergedAt === undefined
          ? undefined
          : new Date(input.change.mergedAt),
    })
    .onConflictDoUpdate({
      target: conversationProjectChanges.id,
      set: {
        headCommit: input.change.headCommit,
        status: input.change.status,
        summary: input.change.summary,
        diffStat: input.change.diffStat,
        diff: input.diff,
        goalId,
        taskIndex,
        updatedAt: now,
      },
    })
    .returning();

  if (row === undefined) {
    throw new Error("Project change was not persisted.");
  }

  return toConversationProjectChange(row);
}

export async function updateProjectChangeStatus(
  db: Db,
  input: {
    changeId: ConversationProjectChange["id"];
    ownerUserId?: string;
    status: ConversationProjectChange["status"];
    summary?: string;
  },
): Promise<ConversationProjectChange | null> {
  const conditions = [eq(conversationProjectChanges.id, input.changeId)];

  if (input.ownerUserId !== undefined) {
    conditions.push(eq(conversationProjectChanges.ownerUserId, input.ownerUserId));
  }

  const [row] = await db
    .update(conversationProjectChanges)
    .set({
      status: input.status,
      summary: input.summary,
      mergedAt: input.status === "merged" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  return row === undefined ? null : toConversationProjectChange(row);
}
