import type {
  Conversation,
  ConversationArtifact,
  ConversationGoal,
  ConversationGoalTask,
  ConversationId,
  ConversationMessage,
  ConversationMessageAttachment,
} from "@agent-hub/core";
import {
  agents,
  conversationAgentMembers,
  conversationArtifacts,
  conversationGoalTasks,
  conversationGoals,
  conversationMessageArtifacts,
  conversationMessages,
  conversationProjects,
  conversations,
  type Db,
} from "@agent-hub/db";
import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";

import { getRunnableAgentForUser } from "../agents/repository.js";
import {
  defaultGroupConversationKey,
  defaultGroupConversationTitle,
  getConversationAgentIdsForRow,
  groupConversationKeyFromTitle,
  includesOrNoOrchestrator,
  inferProjectConversationTitle,
  listAgentIdsForUser,
  normalizeGroupConversationTitle,
  normalizeProjectDescription,
  toConversationsWithAgentIds,
} from "./helpers.js";
import {
  toConversation,
  toConversationArtifact,
  toConversationGoal,
  toConversationGoalTask,
  toConversationMessage,
  toConversationMessageAttachment,
  toConversationProject,
} from "./mappers.js";
import { conversationPromptRole } from "./prompts.js";
import type {
  ArchiveGroupConversationResult,
  ConversationStatusFilter,
  CreateGroupConversationResult,
  CreateProjectConversationResult,
  DeleteArchivedGroupConversationResult,
  RestoreGroupConversationResult,
  UpdateConversationOrchestratorResult,
  UpdateGroupConversationResult,
  UpdateProjectConversationResult,
} from "./types.js";

export async function ensureDefaultGroupConversation(
  db: Db,
  input: { ownerUserId: string },
): Promise<Conversation> {
  const now = new Date();
  const [created] = await db
    .insert(conversations)
    .values({
      ownerUserId: input.ownerUserId,
      type: "group",
      key: defaultGroupConversationKey,
      title: defaultGroupConversationTitle,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [conversations.ownerUserId, conversations.key],
    })
    .returning();

  if (created !== undefined) {
    const agentIds = await listAgentIdsForUser(db, {
      ownerUserId: input.ownerUserId,
    });

    return toConversation(created, agentIds);
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.key, defaultGroupConversationKey),
      ),
    )
    .limit(1);

  if (conversation === undefined) {
    throw new Error("Default group conversation was not created.");
  }

  const agentIds = await listAgentIdsForUser(db, {
    ownerUserId: input.ownerUserId,
  });

  return toConversation(conversation, agentIds);
}

export async function createGroupConversation(
  db: Db,
  input: {
    ownerUserId: string;
    title: string;
    description?: string;
    agentIds: string[];
    orchestratorAgentId?: string;
  },
): Promise<CreateGroupConversationResult> {
  const title = normalizeGroupConversationTitle(input.title);
  const key = groupConversationKeyFromTitle(title);
  const description = input.description?.trim() || undefined;

  if (key === defaultGroupConversationKey) {
    return { status: "reserved-key" };
  }

  if (!includesOrNoOrchestrator(input)) {
    return { status: "orchestrator-not-in-group" };
  }

  return db.transaction(async (tx) => {
    const agentRows = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.ownerUserId, input.ownerUserId),
          eq(agents.status, "active"),
          inArray(agents.id, input.agentIds),
        ),
      );

    if (agentRows.length !== input.agentIds.length) {
      return { status: "agents-not-found" };
    }

    const now = new Date();
    const [created] = await tx
      .insert(conversations)
      .values({
        ownerUserId: input.ownerUserId,
        type: "group",
        key,
        title,
        description,
        orchestratorAgentId: input.orchestratorAgentId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [conversations.ownerUserId, conversations.key],
      })
      .returning();

    if (created === undefined) {
      return { status: "duplicate-key" };
    }

    await tx.insert(conversationAgentMembers).values(
      input.agentIds.map((agentId, position) => ({
        conversationId: created.id,
        agentId,
        position,
        createdAt: now,
      })),
    );

    return {
      status: "created",
      conversation: toConversation(created, input.agentIds),
    };
  });
}

