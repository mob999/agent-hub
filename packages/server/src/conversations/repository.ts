import { createHash, randomUUID } from "node:crypto";

import type {
  AgentHubCreateTaskToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubUploadArtifactToolInput,
  AgentHubSendMessageToolInput,
  Conversation,
  ConversationArtifact,
  ConversationArtifactAction,
  ConversationArtifactActionType,
  ConversationId,
  ConversationMessage,
  ConversationArtifactDetails,
  ConversationArtifactRevision,
  ConversationTask,
  RunEvent,
} from "@agent-hub/core";
import {
  agents,
  conversationAgentMembers,
  conversationArtifactActions,
  conversationArtifacts,
  conversationArtifactRevisions,
  conversationMessages,
  conversationTasks,
  conversations,
  runEvents,
  runs,
  type Db,
} from "@agent-hub/db";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { getRunnableAgentForUser } from "../agents/repository.js";
import {
  buildArtifactDownloadUrl,
  conversationArtifactRevisionStorageKey,
  conversationArtifactStorageKey,
  sanitizeArtifactFilename,
  writeArtifactContent,
  writeArtifactTextContent,
  readArtifactContent,
} from "../artifacts/index.js";
import type { ArtifactActionQueueJob, RunQueueJob } from "../queue/index.js";

export const defaultGroupConversationKey = "all";
export const defaultGroupConversationTitle = "all";

type ConversationRow = typeof conversations.$inferSelect;
type ConversationMessageRow = typeof conversationMessages.$inferSelect;
type ConversationTaskRow = typeof conversationTasks.$inferSelect;
type ConversationArtifactRow = typeof conversationArtifacts.$inferSelect;
type ConversationArtifactRevisionRow =
  typeof conversationArtifactRevisions.$inferSelect;
type ConversationArtifactActionRow = typeof conversationArtifactActions.$inferSelect;

export type CreateGroupConversationResult =
  | { status: "created"; conversation: Conversation }
  | { status: "reserved-key" }
  | { status: "duplicate-key" }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-group" };

export type UpdateGroupConversationResult =
  | { status: "updated"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "reserved-key" }
  | { status: "duplicate-key" }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-group" };

