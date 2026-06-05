import type { ConversationId } from "@agent-hub/core";
import { agents, conversationProjects, conversations, type Db } from "@agent-hub/db";
import { eq } from "drizzle-orm";

import type { RunQueueJob } from "../queue/index.js";

function safeProjectBranchSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "agent";
}

export async function applyProjectRunWorkspace(
  db: Db,
  input: { conversationId: string; job: RunQueueJob },
): Promise<RunQueueJob> {
  const [row] = await db
    .select({
      conversation: conversations,
      project: conversationProjects,
      agent: agents,
    })
    .from(conversations)
    .leftJoin(
      conversationProjects,
      eq(conversationProjects.conversationId, conversations.id),
    )
    .leftJoin(agents, eq(agents.id, input.job.run.agentId))
    .where(eq(conversations.id, input.conversationId))
    .limit(1);

  if (
    row === undefined ||
    row.conversation.type !== "project" ||
    row.project === null ||
    row.project.cloneStatus !== "ready" ||
    row.project.baseRepoPath === null ||
    row.agent === null
  ) {
    return input.job;
  }

  const branchName = [
    "agenthub",
    safeProjectBranchSegment(row.agent.name),
    input.job.run.id.slice(0, 8),
  ].join("/");
  const worktreePath = [
    row.project.baseRepoPath.replace(/[\\/]base$/, ""),
    "worktrees",
    row.agent.id,
    input.job.run.id,
  ].join("/");

  return {
    ...input.job,
    memoryWorkspacePath: input.job.memoryWorkspacePath ?? input.job.workspacePath,
    projectRun: {
      baseRepoPath: row.project.baseRepoPath,
      branchName,
      conversationId: row.conversation.id,
      ownerUserId: row.conversation.ownerUserId,
      projectId: row.conversation.id,
    },
    workspacePath: worktreePath,
  };
}

export async function prepareProjectRunJobForConversation(
  db: Db,
  input: { conversationId: ConversationId; job: RunQueueJob },
): Promise<RunQueueJob> {
  return applyProjectRunWorkspace(db, input);
}