export async function createProjectConversation(
  db: Db,
  input: {
    ownerUserId: string;
    title?: string;
    description?: string;
    remoteUrl: string;
    agentIds: string[];
    orchestratorAgentId?: string;
  },
): Promise<CreateProjectConversationResult> {
  const title = normalizeGroupConversationTitle(
    input.title?.trim() || inferProjectConversationTitle(input.remoteUrl),
  ).slice(0, 160);
  const description = normalizeProjectDescription(input.description);
  const agentIds = [...new Set(input.agentIds)];

  if (
    input.orchestratorAgentId !== undefined &&
    !agentIds.includes(input.orchestratorAgentId)
  ) {
    return { status: "orchestrator-not-in-project" };
  }

  const runnableAgents = await Promise.all(
    agentIds.map((agentId) =>
      getRunnableAgentForUser(db, {
        agentId,
        ownerUserId: input.ownerUserId,
      }),
    ),
  );

  if (runnableAgents.some((agent) => agent === null)) {
    return { status: "agents-not-found" };
  }

  const daemonDeviceIds = new Set(
    runnableAgents.map((agent) => agent?.daemonDeviceId),
  );

  if (daemonDeviceIds.size !== 1) {
    return { status: "agents-not-same-daemon" };
  }

  const daemonDeviceId = runnableAgents[0]?.daemonDeviceId;

  if (daemonDeviceId === undefined) {
    return { status: "agents-not-found" };
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    const [created] = await tx
      .insert(conversations)
      .values({
        ownerUserId: input.ownerUserId,
        type: "project",
        key: null,
        title,
        description,
        orchestratorAgentId: input.orchestratorAgentId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (created === undefined) {
      return { status: "agents-not-found" };
    }

    await tx.insert(conversationAgentMembers).values(
      agentIds.map((agentId, position) => ({
        conversationId: created.id,
        agentId,
        position,
        createdAt: now,
      })),
    );

    const [project] = await tx
      .insert(conversationProjects)
      .values({
        conversationId: created.id,
        ownerUserId: input.ownerUserId,
        remoteUrl: input.remoteUrl.trim(),
        daemonDeviceId,
        cloneStatus: "cloning",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return {
      status: "created",
      daemonDeviceId,
      conversation: toConversation(
        created,
        agentIds,
        project === undefined ? undefined : toConversationProject(project),
      ),
    };
  });
}

export async function updateGroupConversation(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    title: string;
    description?: string;
    agentIds: string[];
    orchestratorAgentId?: string;
  },
): Promise<UpdateGroupConversationResult> {
  const title = normalizeGroupConversationTitle(input.title);
  const key = groupConversationKeyFromTitle(title);
  const description = input.description?.trim() || undefined;

  if (key === defaultGroupConversationKey) {
    return { status: "reserved-key" };
  }

  if (!includesOrNoOrchestrator(input)) {
    return { status: "orchestrator-not-in-group" };
  }

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.type, "group"),
          eq(conversations.status, "active"),
        ),
      )
      .limit(1);

    if (conversation === undefined) {
      return { status: "not-found" };
    }

    if (conversation.key === defaultGroupConversationKey) {
      return { status: "reserved-key" };
    }

    const [duplicate] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.key, key),
          ne(conversations.id, input.conversationId),
        ),
      )
      .limit(1);

    if (duplicate !== undefined) {
      return { status: "duplicate-key" };
    }

    const agentRows = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.ownerUserId, input.ownerUserId),
          eq(agents.status, "active"),
          inArray(agents.id, input.agentIds),
        ),
      );

    if (agentRows.length !== input.agentIds.length) {
      return { status: "agents-not-found" };
    }

    const now = new Date();
    const [updated] = await tx
      .update(conversations)
      .set({
        key,
        title,
        description: description ?? null,
        orchestratorAgentId: input.orchestratorAgentId ?? null,
        updatedAt: now,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    if (updated === undefined) {
      return { status: "not-found" };
    }

    await tx
      .delete(conversationAgentMembers)
      .where(eq(conversationAgentMembers.conversationId, input.conversationId));

    await tx.insert(conversationAgentMembers).values(
      input.agentIds.map((agentId, position) => ({
        conversationId: input.conversationId,
        agentId,
        position,
        createdAt: now,
      })),
    );

    return {
      status: "updated",
      conversation: toConversation(updated, input.agentIds),
    };
  });
}