export type UpdateConversationOrchestratorResult =
  | { status: "updated"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-group" };

export interface AppendRunEventResult {
  dispatchJobs: RunQueueJob[];
}

export interface AppendRunEventOptions {
  publicApiBaseUrl?: string;
}

export interface PersistConversationArtifactUploadInput {
  contentBase64: string;
  filename: string;
  mimeType?: string;
  publicApiBaseUrl?: string;
  runId: string;
  sizeBytes: number;
  storageRoot: string;
  taskId: string;
  title: string;
  kind?: ConversationArtifact["kind"];
  metadata?: Record<string, unknown>;
  targetPath?: string;
  displayMode?: string;
}

export interface CreateConversationArtifactRevisionInput {
  artifactId: string;
  content: string;
  editorUserId: string;
  ownerUserId: string;
  storageRoot: string;
  summary?: string;
}

export interface CreateConversationArtifactActionInput {
  artifactId: string;
  ownerUserId: string;
  revisionId?: string;
  type: ConversationArtifactActionType;
}

function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

export function normalizeGroupConversationTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function groupConversationKeyFromTitle(title: string): string {
  return normalizeGroupConversationTitle(title).toLowerCase();
}

export function toConversation(
  row: ConversationRow,
  agentIds?: string[],
): Conversation {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    type: row.type as Conversation["type"],
    key: optionalString(row.key),
    title: row.title,
    description: optionalString(row.description),
    directAgentId: optionalString(row.directAgentId),
    agentIds,
    orchestratorAgentId: optionalString(row.orchestratorAgentId),
    status: row.status as Conversation["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt?.toISOString(),
  };
}

export function toConversationMessage(
  row: ConversationMessageRow,
): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: row.senderType as ConversationMessage["senderType"],
    senderAgentId: optionalString(row.senderAgentId),
    runId: optionalString(row.runId),
    content: row.content,
    status: row.status as ConversationMessage["status"],
    error: optionalString(row.error),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationArtifact(
  row: ConversationArtifactRow,
  input: { publicApiBaseUrl?: string } = {},
): ConversationArtifact {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    taskId: optionalString(row.taskId),
    runId: row.runId,
    creatorAgentId: row.creatorAgentId,
    kind: row.kind as ConversationArtifact["kind"],
    status: row.status as ConversationArtifact["status"],
    title: row.title,
    filename: row.filename,
    mimeType: optionalString(row.mimeType),
    sizeBytes: row.sizeBytes,
    metadata: row.metadata ?? undefined,
    latestRevisionId: optionalString(row.latestRevisionId),
    downloadUrl:
      input.publicApiBaseUrl === undefined
        ? undefined
        : buildArtifactDownloadUrl({
            artifactId: row.id,
            publicApiBaseUrl: input.publicApiBaseUrl,
          }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationArtifactRevision(
  row: ConversationArtifactRevisionRow,
): ConversationArtifactRevision {
  return {
    id: row.id,
    artifactId: row.artifactId,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    runId: optionalString(row.runId),
    editorUserId: optionalString(row.editorUserId),
    contentHash: row.contentHash,
    summary: optionalString(row.summary),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toConversationArtifactAction(
  row: ConversationArtifactActionRow,
): ConversationArtifactAction {
  return {
    id: row.id,
    artifactId: row.artifactId,
    revisionId: optionalString(row.revisionId),
    type: row.type as ConversationArtifactAction["type"],
    status: row.status as ConversationArtifactAction["status"],
    runId: optionalString(row.runId),
    error: optionalString(row.error),
    result: row.result ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationTask(
  row: ConversationTaskRow,
  artifacts: ConversationArtifact[] = [],
): ConversationTask {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    creatorRunId: row.creatorRunId,
    orchestratorAgentId: row.orchestratorAgentId,
    assigneeAgentId: row.assigneeAgentId,
    assigneeRunId: optionalString(row.assigneeRunId),
    dispatchMessageId: optionalString(row.dispatchMessageId),
    title: row.title,
    description: optionalString(row.description),
    status: row.status as ConversationTask["status"],
    summary: optionalString(row.summary),
    resultArtifactIds: row.resultArtifactIds ?? undefined,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    completedAt: row.completedAt?.toISOString(),
    finalizerRunId: optionalString(row.finalizerRunId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function conversationPromptRole(
  message: ConversationMessage,
  agentNamesById: Record<string, string> = {},
): string {
  if (message.senderType === "user") {
    return "User";
  }

  if (message.senderType === "agent") {
    return message.senderAgentId === undefined
      ? "Agent"
      : agentNamesById[message.senderAgentId] ?? "Agent";
  }

  return "System";
}

export function buildConversationRunPrompt(input: {
  agentNamesById?: Record<string, string>;
  currentUserMessage: string;
  messages: ConversationMessage[];
}): string {
  const history = input.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => {
      const role = conversationPromptRole(message, input.agentNamesById);

      return `${role}:\n${message.content.trim()}`;
    });

  if (history.length === 0) {
    return input.currentUserMessage;
  }

  return [
    "<conversation_history>",
    history.join("\n\n"),
    "</conversation_history>",
    "",
    "<user_request>",
    input.currentUserMessage,
    "</user_request>",
  ].join("\n");
}

function getAssistantMessageContent(event: RunEvent): string | undefined {
  if (event.type === "message.delta") {
    return event.content;
  }

  return undefined;
}

async function listAgentIdsForUser(
  db: Db,
  input: { ownerUserId: string },
): Promise<string[]> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.ownerUserId, input.ownerUserId))
    .orderBy(asc(agents.createdAt));

  return rows.map((row) => row.id);
}

async function listConversationMemberAgentIds(
  db: Db,
  conversationIds: string[],
): Promise<Map<string, string[]>> {
  if (conversationIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      conversationId: conversationAgentMembers.conversationId,
      agentId: conversationAgentMembers.agentId,
    })
    .from(conversationAgentMembers)
    .where(inArray(conversationAgentMembers.conversationId, conversationIds))
    .orderBy(
      asc(conversationAgentMembers.conversationId),
      asc(conversationAgentMembers.position),
    );
  const membersByConversation = new Map<string, string[]>();

  for (const row of rows) {
    const members = membersByConversation.get(row.conversationId) ?? [];
    members.push(row.agentId);
    membersByConversation.set(row.conversationId, members);
  }

  return membersByConversation;
}

function includesOrNoOrchestrator(input: {
  agentIds: string[];
  orchestratorAgentId?: string;
}): boolean {
  return (
    input.orchestratorAgentId === undefined ||
    input.agentIds.includes(input.orchestratorAgentId)
  );
}

function compactUniqueStrings(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  ];
}

async function toConversationsWithAgentIds(
  db: Db,
  rows: ConversationRow[],
  input: { ownerUserId: string },
): Promise<Conversation[]> {
  const groupRows = rows.filter((row) => row.type === "group");
  const defaultGroupIds = groupRows
    .filter((row) => row.key === defaultGroupConversationKey)
    .map((row) => row.id);
  const customGroupIds = groupRows
    .filter((row) => row.key !== defaultGroupConversationKey)
    .map((row) => row.id);
  const allAgentIds =
    defaultGroupIds.length === 0
      ? []
      : await listAgentIdsForUser(db, { ownerUserId: input.ownerUserId });
  const customMemberIds = await listConversationMemberAgentIds(
    db,
    customGroupIds,
  );

  return rows.map((row) => {
    if (row.type !== "group") {
      return toConversation(row);
    }

    if (row.key === defaultGroupConversationKey) {
      return toConversation(row, allAgentIds);
    }

    return toConversation(row, customMemberIds.get(row.id) ?? []);
  });
}

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

  return conversation === undefined ? null : toConversation(conversation);
}

export async function listConversationsForUser(
  db: Db,
  input: { ownerUserId: string },
): Promise<Conversation[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.ownerUserId, input.ownerUserId))
    .orderBy(desc(conversations.updatedAt));

  return toConversationsWithAgentIds(db, rows, {
    ownerUserId: input.ownerUserId,
  });
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

  return rows.reverse().map(toConversationMessage);
}

export async function listConversationTasksForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    publicApiBaseUrl?: string;
  },
): Promise<ConversationTask[] | null> {
  const conversation = await getConversationForUser(db, input);

  if (conversation === null) {
    return null;
  }

  const rows = await db
    .select()
    .from(conversationTasks)
    .where(eq(conversationTasks.conversationId, input.conversationId))
    .orderBy(desc(conversationTasks.createdAt));

  const artifactRows = await db
    .select()
    .from(conversationArtifacts)
    .where(eq(conversationArtifacts.conversationId, input.conversationId))
    .orderBy(desc(conversationArtifacts.createdAt));
  const artifactsByTask = new Map<string, ConversationArtifact[]>();

  for (const artifactRow of artifactRows) {
    if (artifactRow.taskId === null) {
      continue;
    }

    const artifacts = artifactsByTask.get(artifactRow.taskId) ?? [];
    artifacts.push(
      toConversationArtifact(artifactRow, {
        publicApiBaseUrl: input.publicApiBaseUrl,
      }),
    );
    artifactsByTask.set(artifactRow.taskId, artifacts);
  }

  return rows.map((row) => toConversationTask(row, artifactsByTask.get(row.id)));
}

export async function listConversationArtifactsForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    publicApiBaseUrl?: string;
  },
): Promise<ConversationArtifact[] | null> {
  const conversation = await getConversationForUser(db, input);

  if (conversation === null) {
    return null;
  }

  const rows = await db
    .select()
    .from(conversationArtifacts)
    .where(eq(conversationArtifacts.conversationId, input.conversationId))
    .orderBy(desc(conversationArtifacts.createdAt));

  return rows.map((row) =>
    toConversationArtifact(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
    }),
  );
}

export async function getConversationArtifactForUser(
  db: Db,
  input: { artifactId: string; ownerUserId: string; publicApiBaseUrl?: string },
): Promise<
  | { artifact: ConversationArtifact; storageKey: string; mimeType: string | null }
  | null
> {
  const [row] = await db
    .select()
    .from(conversationArtifacts)
    .where(
      and(
        eq(conversationArtifacts.id, input.artifactId),
        eq(conversationArtifacts.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  if (row === undefined) {
    return null;
  }

  return {
    artifact: toConversationArtifact(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
    }),
    storageKey: row.storageKey,
    mimeType: row.mimeType,
  };
}

function availableArtifactActions(
  artifact: ConversationArtifact,
): ConversationArtifactActionType[] {
  if (artifact.status !== "ready") {
    return [];
  }

  switch (artifact.kind) {
    case "diff":
      return ["apply"];
    case "file":
    case "document":
    case "report":
      return ["apply", "preview", "publish"];
    case "web_preview":
      return ["preview"];
    case "deployment":
    case "workflow_result":
    case "image":
    case "slide_deck":
      return [];
  }
}

export async function getConversationArtifactDetailsForUser(
  db: Db,
  input: { artifactId: string; ownerUserId: string; publicApiBaseUrl?: string },
): Promise<ConversationArtifactDetails | null> {
  const record = await getConversationArtifactForUser(db, input);

  if (record === null) {
    return null;
  }

  const [latestRevision] = record.artifact.latestRevisionId === undefined
    ? []
    : await db
        .select()
        .from(conversationArtifactRevisions)
        .where(eq(conversationArtifactRevisions.id, record.artifact.latestRevisionId))
        .limit(1);
  const actionRows = await db
    .select()
    .from(conversationArtifactActions)
    .where(eq(conversationArtifactActions.artifactId, input.artifactId))
    .orderBy(desc(conversationArtifactActions.createdAt));

  return {
    artifact: record.artifact,
    latestRevision:
      latestRevision === undefined
        ? undefined
        : toConversationArtifactRevision(latestRevision),
    actions: actionRows.map(toConversationArtifactAction),
    availableActions: availableArtifactActions(record.artifact),
  };
}

export async function getConversationArtifactContentForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    revisionId?: string;
    storageRoot: string;
  },
): Promise<
  | { content: string; revision?: ConversationArtifactRevision }
  | null
> {
  const record = await getConversationArtifactForUser(db, input);

  if (record === null) {
    return null;
  }

  if (input.revisionId !== undefined) {
    const [revisionRow] = await db
      .select()
      .from(conversationArtifactRevisions)
      .where(
        and(
          eq(conversationArtifactRevisions.id, input.revisionId),
          eq(conversationArtifactRevisions.artifactId, input.artifactId),
          eq(conversationArtifactRevisions.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);

    if (revisionRow === undefined) {
      return null;
    }

    const content = await readArtifactContent({
      storageKey: revisionRow.storageKey,
      storageRoot: input.storageRoot,
    });

    return {
      content: content.toString("utf8"),
      revision: toConversationArtifactRevision(revisionRow),
    };
  }

  const content = await readArtifactContent({
    storageKey: record.storageKey,
    storageRoot: input.storageRoot,
  });

  return { content: content.toString("utf8") };
}

export async function createConversationArtifactRevision(
  db: Db,
  input: CreateConversationArtifactRevisionInput,
): Promise<ConversationArtifactRevision | null> {
  const record = await getConversationArtifactForUser(db, {
    artifactId: input.artifactId,
    ownerUserId: input.ownerUserId,
  });

  if (record === null) {
    return null;
  }

  const revisionId = randomUUID();
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  const storageKey = conversationArtifactRevisionStorageKey({
    artifactId: input.artifactId,
    conversationId: record.artifact.conversationId,
    filename: record.artifact.filename,
    revisionId,
  });
  await writeArtifactTextContent({
    content: input.content,
    storageKey,
    storageRoot: input.storageRoot,
  });

  const now = new Date();
  const [revision] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversationArtifactRevisions)
      .values({
        id: revisionId,
        artifactId: input.artifactId,
        ownerUserId: input.ownerUserId,
        conversationId: record.artifact.conversationId,
        runId: record.artifact.runId,
        editorUserId: input.editorUserId,
        storageKey,
        contentHash,
        summary: input.summary,
        createdAt: now,
      })
      .returning();

    await tx
      .update(conversationArtifacts)
      .set({
        latestRevisionId: revisionId,
        updatedAt: now,
      })
      .where(eq(conversationArtifacts.id, input.artifactId));

    return [created];
  });

  return revision === undefined ? null : toConversationArtifactRevision(revision);
}

export async function createConversationArtifactAction(
  db: Db,
  input: CreateConversationArtifactActionInput,
): Promise<
  | { action: ConversationArtifactAction; job: ArtifactActionQueueJob }
  | null