export async function updateProjectConversation(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    title: string;
    description?: string;
    agentIds: string[];
    orchestratorAgentId?: string;
  },
): Promise<UpdateProjectConversationResult> {
  const title = normalizeGroupConversationTitle(input.title).slice(0, 160);
  const description = normalizeProjectDescription(input.description);
  const agentIds = [...new Set(input.agentIds)];

  if (
    title.length === 0 ||
    !includesOrNoOrchestrator({
      agentIds,
      orchestratorAgentId: input.orchestratorAgentId,
    })
  ) {
    return { status: "orchestrator-not-in-project" };
  }

  const runnableAgents = await Promise.all(
    agentIds.map((agentId) =>
      getRunnableAgentForUser(db, {
        agentId,
        ownerUserId: input.ownerUserId,
      }),
    ),
  );

  if (runnableAgents.some((agent) => agent === null)) {
    return { status: "agents-not-found" };
  }

  const daemonDeviceIds = new Set(
    runnableAgents.map((agent) => agent?.daemonDeviceId),
  );

  if (daemonDeviceIds.size !== 1) {
    return { status: "agents-not-same-daemon" };
  }

  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
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

    if (conversation === undefined) {
      return { status: "not-found" };
    }

    const [project] = await tx
      .select()
      .from(conversationProjects)
      .where(
        and(
          eq(conversationProjects.conversationId, input.conversationId),
          eq(conversationProjects.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);

    if (project === undefined) {
      return { status: "not-found" };
    }

    const now = new Date();
    const [updated] = await tx
      .update(conversations)
      .set({
        title,
        description,
        orchestratorAgentId: input.orchestratorAgentId ?? null,
        updatedAt: now,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    if (updated === undefined) {
      return { status: "not-found" };
    }

    await tx
      .delete(conversationAgentMembers)
      .where(eq(conversationAgentMembers.conversationId, input.conversationId));

    await tx.insert(conversationAgentMembers).values(
      agentIds.map((agentId, position) => ({
        conversationId: input.conversationId,
        agentId,
        position,
        createdAt: now,
      })),
    );

    return {
      status: "updated",
      conversation: toConversation(updated, agentIds, toConversationProject(project)),
    };
  });
}

export async function updateConversationOrchestrator(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    orchestratorAgentId?: string;
  },
): Promise<UpdateConversationOrchestratorResult> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.type, "group"),
          eq(conversations.status, "active"),
        ),
      )
      .limit(1);

    if (conversation === undefined) {
      return { status: "not-found" };
    }

    if (input.orchestratorAgentId !== undefined) {
      const [agent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, input.orchestratorAgentId),
            eq(agents.ownerUserId, input.ownerUserId),
            eq(agents.status, "active"),
          ),
        )
        .limit(1);

      if (agent === undefined) {
        return { status: "agents-not-found" };
      }

      if (conversation.key !== defaultGroupConversationKey) {
        const [member] = await tx
          .select({ agentId: conversationAgentMembers.agentId })
          .from(conversationAgentMembers)
          .where(
            and(
              eq(conversationAgentMembers.conversationId, conversation.id),
              eq(conversationAgentMembers.agentId, input.orchestratorAgentId),
            ),
          )
          .limit(1);

        if (member === undefined) {
          return { status: "orchestrator-not-in-group" };
        }
      }
    }

    const updatedAt = new Date();
    const [updated] = await tx
      .update(conversations)
      .set({
        orchestratorAgentId: input.orchestratorAgentId ?? null,
        updatedAt,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    if (updated === undefined) {
      return { status: "not-found" };
    }

    const [conversationWithAgentIds] = await toConversationsWithAgentIds(
      db,
      [updated],
      { ownerUserId: input.ownerUserId },
    );

    return {
      status: "updated",
      conversation: conversationWithAgentIds ?? toConversation(updated),
    };
  });
}

export async function ensureDirectConversation(
  db: Db,
  input: { ownerUserId: string; agentId: string },
): Promise<Conversation | null> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, input.agentId),
        eq(agents.ownerUserId, input.ownerUserId),
        eq(agents.status, "active"),
      ),
    )
    .limit(1);

  if (agent === undefined) {
    return null;
  }

  const now = new Date();
  const [created] = await db
    .insert(conversations)
    .values({
      ownerUserId: input.ownerUserId,
      type: "direct",
      title: agent.name,
      directAgentId: agent.id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [conversations.ownerUserId, conversations.directAgentId],
    })
    .returning();

  if (created !== undefined) {
    return toConversation(created);
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.directAgentId, input.agentId),
      ),
    )
    .limit(1);

  if (conversation === undefined) {
    return null;
  }

  if (conversation.status === "archived") {
    const [restored] = await db
      .update(conversations)
      .set({
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id))
      .returning();

    return restored === undefined ? null : toConversation(restored);
  }

  return toConversation(conversation);
}