> {
  const record = await getConversationArtifactForUser(db, {
    artifactId: input.artifactId,
    ownerUserId: input.ownerUserId,
  });

  if (record === null) {
    return null;
  }

  const [run] = await db
    .select({
      daemonDeviceId: runs.daemonDeviceId,
      workspacePath: runs.workspacePath,
    })
    .from(runs)
    .where(eq(runs.id, record.artifact.runId))
    .limit(1);

  if (run === undefined) {
    return null;
  }

  let revisionId = input.revisionId ?? record.artifact.latestRevisionId;

  if (revisionId !== undefined) {
    const [revision] = await db
      .select({ id: conversationArtifactRevisions.id })
      .from(conversationArtifactRevisions)
      .where(
        and(
          eq(conversationArtifactRevisions.id, revisionId),
          eq(conversationArtifactRevisions.artifactId, input.artifactId),
          eq(conversationArtifactRevisions.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);

    if (revision === undefined) {
      return null;
    }
  } else if (input.type !== "preview" && input.type !== "publish") {
    revisionId = undefined;
  }

  const now = new Date();
  const [actionRow] = await db
    .insert(conversationArtifactActions)
    .values({
      artifactId: input.artifactId,
      revisionId,
      ownerUserId: input.ownerUserId,
      conversationId: record.artifact.conversationId,
      type: input.type,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (actionRow === undefined) {
    return null;
  }

  return {
    action: toConversationArtifactAction(actionRow),
    job: {
      actionId: actionRow.id,
      artifactId: input.artifactId,
      actionType: input.type,
      daemonDeviceId: run.daemonDeviceId,
      revisionId,
      workspacePath: run.workspacePath,
    },
  };
}

export async function getArtifactActionAssignment(
  db: Db,
  input: { actionId: string; storageRoot: string },
): Promise<
  | {
      actionId: string;
      actionType: ConversationArtifactActionType;
      artifactId: string;
      contentBase64: string;
      daemonDeviceId: string;
      filename: string;
      metadata?: Record<string, unknown>;
      targetPath?: string;
      workspacePath: string;
    }
  | null
> {
  const [row] = await db
    .select({
      action: conversationArtifactActions,
      artifact: conversationArtifacts,
      revision: conversationArtifactRevisions,
      run: runs,
    })
    .from(conversationArtifactActions)
    .innerJoin(
      conversationArtifacts,
      eq(conversationArtifactActions.artifactId, conversationArtifacts.id),
    )
    .innerJoin(runs, eq(conversationArtifacts.runId, runs.id))
    .leftJoin(
      conversationArtifactRevisions,
      eq(conversationArtifactActions.revisionId, conversationArtifactRevisions.id),
    )
    .where(eq(conversationArtifactActions.id, input.actionId))
    .limit(1);

  if (row === undefined) {
    return null;
  }

  const storageKey = row.revision?.storageKey ?? row.artifact.storageKey;
  const content = await readArtifactContent({
    storageKey,
    storageRoot: input.storageRoot,
  });
  const metadata = row.artifact.metadata ?? {};

  return {
    actionId: row.action.id,
    actionType: row.action.type as ConversationArtifactActionType,
    artifactId: row.artifact.id,
    contentBase64: content.toString("base64"),
    daemonDeviceId: row.run.daemonDeviceId,
    filename: row.artifact.filename,
    metadata,
    targetPath: typeof metadata.targetPath === "string"
      ? metadata.targetPath
      : undefined,
    workspacePath: row.run.workspacePath,
  };
}

export async function markConversationArtifactActionRunning(
  db: Db,
  input: { actionId: string },
): Promise<void> {
  await db
    .update(conversationArtifactActions)
    .set({
      status: "running",
      updatedAt: new Date(),
    })
    .where(eq(conversationArtifactActions.id, input.actionId));
}

export async function completeConversationArtifactAction(
  db: Db,
  input: {
    actionId: string;
    error?: string;
    result?: Record<string, unknown>;
    status: "succeeded" | "failed" | "cancelled";
  },
): Promise<void> {
  await db
    .update(conversationArtifactActions)
    .set({
      status: input.status,
      error: input.error,
      result: input.result,
      updatedAt: new Date(),
    })
    .where(eq(conversationArtifactActions.id, input.actionId));
}

export async function persistConversationArtifactUpload(
  db: Db,
  input: PersistConversationArtifactUploadInput,
): Promise<ConversationArtifact> {
  const [run] = await db
    .select({
      agentId: runs.agentId,
      conversationId: runs.conversationId,
      ownerUserId: runs.ownerUserId,
    })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .limit(1);

  if (run === undefined || run.conversationId === null) {
    throw new Error("Artifact upload run was not found.");
  }

  const [task] = await db
    .select()
    .from(conversationTasks)
    .where(
      and(
        eq(conversationTasks.id, input.taskId),
        eq(conversationTasks.conversationId, run.conversationId),
        eq(conversationTasks.assigneeRunId, input.runId),
        eq(conversationTasks.assigneeAgentId, run.agentId),
      ),
    )
    .limit(1);

  if (task === undefined) {
    throw new Error("Artifact task does not belong to this run.");
  }

  const artifactId = randomUUID();
  const filename = sanitizeArtifactFilename(input.filename);
  const storageKey = conversationArtifactStorageKey({
    artifactId,
    conversationId: run.conversationId,
    filename,
  });
  const writtenBytes = await writeArtifactContent({
    contentBase64: input.contentBase64,
    storageKey,
    storageRoot: input.storageRoot,
  });

  if (writtenBytes !== input.sizeBytes) {
    throw new Error("Artifact content size did not match upload metadata.");
  }

  const now = new Date();
  const [artifact] = await db
    .insert(conversationArtifacts)
    .values({
      id: artifactId,
      ownerUserId: run.ownerUserId,
      conversationId: run.conversationId,
      taskId: task.id,
      runId: input.runId,
      creatorAgentId: run.agentId,
      kind: input.kind ?? "report",
      status: "ready",
      title: input.title.trim(),
      filename,
      mimeType: input.mimeType,
      sizeBytes: writtenBytes,
      storageKey,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.targetPath === undefined ? {} : { targetPath: input.targetPath }),
        ...(input.displayMode === undefined
          ? {}
          : { displayMode: input.displayMode }),
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (artifact === undefined) {
    throw new Error("Artifact upload could not be persisted.");
  }

  return toConversationArtifact(artifact, {
    publicApiBaseUrl: input.publicApiBaseUrl,
  });
}

export async function createUserMessageAndRun(
  db: Db,
  input: {
    ownerUserId: string;
    conversationId: ConversationId;
    job: RunQueueJob;
    userMessageContent: string;
  },
): Promise<{
  conversation: Conversation;
  messages: {
    user: ConversationMessage;
    assistant: ConversationMessage;
  };
} | null> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
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

    const createdAt = new Date(input.job.run.createdAt);
    const [userMessage] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: input.conversationId,
        senderType: "user",
        content: input.userMessageContent,
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    await tx.insert(runs).values({
      id: input.job.run.id,
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      agentId: input.job.run.agentId,
      daemonDeviceId: input.job.daemonDeviceId,
      status: input.job.run.status,
      prompt: input.job.prompt,
      workspacePath: input.job.workspacePath,
      runtime: input.job.runtime,
      createdAt,
      updatedAt: createdAt,
    });

    const queuedEvent: RunEvent = {
      type: "run.queued",
      runId: input.job.run.id,
      agentId: input.job.run.agentId,
      daemonDeviceId: input.job.daemonDeviceId,
      createdAt: input.job.run.createdAt,
    };

    await tx.insert(runEvents).values({
      runId: input.job.run.id,
      eventType: queuedEvent.type,
      payload: queuedEvent,
      createdAt,
    });

    const assistantCreatedAt = new Date(createdAt.getTime() + 1);
    const [assistantMessage] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: input.conversationId,
        senderType: "agent",
        senderAgentId: input.job.run.agentId,
        runId: input.job.run.id,
        content: "",
        status: "streaming",
        createdAt: assistantCreatedAt,
        updatedAt: assistantCreatedAt,
      })
      .returning();

    const [updatedConversation] = await tx
      .update(conversations)
      .set({
        lastMessageAt: assistantCreatedAt,
        updatedAt: assistantCreatedAt,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    return {
      conversation: toConversation(updatedConversation ?? conversation),
      messages: {
        user: toConversationMessage(userMessage),
        assistant: toConversationMessage(assistantMessage),
      },
    };
  });
}

export async function createUserMessageAndRuns(
  db: Db,
  input: {
    ownerUserId: string;
    conversationId: ConversationId;
    jobs: RunQueueJob[];
    userMessageContent: string;
  },
): Promise<{
  conversation: Conversation;
  messages: {
    user: ConversationMessage;
    assistants: ConversationMessage[];
  };
} | null> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
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

    const createdAt = new Date(input.jobs[0]?.run.createdAt ?? new Date());
    const [userMessage] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: input.conversationId,
        senderType: "user",
        content: input.userMessageContent,
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    if (input.jobs.length > 0) {
      await tx.insert(runs).values(
        input.jobs.map((job) => ({
          id: job.run.id,
          ownerUserId: input.ownerUserId,
          conversationId: input.conversationId,
          agentId: job.run.agentId,
          daemonDeviceId: job.daemonDeviceId,
          status: job.run.status,
          prompt: job.prompt,
          workspacePath: job.workspacePath,
          runtime: job.runtime,
          createdAt: new Date(job.run.createdAt),
          updatedAt: new Date(job.run.updatedAt),
        })),
      );

      await tx.insert(runEvents).values(
        input.jobs.map((job) => {
          const queuedEvent: RunEvent = {
            type: "run.queued",
            runId: job.run.id,
            agentId: job.run.agentId,
            daemonDeviceId: job.daemonDeviceId,
            createdAt: job.run.createdAt,
          };

          return {
            runId: job.run.id,
            eventType: queuedEvent.type,
            payload: queuedEvent,
            createdAt: new Date(job.run.createdAt),
          };
        }),
      );
    }

    const [updatedConversation] = await tx
      .update(conversations)
      .set({
        lastMessageAt: createdAt,
        updatedAt: createdAt,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    return {
      conversation: toConversation(updatedConversation ?? conversation),
      messages: {
        user: toConversationMessage(userMessage),
        assistants: [],
      },
    };
  });
}

function readSendMessageToolInput(
  input: unknown,
): AgentHubSendMessageToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("content" in input)
  ) {
    return null;
  }

  const content = (input as AgentHubSendMessageToolInput).content;

  return typeof content === "string" && content.trim().length > 0
    ? (input as AgentHubSendMessageToolInput)
    : null;
}

function readCreateTaskToolInput(
  input: unknown,
): AgentHubCreateTaskToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("title" in input) ||
    !("assigneeAgentId" in input)
  ) {
    return null;
  }

  const taskInput = input as AgentHubCreateTaskToolInput;
  const title = taskInput.title.trim();
  const description = taskInput.description?.trim();

  return title.length > 0 &&
    title.length <= 160 &&
    typeof taskInput.assigneeAgentId === "string" &&
    taskInput.assigneeAgentId.length > 0
    ? {
        title,
        description: description && description.length > 0 ? description : undefined,
        assigneeAgentId: taskInput.assigneeAgentId,
        taskId: taskInput.taskId,
      }
    : null;
}

function readUploadArtifactToolInput(
  input: unknown,
): AgentHubUploadArtifactToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("taskId" in input) ||
    !("title" in input) ||
    !("localPath" in input)
  ) {
    return null;
  }

  const artifactInput = input as AgentHubUploadArtifactToolInput;
  const title = artifactInput.title.trim();
  const localPath = artifactInput.localPath.trim();
  const filename = artifactInput.filename?.trim();
  const mimeType = artifactInput.mimeType?.trim();
  const targetPath = artifactInput.targetPath?.trim();

  return title.length > 0 &&
    title.length <= 160 &&
    typeof artifactInput.taskId === "string" &&
    artifactInput.taskId.length > 0 &&
    localPath.length > 0
    ? {
        taskId: artifactInput.taskId,
        title,
        localPath,
        kind: artifactInput.kind,
        filename: filename && filename.length > 0 ? filename : undefined,
        mimeType: mimeType && mimeType.length > 0 ? mimeType : undefined,
        metadata: artifactInput.metadata,
        targetPath: targetPath && targetPath.length > 0 ? targetPath : undefined,
        displayMode: artifactInput.displayMode,
      }
    : null;
}

function readCompleteTaskToolInput(
  input: unknown,
): AgentHubCompleteTaskToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("taskId" in input) ||
    !("summary" in input)
  ) {
    return null;
  }

  const taskInput = input as AgentHubCompleteTaskToolInput;
  const summary = taskInput.summary.trim();
  const artifactIds = Array.isArray(taskInput.artifactIds)
    ? compactUniqueStrings(taskInput.artifactIds)
    : undefined;

  return typeof taskInput.taskId === "string" &&
    taskInput.taskId.length > 0 &&
    summary.length > 0
    ? {
        taskId: taskInput.taskId,
        summary,
        artifactIds,
      }
    : null;
}

function mentionAgentIds(input: AgentHubSendMessageToolInput): string[] {
  return compactUniqueStrings(
    input.mentions
      ?.filter((mention) => mention.type === "agent")
      .map((mention) => mention.agentId) ?? [],
  );
}