export async function listConversationsForUser(
  db: Db,
  input: { ownerUserId: string; status?: ConversationStatusFilter },
): Promise<Conversation[]> {
  const status = input.status ?? "active";
  const conditions = [eq(conversations.ownerUserId, input.ownerUserId)];

  if (status !== "all") {
    conditions.push(eq(conversations.status, status));
  }

  const rows = await db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt));

  return toConversationsWithAgentIds(db, rows, {
    ownerUserId: input.ownerUserId,
  });
}

export async function archiveGroupConversationForUser(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId: string },
): Promise<ArchiveGroupConversationResult> {
  const result = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.type, "group"),
        ),
      )
      .limit(1);

    if (conversation === undefined) {
      return { status: "not-found" as const };
    }

    if (conversation.key === defaultGroupConversationKey) {
      return { status: "reserved-key" as const };
    }

    const [updated] = await tx
      .update(conversations)
      .set({
        status: "archived",
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    if (updated === undefined) {
      return { status: "not-found" as const };
    }

    const agentIds = await getConversationAgentIdsForRow(tx, updated);

    return {
      status: "archived" as const,
      conversation: toConversation(updated, agentIds),
    };
  });

  return result;
}

export async function restoreGroupConversationForUser(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId: string },
): Promise<RestoreGroupConversationResult> {
  const result = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.type, "group"),
        ),
      )
      .limit(1);

    if (conversation === undefined) {
      return { status: "not-found" as const };
    }

    if (conversation.key === defaultGroupConversationKey) {
      return { status: "reserved-key" as const };
    }

    const [updated] = await tx
      .update(conversations)
      .set({
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    if (updated === undefined) {
      return { status: "not-found" as const };
    }

    const agentIds = await getConversationAgentIdsForRow(tx, updated);

    return {
      status: "restored" as const,
      conversation: toConversation(updated, agentIds),
    };
  });

  return result;
}

export async function deleteArchivedGroupConversationForUser(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId: string },
): Promise<DeleteArchivedGroupConversationResult> {
  const result = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({
        id: conversations.id,
        key: conversations.key,
        status: conversations.status,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.type, "group"),
        ),
      )
      .limit(1);

    if (conversation === undefined) {
      return { status: "not-found" as const };
    }

    if (conversation.key === defaultGroupConversationKey) {
      return { status: "reserved-key" as const };
    }

    if (conversation.status !== "archived") {
      return { status: "not-archived" as const };
    }

    await tx.delete(conversations).where(eq(conversations.id, input.conversationId));

    return { status: "deleted" as const };
  });

  return result;
}

export async function getConversationForUser(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId: string },
): Promise<Conversation | null> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  if (conversation === undefined) {
    return null;
  }

  const [conversationWithAgentIds] = await toConversationsWithAgentIds(
    db,
    [conversation],
    { ownerUserId: input.ownerUserId },
  );

  return conversationWithAgentIds ?? null;
}

export async function listConversationMessagesForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    limit?: number;
    before?: Date;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<ConversationMessage[] | null> {
  const conversation = await getConversationForUser(db, input);

  if (conversation === null) {
    return null;
  }

  const conditions = [eq(conversationMessages.conversationId, input.conversationId)];

  if (input.before !== undefined) {
    conditions.push(lt(conversationMessages.createdAt, input.before));
  }

  const rows = await db
    .select()
    .from(conversationMessages)
    .where(and(...conditions))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(input.limit ?? 50);

  const orderedRows = rows.reverse();
  const messageIds = orderedRows.map((row) => row.id);

  if (messageIds.length === 0) {
    return [];
  }

  const attachmentRows = await db
    .select({
      attachment: conversationMessageArtifacts,
      artifact: conversationArtifacts,
    })
    .from(conversationMessageArtifacts)
    .innerJoin(
      conversationArtifacts,
      eq(conversationArtifacts.id, conversationMessageArtifacts.artifactId),
    )
    .where(inArray(conversationMessageArtifacts.messageId, messageIds))
    .orderBy(
      asc(conversationMessageArtifacts.messageId),
      asc(conversationMessageArtifacts.position),
    );
  const attachmentsByMessage = new Map<string, ConversationMessageAttachment[]>();

  for (const row of attachmentRows) {
    const attachment = toConversationMessageAttachment(
      row.attachment,
      toConversationArtifact(row.artifact, {
        publicApiBaseUrl: input.publicApiBaseUrl,
        publicWebBaseUrl: input.publicWebBaseUrl,
      }),
    );
    const attachments = attachmentsByMessage.get(row.attachment.messageId) ?? [];
    attachments.push(attachment);
    attachmentsByMessage.set(row.attachment.messageId, attachments);
  }

  return orderedRows.map((row) =>
    toConversationMessage(row, attachmentsByMessage.get(row.id)),
  );
}