function isDefaultGroup(row: Pick<ConversationRow, "key" | "type">): boolean {
  return row.type === "group" && row.key === defaultGroupConversationKey;
}

async function isConversationAgentMember(
  db: Db,
  input: {
    agentId: string;
    conversation: Pick<ConversationRow, "id" | "key" | "ownerUserId" | "type">;
  },
): Promise<boolean> {
  if (input.conversation.type !== "group") {
    return false;
  }

  if (isDefaultGroup(input.conversation)) {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, input.agentId),
          eq(agents.ownerUserId, input.conversation.ownerUserId),
        ),
      )
      .limit(1);

    return agent !== undefined;
  }

  const [member] = await db
    .select({ agentId: conversationAgentMembers.agentId })
    .from(conversationAgentMembers)
    .where(
      and(
        eq(conversationAgentMembers.conversationId, input.conversation.id),
        eq(conversationAgentMembers.agentId, input.agentId),
      ),
    )
    .limit(1);

  return member !== undefined;
}

function buildAssignedTaskPrompt(input: {
  conversationTitle: string;
  taskTitle: string;
  taskDescription?: string;
  dispatchMessage: string;
}): string {
  return [
    "<agenthub_assigned_task>",
    `Group: #${input.conversationTitle}`,
    `Task: ${input.taskTitle}`,
    input.taskDescription ? `Description: ${input.taskDescription}` : undefined,
    "",
    "You were assigned this task by the group orchestrator.",
    "Create the requested report or result file in your current workspace.",
    "Upload the report with AgentHub MCP upload_artifact, then call complete_task with a concise summary and the uploaded artifact id.",
    "Use send_message only for optional visible progress updates. Do not use normal assistant text as the visible group reply.",
    "</agenthub_assigned_task>",
    "",
    "<orchestrator_dispatch_message>",
    input.dispatchMessage,
    "</orchestrator_dispatch_message>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function buildAssignedTaskInstructions(input: {
  agentDescription?: string;
  conversationTitle: string;
}): string {
  return [
    input.agentDescription === undefined || input.agentDescription.trim().length === 0
      ? undefined
      : [
          "AgentHub agent profile:",
          "Follow this agent profile when working on the assigned task.",
          "",
          input.agentDescription.trim(),
        ].join("\n"),
    `You are working inside AgentHub group #${input.conversationTitle}.`,
    "Visible task updates must be sent with send_message. Completed work must be reported with upload_artifact and complete_task.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n\n");
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "succeeded" ||
    status === "failed" ||
    status === "cancelled";
}

async function maybeCreateFinalizationRun(
  db: Db,
  input: {
    creatorRunId: string;
    createdAt: Date;
    dispatchJobs: RunQueueJob[];
    publicApiBaseUrl?: string;
  },
): Promise<void> {
  const taskRows = await db
    .select()
    .from(conversationTasks)
    .where(eq(conversationTasks.creatorRunId, input.creatorRunId))
    .orderBy(asc(conversationTasks.createdAt));

  if (
    taskRows.length === 0 ||
    taskRows.some((task) => task.finalizerRunId !== null) ||
    taskRows.some((task) => !isTerminalTaskStatus(task.status))
  ) {
    return;
  }

  const firstTask = taskRows[0];
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, firstTask.conversationId))
    .limit(1);

  if (
    conversation === undefined ||
    conversation.orchestratorAgentId === null
  ) {
    return;
  }

  const runAgent = await getRunnableAgentForUser(db, {
    agentId: conversation.orchestratorAgentId,
    ownerUserId: firstTask.ownerUserId,
  });

  if (runAgent === null) {
    return;
  }

  const artifactRows = await db
    .select()
    .from(conversationArtifacts)
    .where(inArray(conversationArtifacts.taskId, taskRows.map((task) => task.id)))
    .orderBy(asc(conversationArtifacts.createdAt));
  const artifactsByTask = new Map<string, ConversationArtifact[]>();

  for (const artifactRow of artifactRows) {
    if (artifactRow.taskId === null) {
      continue;
    }

    const artifacts = artifactsByTask.get(artifactRow.taskId) ?? [];
    artifacts.push(
      toConversationArtifact(artifactRow, {
        publicApiBaseUrl: input.publicApiBaseUrl,
      }),
    );
    artifactsByTask.set(artifactRow.taskId, artifacts);
  }

  const [creatorRun] = await db
    .select({ prompt: runs.prompt })
    .from(runs)
    .where(eq(runs.id, input.creatorRunId))
    .limit(1);
  const runId = randomUUID();
  const createdAtIso = input.createdAt.toISOString();
  const taskSummaries = taskRows.map((task, index) => {
    const artifacts = artifactsByTask.get(task.id) ?? [];
    const artifactLines = artifacts.length === 0
      ? ["Artifacts: none"]
      : [
          "Artifacts:",
          ...artifacts.map(
            (artifact) =>
              `- ${artifact.title}: ${artifact.downloadUrl ?? `/artifacts/${artifact.id}/download`}`,
          ),
        ];

    return [
      `Task ${index + 1}: ${task.title}`,
      `Assignee agent id: ${task.assigneeAgentId}`,
      `Status: ${task.status}`,
      task.summary ? `Summary: ${task.summary}` : "Summary: none",
      ...artifactLines,
    ].join("\n");
  });
  const prompt = [
    "<agenthub_task_finalization>",
    `Group: #${conversation.title}`,
    "All tasks created by this Orchestrator run reached a terminal state.",
    "Send one final Markdown summary to the user with the AgentHub MCP send_message tool.",
    "Include any report download links listed below.",
    "</agenthub_task_finalization>",
    "",
    "<original_user_request>",
    creatorRun?.prompt ?? "",
    "</original_user_request>",
    "",
    "<task_results>",
    taskSummaries.join("\n\n"),
    "</task_results>",
  ].join("\n");
  const job: RunQueueJob = {
    conversationId: conversation.id,
    daemonDeviceId: runAgent.daemonDeviceId,
    prompt,
    agentInstructions: [
      runAgent.agent.description?.trim()
        ? `AgentHub agent profile:\n${runAgent.agent.description.trim()}`
        : undefined,
      "You are the Orchestrator finalizing a completed group Task mode workflow.",
      "Use only AgentHub MCP send_message for the visible final response.",
    ].filter((line): line is string => line !== undefined).join("\n\n"),
    agentHubMcpTools: ["send_message"],
    workspacePath: runAgent.workspacePath,
    run: {
      id: runId,
      agentId: runAgent.agent.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      status: "queued",
      createdAt: createdAtIso,
      updatedAt: createdAtIso,
    },
    runtime: runAgent.runtime,
  };
  const queuedEvent: RunEvent = {
    type: "run.queued",
    runId,
    agentId: runAgent.agent.id,
    daemonDeviceId: runAgent.daemonDeviceId,
    createdAt: createdAtIso,
  };

  await db.transaction(async (tx) => {
    const lockedTasks = await tx
      .select()
      .from(conversationTasks)
      .where(eq(conversationTasks.creatorRunId, input.creatorRunId));

    if (
      lockedTasks.some((task) => task.finalizerRunId !== null) ||
      lockedTasks.some((task) => !isTerminalTaskStatus(task.status))
    ) {
      return;
    }

    await tx.insert(runs).values({
      id: runId,
      ownerUserId: firstTask.ownerUserId,
      conversationId: conversation.id,
      agentId: runAgent.agent.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      status: "queued",
      prompt,
      workspacePath: runAgent.workspacePath,
      runtime: runAgent.runtime,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });

    await tx.insert(runEvents).values({
      runId,
      eventType: queuedEvent.type,
      payload: queuedEvent,
      createdAt: input.createdAt,
    });

    await tx
      .update(conversationTasks)
      .set({
        finalizerRunId: runId,
        updatedAt: input.createdAt,
      })
      .where(eq(conversationTasks.creatorRunId, input.creatorRunId));

    input.dispatchJobs.push(job);
  });
}