export async function listRecentDirectConversationMessagesForAgent(
  db: Db,
  input: {
    agentId: string;
    limit?: number;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<ConversationMessage[]> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.type, "direct"),
        eq(conversations.directAgentId, input.agentId),
      ),
    )
    .limit(1);

  if (conversation === undefined) {
    return [];
  }

  return (
    await listConversationMessagesForUser(db, {
      conversationId: conversation.id,
      ownerUserId: input.ownerUserId,
      limit: input.limit ?? 20,
      publicApiBaseUrl: input.publicApiBaseUrl,
      publicWebBaseUrl: input.publicWebBaseUrl,
    })
  ) ?? [];
}

export function buildRecentDirectMessagesPrompt(input: {
  agentName: string;
  agentNamesById?: Record<string, string>;
  messages: ConversationMessage[];
}): string | undefined {
  const history = input.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => {
      const role = conversationPromptRole(message, input.agentNamesById);

      return `${role}:\n${message.content.trim()}`;
    });

  if (history.length === 0) {
    return undefined;
  }

  return [
    "<recent_private_chat_history>",
    `These are the latest private one-on-one messages between the user and ${input.agentName}.`,
    "Use them only as background context for this group chat. Do not leak unrelated private details unless they are clearly relevant to the current group discussion.",
    "",
    history.join("\n\n"),
    "</recent_private_chat_history>",
  ].join("\n");
}

export async function listConversationGoalsForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<ConversationGoal[] | null> {
  const conversation = await getConversationForUser(db, input);

  if (conversation === null) {
    return null;
  }

  const goalRows = await db
    .select()
    .from(conversationGoals)
    .where(eq(conversationGoals.conversationId, input.conversationId))
    .orderBy(desc(conversationGoals.createdAt));

  if (goalRows.length === 0) {
    return [];
  }

  const taskRows = await db
    .select()
    .from(conversationGoalTasks)
    .where(inArray(conversationGoalTasks.goalId, goalRows.map((goal) => goal.id)))
    .orderBy(asc(conversationGoalTasks.index));

  const artifactRows = await db
    .select()
    .from(conversationArtifacts)
    .where(inArray(conversationArtifacts.goalId, goalRows.map((goal) => goal.id)))
    .orderBy(desc(conversationArtifacts.createdAt));
  const artifactsByGoalTask = new Map<string, ConversationArtifact[]>();

  for (const artifactRow of artifactRows) {
    if (artifactRow.goalTaskId === null) {
      continue;
    }

    const artifacts = artifactsByGoalTask.get(artifactRow.goalTaskId) ?? [];
    artifacts.push(
      toConversationArtifact(artifactRow, {
        publicApiBaseUrl: input.publicApiBaseUrl,
        publicWebBaseUrl: input.publicWebBaseUrl,
      }),
    );
    artifactsByGoalTask.set(artifactRow.goalTaskId, artifacts);
  }

  const tasksByGoalId = new Map<string, ConversationGoalTask[]>();
  for (const taskRow of taskRows) {
    const tasks = tasksByGoalId.get(taskRow.goalId) ?? [];
    tasks.push(
      toConversationGoalTask(taskRow, artifactsByGoalTask.get(taskRow.id), {
        conversationId: input.conversationId,
        publicWebBaseUrl: input.publicWebBaseUrl,
      }),
    );
    tasksByGoalId.set(taskRow.goalId, tasks);
  }

  return goalRows.map((goal) =>
    toConversationGoal(goal, tasksByGoalId.get(goal.id), {
      publicWebBaseUrl: input.publicWebBaseUrl,
    }),
  );
}