export async function appendRunEventToConversationMessage(
  db: Db,
  event: RunEvent,
  options: AppendRunEventOptions = {},
): Promise<AppendRunEventResult> {
  const dispatchJobs: RunQueueJob[] = [];

  if (event.type === "run.started" || event.type === "run.completed") {
    const updatedAt = new Date(event.createdAt);
    const updatedTasks = await db
      .update(conversationTasks)
      .set({
        status: event.type === "run.started"
          ? "running"
          : event.status === "succeeded"
            ? sql`case when ${conversationTasks.status} = 'succeeded' then 'succeeded' else 'failed' end`
            : event.status,
        updatedAt,
      })
      .where(eq(conversationTasks.assigneeRunId, event.runId))
      .returning({
        creatorRunId: conversationTasks.creatorRunId,
      });

    if (event.type === "run.completed") {
      for (const creatorRunId of compactUniqueStrings(
        updatedTasks.map((task) => task.creatorRunId),
      )) {
        await maybeCreateFinalizationRun(db, {
          creatorRunId,
          createdAt: updatedAt,
          dispatchJobs,
          publicApiBaseUrl: options.publicApiBaseUrl,
        });
      }
    }
  }

  if (event.type === "agenthub.tool.call") {
    if (event.name === "create_task") {
      const input = readCreateTaskToolInput(event.input);

      if (input === null) {
        return { dispatchJobs };
      }

      const [run] = await db
        .select({
          agentId: runs.agentId,
          conversationId: runs.conversationId,
          ownerUserId: runs.ownerUserId,
        })
        .from(runs)
        .where(eq(runs.id, event.runId))
        .limit(1);

      if (run === undefined || run.conversationId === null) {
        return { dispatchJobs };
      }

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, run.conversationId),
            eq(conversations.ownerUserId, run.ownerUserId),
            eq(conversations.type, "group"),
          ),
        )
        .limit(1);

      if (
        conversation === undefined ||
        conversation.orchestratorAgentId !== run.agentId ||
        !(await isConversationAgentMember(db, {
          agentId: input.assigneeAgentId,
          conversation,
        }))
      ) {
        return { dispatchJobs };
      }

      const createdAt = new Date(event.createdAt);
      await db
        .insert(conversationTasks)
        .values({
          id: input.taskId ?? randomUUID(),
          ownerUserId: run.ownerUserId,
          conversationId: conversation.id,
          creatorRunId: event.runId,
          orchestratorAgentId: run.agentId,
          assigneeAgentId: input.assigneeAgentId,
          title: input.title,
          description: input.description,
          status: "created",
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing();

      return { dispatchJobs };
    }

    if (event.name === "upload_artifact") {
      const input = readUploadArtifactToolInput(event.input);

      if (input === null) {
        return { dispatchJobs };
      }

      return { dispatchJobs };
    }

    if (event.name === "complete_task") {
      const input = readCompleteTaskToolInput(event.input);

      if (input === null) {
        return { dispatchJobs };
      }

      const [run] = await db
        .select({
          agentId: runs.agentId,
          conversationId: runs.conversationId,
          ownerUserId: runs.ownerUserId,
        })
        .from(runs)
        .where(eq(runs.id, event.runId))
        .limit(1);

      if (run === undefined || run.conversationId === null) {
        return { dispatchJobs };
      }

      const updatedAt = new Date(event.createdAt);
      const [task] = await db
        .select()
        .from(conversationTasks)
        .where(
          and(
            eq(conversationTasks.id, input.taskId),
            eq(conversationTasks.conversationId, run.conversationId),
            eq(conversationTasks.assigneeRunId, event.runId),
            eq(conversationTasks.assigneeAgentId, run.agentId),
          ),
        )
        .limit(1);

      if (task === undefined) {
        return { dispatchJobs };
      }

      const artifactIds = input.artifactIds ?? [];

      if (artifactIds.length > 0) {
        const artifactRows = await db
          .select({ id: conversationArtifacts.id })
          .from(conversationArtifacts)
          .where(
            and(
              eq(conversationArtifacts.conversationId, run.conversationId),
              eq(conversationArtifacts.taskId, task.id),
              eq(conversationArtifacts.runId, event.runId),
              inArray(conversationArtifacts.id, artifactIds),
            ),
          );

        if (artifactRows.length !== artifactIds.length) {
          return { dispatchJobs };
        }
      }

      await db
        .update(conversationTasks)
        .set({
          status: "succeeded",
          summary: input.summary,
          resultArtifactIds: artifactIds,
          completedAt: updatedAt,
          updatedAt,
        })
        .where(eq(conversationTasks.id, task.id));

      await maybeCreateFinalizationRun(db, {
        creatorRunId: task.creatorRunId,
        createdAt: updatedAt,
        dispatchJobs,
        publicApiBaseUrl: options.publicApiBaseUrl,
      });

      return { dispatchJobs };
    }

    if (event.name !== "send_message") {
      return { dispatchJobs };
    }

    const input = readSendMessageToolInput(event.input);

    if (input === null) {
      return { dispatchJobs };
    }

    const content = input.content.trim();

    if (content.length === 0) {
      return { dispatchJobs };
    }

    const [run] = await db
      .select({
        agentId: runs.agentId,
        conversationId: runs.conversationId,
        ownerUserId: runs.ownerUserId,
      })
      .from(runs)
      .where(eq(runs.id, event.runId))
      .limit(1);

    if (run === undefined || run.conversationId === null) {
      return { dispatchJobs };
    }

    const conversationId = run.conversationId;
    const createdAt = new Date(event.createdAt);
    await db.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (conversation === undefined) {
        return;
      }

      const [message] = await tx.insert(conversationMessages).values({
        conversationId: conversation.id,
        senderType: "agent",
        senderAgentId: run.agentId,
        runId: event.runId,
        content,
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      }).returning();

      const taskIds = compactUniqueStrings(input.taskIds ?? []);
      const mentionedAgentIds = mentionAgentIds(input);

      if (taskIds.length > 0 && mentionedAgentIds.length > 0) {
        const taskRows = await tx
          .select()
          .from(conversationTasks)
          .where(
            and(
              eq(conversationTasks.conversationId, conversation.id),
              eq(conversationTasks.creatorRunId, event.runId),
              eq(conversationTasks.orchestratorAgentId, run.agentId),
              inArray(conversationTasks.id, taskIds),
              inArray(conversationTasks.assigneeAgentId, mentionedAgentIds),
              eq(conversationTasks.status, "created"),
            ),
          )
          .orderBy(asc(conversationTasks.createdAt));

        for (const task of taskRows) {
          const runAgent = await getRunnableAgentForUser(db, {
            agentId: task.assigneeAgentId,
            ownerUserId: run.ownerUserId,
          });

          if (runAgent === null) {
            continue;
          }

          const runId = randomUUID();
          const job: RunQueueJob = {
            conversationId: conversation.id,
            daemonDeviceId: runAgent.daemonDeviceId,
            prompt: buildAssignedTaskPrompt({
              conversationTitle: conversation.title,
              taskTitle: task.title,
              taskDescription: optionalString(task.description),
              dispatchMessage: content,
            }),
            agentInstructions: buildAssignedTaskInstructions({
              agentDescription: runAgent.agent.description,
              conversationTitle: conversation.title,
            }),
            agentHubMcpTools: [
              "send_message",
              "upload_artifact",
              "complete_task",
            ],
            workspacePath: runAgent.workspacePath,
            run: {
              id: runId,
              agentId: runAgent.agent.id,
              daemonDeviceId: runAgent.daemonDeviceId,
              status: "queued",
              createdAt: event.createdAt,
              updatedAt: event.createdAt,
            },
            runtime: runAgent.runtime,
          };
          const queuedEvent: RunEvent = {
            type: "run.queued",
            runId,
            agentId: runAgent.agent.id,
            daemonDeviceId: runAgent.daemonDeviceId,
            createdAt: event.createdAt,
          };

          await tx.insert(runs).values({
            id: runId,
            ownerUserId: run.ownerUserId,
            conversationId: conversation.id,
            agentId: runAgent.agent.id,
            daemonDeviceId: runAgent.daemonDeviceId,
            status: "queued",
            prompt: job.prompt,
            workspacePath: runAgent.workspacePath,
            runtime: runAgent.runtime,
            createdAt,
            updatedAt: createdAt,
          });

          await tx.insert(runEvents).values({
            runId,
            eventType: queuedEvent.type,
            payload: queuedEvent,
            createdAt,
          });

          await tx
            .update(conversationTasks)
            .set({
              assigneeRunId: runId,
              dispatchMessageId: message.id,
              status: "assigned",
              updatedAt: createdAt,
            })
            .where(eq(conversationTasks.id, task.id));

          dispatchJobs.push(job);
        }
      }

      await tx
        .update(conversations)
        .set({
          lastMessageAt: createdAt,
          updatedAt: createdAt,
        })
        .where(eq(conversations.id, conversation.id));
    });

    return { dispatchJobs };
  }

  const assistantContent = getAssistantMessageContent(event);

  if (assistantContent === undefined && event.type !== "run.completed") {
    return { dispatchJobs };
  }

  const updatedAt = new Date(event.createdAt);
  const messageStatus =
    event.type === "run.completed"
      ? event.status === "succeeded"
        ? "completed"
        : event.status
      : "streaming";
  const messageError = event.type === "run.completed" ? event.error : undefined;
  const [message] = await db
    .update(conversationMessages)
    .set({
      ...(assistantContent !== undefined
        ? {
            content: sql`${conversationMessages.content} || ${assistantContent}`,
          }
        : {
            status: messageStatus,
            error: messageError ?? null,
          }),
      updatedAt,
    })
    .where(eq(conversationMessages.runId, event.runId))
    .returning({
      conversationId: conversationMessages.conversationId,
    });

  if (message === undefined) {
    return { dispatchJobs };
  }

  await db
    .update(conversations)
    .set({
      lastMessageAt: updatedAt,
      updatedAt,
    })
    .where(eq(conversations.id, message.conversationId));

  return { dispatchJobs };
}
