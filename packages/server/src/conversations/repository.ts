import { createHash, randomUUID } from "node:crypto";

import type {
  AgentHubCreateTaskToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubListTasksToolResult,
  AgentHubSendMessageTarget,
  AgentHubUploadArtifactToolInput,
  AgentHubSendMessageToolInput,
  Conversation,
  ConversationArtifact,
  ConversationArtifactAction,
  ConversationArtifactActionType,
  ConversationId,
  ConversationMessage,
  ConversationMessageAttachment,
  ConversationArtifactDetails,
  ConversationArtifactRevision,
  ConversationTask,
  RealtimeEvent,
  RunEvent,
} from "@agent-hub/core";
import {
  agentHubAllMcpTools,
  agentHubNonOrchestratorMcpTools,
  inferArtifactFileInfo,
} from "@agent-hub/core";
import {
  agents,
  conversationAgentMembers,
  conversationArtifactActions,
  conversationArtifacts,
  conversationArtifactRevisions,
  conversationMessageArtifacts,
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
  buildArtifactEditorUrl,
  conversationArtifactRevisionStorageKey,
  conversationArtifactStorageKey,
  sanitizeArtifactFilename,
  writeArtifactContent,
  writeArtifactTextContent,
  readArtifactContent,
} from "../artifacts/index.js";
import type { ArtifactActionQueueJob, RunQueueJob } from "../queue/index.js";
import { createRealtimeEvent } from "../realtime/index.js";

export const defaultGroupConversationKey = "all";
export const defaultGroupConversationTitle = "all";

type ConversationRow = typeof conversations.$inferSelect;
type ConversationMessageRow = typeof conversationMessages.$inferSelect;
type ConversationTaskRow = typeof conversationTasks.$inferSelect;
type ConversationArtifactRow = typeof conversationArtifacts.$inferSelect;
type ConversationMessageArtifactRow =
  typeof conversationMessageArtifacts.$inferSelect;
type ConversationArtifactRevisionRow =
  typeof conversationArtifactRevisions.$inferSelect;
type ConversationArtifactActionRow = typeof conversationArtifactActions.$inferSelect;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export type ConversationStatusFilter = Conversation["status"] | "all";

export type ArchiveGroupConversationResult =
  | { status: "archived"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "reserved-key" };

export type RestoreGroupConversationResult =
  | { status: "restored"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "reserved-key" };

export interface AppendRunEventResult {
  dispatchJobs: RunQueueJob[];
  realtimeEvents: RealtimeEvent[];
}

export interface AppendRunEventOptions {
  publicApiBaseUrl?: string;
  publicWebBaseUrl?: string;
}

export interface PersistConversationArtifactUploadInput {
  contentBase64: string;
  filename: string;
  publicApiBaseUrl?: string;
  publicWebBaseUrl?: string;
  runId: string;
  messageTarget?: AgentHubSendMessageTarget;
  sizeBytes: number;
  sourcePath?: string;
  storageRoot: string;
  taskId?: string;
  title: string;
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
  attachments: ConversationMessageAttachment[] = [],
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
    attachments: attachments.length > 0 ? attachments : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getConversationAgentIdsForRow(
  db: Pick<Db, "select">,
  row: ConversationRow,
): Promise<string[] | undefined> {
  if (row.type !== "group") {
    return undefined;
  }

  if (row.key === defaultGroupConversationKey) {
    const agentRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.ownerUserId, row.ownerUserId))
      .orderBy(asc(agents.createdAt));

    return agentRows.map((agent) => agent.id);
  }

  const memberRows = await db
    .select({ agentId: conversationAgentMembers.agentId })
    .from(conversationAgentMembers)
    .where(eq(conversationAgentMembers.conversationId, row.id))
    .orderBy(asc(conversationAgentMembers.position));

  return memberRows.map((member) => member.agentId);
}

export function toConversationArtifact(
  row: ConversationArtifactRow,
  input: { publicApiBaseUrl?: string; publicWebBaseUrl?: string } = {},
): ConversationArtifact {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    taskId: optionalString(row.taskId),
    runId: row.runId,
    creatorAgentId: row.creatorAgentId,
    status: row.status as ConversationArtifact["status"],
    title: row.title,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    latestRevisionId: optionalString(row.latestRevisionId),
    downloadUrl:
      input.publicApiBaseUrl === undefined
        ? undefined
        : buildArtifactDownloadUrl({
            artifactId: row.id,
            publicApiBaseUrl: input.publicApiBaseUrl,
          }),
    editorUrl:
      input.publicWebBaseUrl === undefined
        ? undefined
        : buildArtifactEditorUrl({
            artifactId: row.id,
            conversationId: row.conversationId,
            publicWebBaseUrl: input.publicWebBaseUrl,
          }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toConversationMessageAttachment(
  row: ConversationMessageArtifactRow,
  artifact: ConversationArtifact,
): ConversationMessageAttachment {
  return {
    id: row.id,
    messageId: row.messageId,
    artifactId: row.artifactId,
    type: row.type as ConversationMessageAttachment["type"],
    artifact,
    createdAt: row.createdAt.toISOString(),
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

function toMcpTaskListFromRows(
  rows: ConversationTaskRow[],
): AgentHubListTasksToolResult["tasks"] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    assigneeAgentId: row.assigneeAgentId,
    assigneeRunId: optionalString(row.assigneeRunId),
    description: optionalString(row.description),
    status: row.status as ConversationTask["status"],
    summary: optionalString(row.summary),
  }));
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

export interface AgentGroupContext {
  agents: Array<{ id: string; name: string }>;
  conversationId: ConversationId;
  groupName: string;
  title: string;
}

export async function listActiveAgentGroupContexts(
  db: Db,
  input: { ownerUserId: string; agentId: string },
): Promise<AgentGroupContext[]> {
  const [agent] = await db
    .select({ id: agents.id })
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
    return [];
  }

  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.type, "group"),
        eq(conversations.status, "active"),
      ),
    )
    .orderBy(asc(conversations.title));
  const activeGroups = await toConversationsWithAgentIds(db, rows, {
    ownerUserId: input.ownerUserId,
  });
  const agentIds = compactUniqueStrings(
    activeGroups.flatMap((conversation) => conversation.agentIds ?? []),
  );
  const agentRows = agentIds.length === 0
    ? []
    : await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(
          and(
            eq(agents.ownerUserId, input.ownerUserId),
            eq(agents.status, "active"),
            inArray(agents.id, agentIds),
          ),
        )
        .orderBy(asc(agents.createdAt));
  const agentNamesById = new Map(agentRows.map((agent) => [agent.id, agent.name]));

  return activeGroups
    .filter((conversation) => conversation.agentIds?.includes(input.agentId))
    .map((conversation) => ({
      agents: (conversation.agentIds ?? []).flatMap((agentId) => {
        const name = agentNamesById.get(agentId);

        return name === undefined ? [] : [{ id: agentId, name }];
      }),
      conversationId: conversation.id,
      groupName: conversation.key === defaultGroupConversationKey
        ? defaultGroupConversationKey
        : conversation.title,
      title: conversation.title,
    }));
}

export function buildAgentGroupsPrompt(groups: AgentGroupContext[]): string {
  const groupLines = groups.length === 0
    ? ["You are not a member of any active AgentHub groups."]
    : [
        "You are a member of these active AgentHub groups:",
        ...groups.map(
          (group) => {
            const agentList = group.agents.length === 0
              ? "none"
              : group.agents.map((agent) => `@${agent.name}`).join(", ");

            return `- #${group.title} (groupName: ${group.groupName}, conversationId: ${group.conversationId}; agents: ${agentList})`;
          },
        ),
      ];

  return [
    "<agenthub_agent_groups>",
    ...groupLines,
    "Use send_message with target { type: \"group\", groupName } to send a visible message to one of these groups.",
    "To wake another agent in a group, include @AgentName in the message content.",
    "Use send_message with target { type: \"user\" } to send a visible private message to the current user.",
    "Archived groups are not listed and cannot be targeted.",
    "</agenthub_agent_groups>",
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
  input: { ownerUserId: string; status?: "active" | "all" },
): Promise<string[]> {
  const status = input.status ?? "active";
  const conditions = [eq(agents.ownerUserId, input.ownerUserId)];

  if (status !== "all") {
    conditions.push(eq(agents.status, status));
  }

  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(...conditions))
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

export async function listConversationTasksForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
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
        publicWebBaseUrl: input.publicWebBaseUrl,
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
    publicWebBaseUrl?: string;
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
      publicWebBaseUrl: input.publicWebBaseUrl,
    }),
  );
}

export async function getConversationArtifactForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<
  | { artifact: ConversationArtifact; storageKey: string; sourcePath: string | null }
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
      publicWebBaseUrl: input.publicWebBaseUrl,
    }),
    storageKey: row.storageKey,
    sourcePath: row.sourcePath,
  };
}

function availableArtifactActions(
  artifact: ConversationArtifact,
): ConversationArtifactActionType[] {
  if (artifact.status !== "ready") {
    return [];
  }

  const fileInfo = inferArtifactFileInfo({ filename: artifact.filename });
  const actions: ConversationArtifactActionType[] = [];

  if (fileInfo.canApply) {
    actions.push("apply");
  }

  if (fileInfo.canPreview) {
    actions.push("preview");
  }

  return actions;
}

export async function getConversationArtifactDetailsForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
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
      sourcePath?: string;
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

  return {
    actionId: row.action.id,
    actionType: row.action.type as ConversationArtifactActionType,
    artifactId: row.artifact.id,
    contentBase64: content.toString("base64"),
    daemonDeviceId: row.run.daemonDeviceId,
    filename: row.artifact.filename,
    sourcePath: optionalString(row.artifact.sourcePath),
    workspacePath: row.run.workspacePath,
  };
}

export async function markConversationArtifactActionRunning(
  db: Db,
  input: { actionId: string },
): Promise<{
  action: ConversationArtifactAction;
  conversationId: string;
  ownerUserId: string;
} | null> {
  const [action] = await db
    .update(conversationArtifactActions)
    .set({
      status: "running",
      updatedAt: new Date(),
    })
    .where(eq(conversationArtifactActions.id, input.actionId))
    .returning();

  return action === undefined
    ? null
    : {
        action: toConversationArtifactAction(action),
        conversationId: action.conversationId,
        ownerUserId: action.ownerUserId,
      };
}

export async function completeConversationArtifactAction(
  db: Db,
  input: {
    actionId: string;
    error?: string;
    result?: Record<string, unknown>;
    status: "succeeded" | "failed" | "cancelled";
  },
): Promise<{
  action: ConversationArtifactAction;
  conversationId: string;
  ownerUserId: string;
} | null> {
  const [action] = await db
    .update(conversationArtifactActions)
    .set({
      status: input.status,
      error: input.error,
      result: input.result,
      updatedAt: new Date(),
    })
    .where(eq(conversationArtifactActions.id, input.actionId))
    .returning();

  return action === undefined
    ? null
    : {
        action: toConversationArtifactAction(action),
        conversationId: action.conversationId,
        ownerUserId: action.ownerUserId,
      };
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

  const targetConversation = input.taskId === undefined
    ? await getSendMessageTargetConversation(db, {
        currentConversationId: run.conversationId,
        ownerUserId: run.ownerUserId,
        runAgentId: run.agentId,
        target: input.messageTarget,
      })
    : null;
  const artifactConversationId = input.taskId === undefined
    ? targetConversation?.id
    : run.conversationId;

  if (artifactConversationId === undefined) {
    throw new Error("Artifact upload target conversation was not found.");
  }

  if (input.taskId !== undefined) {
    const [task] = await db
      .select()
      .from(conversationTasks)
      .where(
        and(
          eq(conversationTasks.id, input.taskId),
          eq(conversationTasks.conversationId, artifactConversationId),
          eq(conversationTasks.assigneeRunId, input.runId),
          eq(conversationTasks.assigneeAgentId, run.agentId),
        ),
      )
      .limit(1);

    if (task === undefined) {
      throw new Error("Artifact task does not belong to this run.");
    }
  }

  const artifactId = randomUUID();
  const filename = sanitizeArtifactFilename(input.filename);
  const storageKey = conversationArtifactStorageKey({
    artifactId,
    conversationId: artifactConversationId,
    filename,
  });
  const writtenBytes = await writeArtifactContent({
    contentBase64: input.contentBase64,
    storageKey,
    storageRoot: input.storageRoot,
  });

  if (writtenBytes !== input.sizeBytes) {
    throw new Error("Artifact content size did not match upload size.");
  }

  const now = new Date();
  const [artifact] = await db
    .insert(conversationArtifacts)
    .values({
      id: artifactId,
      ownerUserId: run.ownerUserId,
      conversationId: artifactConversationId,
      taskId: input.taskId,
      runId: input.runId,
      creatorAgentId: run.agentId,
      status: "ready",
      title: input.title.trim(),
      filename,
      sourcePath: input.sourcePath,
      sizeBytes: writtenBytes,
      storageKey,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (artifact === undefined) {
    throw new Error("Artifact upload could not be persisted.");
  }

  return toConversationArtifact(artifact, {
    publicApiBaseUrl: input.publicApiBaseUrl,
    publicWebBaseUrl: input.publicWebBaseUrl,
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
          eq(conversations.status, "active"),
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

    const conversationRow = updatedConversation ?? conversation;
    const agentIds = await getConversationAgentIdsForRow(tx, conversationRow);

    return {
      conversation: toConversation(conversationRow, agentIds),
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
          eq(conversations.status, "active"),
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

    const conversationRow = updatedConversation ?? conversation;
    const agentIds = await getConversationAgentIdsForRow(tx, conversationRow);

    return {
      conversation: toConversation(conversationRow, agentIds),
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
  const record = input as Record<string, unknown>;

  return typeof content === "string" && content.trim().length > 0
    ? {
        content: content.trim(),
        target: readSendMessageTarget(record.target),
        attachments: readSendMessageAttachments(record.attachments),
      }
    : null;
}

function readSendMessageTarget(
  value: unknown,
): AgentHubSendMessageToolInput["target"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (record.type === "current") {
    return { type: "current" };
  }

  if (record.type === "user") {
    return { type: "user" };
  }

  if (
    record.type === "group" &&
    typeof record.groupName === "string" &&
    record.groupName.trim().length > 0
  ) {
    return { type: "group", groupName: record.groupName.trim() };
  }

  return undefined;
}

function readSendMessageAttachments(
  value: unknown,
): AgentHubSendMessageToolInput["attachments"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attachments = value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (record.type !== "image") {
      return [];
    }

    const artifactId = typeof record.artifactId === "string" &&
      record.artifactId.length > 0
      ? record.artifactId
      : undefined;

    if (artifactId === undefined) {
      return [];
    }

    return [{
      type: "image" as const,
      artifactId,
      title: typeof record.title === "string" ? record.title.trim() : undefined,
      filename: typeof record.filename === "string" ? record.filename.trim() : undefined,
    }];
  });

  return attachments.length > 0 ? attachments : undefined;
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

  return title.length > 0 &&
    title.length <= 160 &&
    typeof artifactInput.taskId === "string" &&
    artifactInput.taskId.length > 0 &&
    localPath.length > 0
    ? {
        taskId: artifactInput.taskId,
        title,
        localPath,
        filename: filename && filename.length > 0 ? filename : undefined,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasMentionBoundary(value: string, endIndex: number): boolean {
  if (endIndex >= value.length) {
    return true;
  }

  return !/[A-Za-z0-9_-]/.test(value[endIndex] ?? "");
}

export function resolveTextMentionedAgentIds(
  content: string,
  agentRefs: Array<{ id: string; name: string }>,
  options: { excludeAgentId?: string } = {},
): string[] {
  const refs = agentRefs
    .filter((agent) => agent.id !== options.excludeAgentId)
    .filter((agent) => agent.name.trim().length > 0)
    .sort((first, second) =>
      second.name.length - first.name.length ||
      first.name.localeCompare(second.name),
    );
  const matchedMentions: Array<{ agentId: string; start: number; end: number }> = [];

  for (const agent of refs) {
    const pattern = new RegExp(`@${escapeRegExp(agent.name)}`, "gi");
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = matchedMentions.some(
        (range) => start < range.end && end > range.start,
      );

      if (!overlaps && hasMentionBoundary(content, end)) {
        matchedMentions.push({ agentId: agent.id, start, end });
        break;
      }
    }
  }

  return compactUniqueStrings(
    matchedMentions
      .sort((first, second) => first.start - second.start)
      .map((mention) => mention.agentId),
  );
}

function isDefaultGroup(row: Pick<ConversationRow, "key" | "type">): boolean {
  return row.type === "group" && row.key === defaultGroupConversationKey;
}

function groupToolNameToKey(groupName: string): string {
  return groupName.replace(/^#+/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function sendMessageAttachmentArtifactIds(
  input: AgentHubSendMessageToolInput,
): string[] {
  return compactUniqueStrings(
    input.attachments?.flatMap((attachment) =>
      attachment.type === "image" && attachment.artifactId !== undefined
        ? [attachment.artifactId]
        : [],
    ) ?? [],
  );
}

async function getSendMessageTargetConversation(
  db: Db,
  input: {
    currentConversationId: string | null;
    ownerUserId: string;
    runAgentId: string;
    target?: AgentHubSendMessageToolInput["target"];
  },
): Promise<ConversationRow | null> {
  const target = input.target ?? { type: "current" as const };

  if (target.type === "user") {
    const conversation = await ensureDirectConversation(db, {
      agentId: input.runAgentId,
      ownerUserId: input.ownerUserId,
    });

    if (conversation === null) {
      return null;
    }

    const [row] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
      .limit(1);

    return row ?? null;
  }

  if (target.type === "group") {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.type, "group"),
          eq(conversations.status, "active"),
          eq(conversations.key, groupToolNameToKey(target.groupName)),
        ),
      )
      .limit(1);

    if (
      conversation === undefined ||
      !(await isConversationAgentMember(db, {
        agentId: input.runAgentId,
        conversation,
      }))
    ) {
      return null;
    }

    return conversation;
  }

  if (input.currentConversationId === null) {
    return null;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.currentConversationId),
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.status, "active"),
      ),
    )
    .limit(1);

  return conversation ?? null;
}

async function insertCompletedAgentMessage(
  db: Db,
  input: {
    agentId: string;
    artifactIds?: string[];
    content: string;
    conversationId: string;
    createdAt: Date;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
    runId: string;
  },
): Promise<{
  attachments: ConversationMessageAttachment[];
  message: ConversationMessageRow;
}> {
  return db.transaction(async (tx) => {
    const [message] = await tx.insert(conversationMessages).values({
      conversationId: input.conversationId,
      senderType: "agent",
      senderAgentId: input.agentId,
      runId: input.runId,
      content: input.content,
      status: "completed",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }).returning();
    const artifactIds = compactUniqueStrings(input.artifactIds ?? []);
    const attachments: ConversationMessageAttachment[] = [];

    if (artifactIds.length > 0) {
      const artifactRows = await tx
        .select()
        .from(conversationArtifacts)
        .where(
          and(
            eq(conversationArtifacts.conversationId, input.conversationId),
            eq(conversationArtifacts.runId, input.runId),
            eq(conversationArtifacts.creatorAgentId, input.agentId),
            inArray(conversationArtifacts.id, artifactIds),
          ),
        );
      const artifactById = new Map(artifactRows.map((artifact) => [artifact.id, artifact]));
      const orderedArtifactRows = artifactIds.flatMap((artifactId) => {
        const artifact = artifactById.get(artifactId);

        return artifact === undefined ? [] : [artifact];
      });

      if (orderedArtifactRows.length > 0) {
        const attachmentRows = await tx
          .insert(conversationMessageArtifacts)
          .values(
            orderedArtifactRows.map((artifact, index) => ({
              messageId: message.id,
              artifactId: artifact.id,
              type: "image",
              position: index,
              createdAt: input.createdAt,
            })),
          )
          .returning();

        for (const attachmentRow of attachmentRows) {
          const artifact = artifactById.get(attachmentRow.artifactId);

          if (artifact !== undefined) {
            attachments.push(
              toConversationMessageAttachment(
                attachmentRow,
                toConversationArtifact(artifact, {
                  publicApiBaseUrl: input.publicApiBaseUrl,
                  publicWebBaseUrl: input.publicWebBaseUrl,
                }),
              ),
            );
          }
        }
      }
    }

    await tx
      .update(conversations)
      .set({
        lastMessageAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      .where(eq(conversations.id, input.conversationId));

    return { attachments, message };
  });
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
          eq(agents.status, "active"),
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

async function listConversationAgentRefs(
  db: Db,
  conversation: Pick<ConversationRow, "id" | "key" | "ownerUserId" | "type">,
): Promise<Array<{ id: string; name: string }>> {
  if (conversation.type !== "group") {
    return [];
  }

  if (isDefaultGroup(conversation)) {
    return db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(
        and(
          eq(agents.ownerUserId, conversation.ownerUserId),
          eq(agents.status, "active"),
        ),
      )
      .orderBy(asc(agents.createdAt));
  }

  return db
    .select({ id: agents.id, name: agents.name })
    .from(conversationAgentMembers)
    .innerJoin(agents, eq(agents.id, conversationAgentMembers.agentId))
    .where(
      and(
        eq(conversationAgentMembers.conversationId, conversation.id),
        eq(agents.status, "active"),
      ),
    )
    .orderBy(asc(conversationAgentMembers.position));
}

async function resolveConversationAgentReference(
  db: Db,
  input: {
    conversation: Pick<ConversationRow, "id" | "key" | "ownerUserId" | "type">;
    reference: string;
  },
): Promise<string | null> {
  const reference = input.reference.trim().replace(/^@/, "");

  if (reference.length === 0) {
    return null;
  }

  if (
    uuidPattern.test(reference) &&
    await isConversationAgentMember(db, {
      agentId: reference,
      conversation: input.conversation,
    })
  ) {
    return reference;
  }

  const normalizedReference = reference.toLocaleLowerCase();
  const agentRefs = await listConversationAgentRefs(db, input.conversation);
  const match = agentRefs.find(
    (agent) => agent.name.toLocaleLowerCase() === normalizedReference,
  );

  return match?.id ?? null;
}

export function buildAssignedTaskPrompt(input: {
  agentGroupsPrompt?: string;
  conversationTitle: string;
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  dispatchMessage: string;
}): string {
  return [
    "<agenthub_assigned_task>",
    `Group: #${input.conversationTitle}`,
    `Task ID: ${input.taskId}`,
    `Task: ${input.taskTitle}`,
    input.taskDescription ? `Description: ${input.taskDescription}` : undefined,
    "",
    "You were assigned this task by the group orchestrator.",
    "Create the requested report or result file in your current workspace.",
    "Use the exact Task ID above when calling AgentHub MCP upload_artifact and complete_task.",
    "Upload the report with upload_artifact, then call complete_task with a concise summary and the uploaded artifact id.",
    "Use send_message only for optional visible progress updates. Do not use normal assistant text as the visible group reply.",
    "</agenthub_assigned_task>",
    "",
    input.agentGroupsPrompt,
    input.agentGroupsPrompt === undefined ? undefined : "",
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

function buildMentionedGroupChatAgentInstructions(input: {
  agentDescription?: string;
  conversationTitle: string;
}): string {
  return [
    input.agentDescription === undefined || input.agentDescription.trim().length === 0
      ? undefined
      : [
          "AgentHub agent profile:",
          "Follow this agent profile when responding.",
          "",
          input.agentDescription.trim(),
        ].join("\n"),
    `You are participating in the AgentHub group chat #${input.conversationTitle}.`,
    "Visible group replies must be sent with the AgentHub MCP tool send_message.",
    "Do not answer a group chat by writing normal assistant text.",
  ].filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n\n");
}

function buildMentionedGroupChatRunPrompt(input: {
  agentGroupsPrompt: string;
  agentName: string;
  agentNamesById: Record<string, string>;
  conversationTitle: string;
  currentMessage: string;
  messages: ConversationMessage[];
  senderAgentName: string;
}): string {
  const conversationPrompt = buildConversationRunPrompt({
    agentNamesById: input.agentNamesById,
    currentUserMessage: [
      "<mentioned_message>",
      `From: ${input.senderAgentName}`,
      "Content:",
      input.currentMessage,
      "</mentioned_message>",
    ].join("\n"),
    messages: input.messages,
  });

  return [
    "<agenthub_group_chat_protocol>",
    `You are ${input.agentName} in #${input.conversationTitle}.`,
    `${input.senderAgentName} explicitly mentioned you in the latest message.`,
    "If you should reply, call the MCP tool send_message with { content: string }.",
    "If you should not reply, do not call send_message.",
    "Never use normal assistant text as the visible group reply. Normal assistant text is ignored by AgentHub group chat.",
    "</agenthub_group_chat_protocol>",
    "",
    input.agentGroupsPrompt,
    "",
    conversationPrompt,
  ].join("\n");
}

async function listAgentNamesByIdForUser(
  db: Db,
  ownerUserId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.ownerUserId, ownerUserId));

  return Object.fromEntries(rows.map((agent) => [agent.id, agent.name]));
}

async function createMentionedGroupChatRuns(
  db: Db,
  input: {
    content: string;
    conversation: ConversationRow;
    createdAt: Date;
    eventCreatedAt: string;
    ownerUserId: string;
    senderAgentId: string;
    triggerMessageId: string;
  },
): Promise<{ dispatchJobs: RunQueueJob[]; realtimeEvents: RealtimeEvent[] }> {
  if (
    input.conversation.type !== "group" ||
    input.conversation.status !== "active"
  ) {
    return { dispatchJobs: [], realtimeEvents: [] };
  }

  const agentRefs = await listConversationAgentRefs(db, input.conversation);
  const mentionedAgentIds = resolveTextMentionedAgentIds(input.content, agentRefs, {
    excludeAgentId: input.senderAgentId,
  });

  if (mentionedAgentIds.length === 0) {
    return { dispatchJobs: [], realtimeEvents: [] };
  }

  const priorMessages =
    (await listConversationMessagesForUser(db, {
      conversationId: input.conversation.id,
      ownerUserId: input.ownerUserId,
    }))?.filter((message) => message.id !== input.triggerMessageId) ?? [];
  const agentNamesById = await listAgentNamesByIdForUser(db, input.ownerUserId);
  const senderAgentName = agentNamesById[input.senderAgentId] ?? "Another agent";
  const taskRows = await db
    .select()
    .from(conversationTasks)
    .where(eq(conversationTasks.conversationId, input.conversation.id))
    .orderBy(asc(conversationTasks.createdAt));
  const agentHubMcpTasks = toMcpTaskListFromRows(taskRows);
  const dispatchJobs: RunQueueJob[] = [];
  const realtimeEvents: RealtimeEvent[] = [];

  for (const agentId of mentionedAgentIds) {
    const runAgent = await getRunnableAgentForUser(db, {
      agentId,
      ownerUserId: input.ownerUserId,
    });

    if (runAgent === null) {
      continue;
    }

    const runId = randomUUID();
    const agentGroupsPrompt = buildAgentGroupsPrompt(
      await listActiveAgentGroupContexts(db, {
        agentId: runAgent.agent.id,
        ownerUserId: input.ownerUserId,
      }),
    );
    const job: RunQueueJob = {
      conversationId: input.conversation.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      prompt: buildMentionedGroupChatRunPrompt({
        agentGroupsPrompt,
        agentName: runAgent.agent.name,
        agentNamesById,
        conversationTitle: input.conversation.title,
        currentMessage: input.content,
        messages: priorMessages,
        senderAgentName,
      }),
      agentInstructions: buildMentionedGroupChatAgentInstructions({
        agentDescription: runAgent.agent.description,
        conversationTitle: input.conversation.title,
      }),
      agentHubMcpTools: input.conversation.orchestratorAgentId === runAgent.agent.id
        ? [...agentHubAllMcpTools]
        : [...agentHubNonOrchestratorMcpTools],
      agentHubMcpTasks,
      workspacePath: runAgent.workspacePath,
      run: {
        id: runId,
        agentId: runAgent.agent.id,
        daemonDeviceId: runAgent.daemonDeviceId,
        status: "queued",
        createdAt: input.eventCreatedAt,
        updatedAt: input.eventCreatedAt,
      },
      runtime: runAgent.runtime,
    };
    const queuedEvent: RunEvent = {
      type: "run.queued",
      runId,
      agentId: runAgent.agent.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      createdAt: input.eventCreatedAt,
    };
    const runEvent = createRealtimeEvent({
      conversationId: input.conversation.id,
      ownerUserId: input.ownerUserId,
      run: job.run,
      type: "run.updated",
    });
    const queuedRealtimeEvent = createRealtimeEvent({
      conversationId: input.conversation.id,
      event: queuedEvent,
      ownerUserId: input.ownerUserId,
      runId,
      type: "run.event.created",
    });

    await db.transaction(async (tx) => {
      await tx.insert(runs).values({
        id: runId,
        ownerUserId: input.ownerUserId,
        conversationId: input.conversation.id,
        agentId: runAgent.agent.id,
        daemonDeviceId: runAgent.daemonDeviceId,
        status: "queued",
        prompt: job.prompt,
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
    });

    dispatchJobs.push(job);
    realtimeEvents.push(runEvent, queuedRealtimeEvent);
  }

  return { dispatchJobs, realtimeEvents };
}

async function persistVisibleAgentMessageAndDispatchMentions(
  db: Db,
  input: {
    agentId: string;
    artifactIds?: string[];
    content: string;
    conversation: ConversationRow;
    createdAt: Date;
    eventCreatedAt: string;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
    runId: string;
  },
): Promise<{
  dispatchJobs: RunQueueJob[];
  message: ConversationMessage;
  realtimeEvents: RealtimeEvent[];
}> {
  const { attachments, message } = await insertCompletedAgentMessage(db, {
    agentId: input.agentId,
    artifactIds: input.artifactIds,
    content: input.content,
    conversationId: input.conversation.id,
    createdAt: input.createdAt,
    publicApiBaseUrl: input.publicApiBaseUrl,
    publicWebBaseUrl: input.publicWebBaseUrl,
    runId: input.runId,
  });
  const mentionResult = await createMentionedGroupChatRuns(db, {
    content: input.content,
    conversation: input.conversation,
    createdAt: input.createdAt,
    eventCreatedAt: input.eventCreatedAt,
    ownerUserId: input.ownerUserId,
    senderAgentId: input.agentId,
    triggerMessageId: message.id,
  });
  const realtimeEvents: RealtimeEvent[] = [
    createRealtimeEvent({
      conversationId: input.conversation.id,
      message: toConversationMessage(message, attachments),
      ownerUserId: input.ownerUserId,
      type: "conversation.message.created",
    }),
    createRealtimeEvent({
      conversationId: input.conversation.id,
      ownerUserId: input.ownerUserId,
      type: "conversation.updated",
    }),
    ...mentionResult.realtimeEvents,
  ];

  return {
    dispatchJobs: mentionResult.dispatchJobs,
    message: toConversationMessage(message, attachments),
    realtimeEvents,
  };
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
    publicWebBaseUrl?: string;
    realtimeEvents?: RealtimeEvent[];
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
        publicWebBaseUrl: input.publicWebBaseUrl,
      }),
    );
    artifactsByTask.set(artifactRow.taskId, artifacts);
  }

  const [creatorRun] = await db
    .select({ prompt: runs.prompt })
    .from(runs)
    .where(eq(runs.id, input.creatorRunId))
    .limit(1);
  const agentGroupsPrompt = buildAgentGroupsPrompt(
    await listActiveAgentGroupContexts(db, {
      agentId: runAgent.agent.id,
      ownerUserId: firstTask.ownerUserId,
    }),
  );
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
              `- ${artifact.title}: ${artifact.editorUrl ?? artifact.downloadUrl ?? `/editor/${artifact.conversationId}/${artifact.id}`}`,
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
    "Include any report preview/editor links listed below.",
    "</agenthub_task_finalization>",
    "",
    agentGroupsPrompt,
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
    agentHubMcpTools: [...agentHubAllMcpTools],
    agentHubMcpTasks: toMcpTaskListFromRows(taskRows),
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
    input.realtimeEvents?.push(
      createRealtimeEvent({
        conversationId: conversation.id,
        ownerUserId: firstTask.ownerUserId,
        run: job.run,
        type: "run.updated",
      }),
      createRealtimeEvent({
        conversationId: conversation.id,
        event: queuedEvent,
        ownerUserId: firstTask.ownerUserId,
        runId,
        type: "run.event.created",
      }),
    );
  });
}

export async function appendRunEventToConversationMessage(
  db: Db,
  event: RunEvent,
  options: AppendRunEventOptions = {},
): Promise<AppendRunEventResult> {
  const dispatchJobs: RunQueueJob[] = [];
  const realtimeEvents: RealtimeEvent[] = [];
  const result = (): AppendRunEventResult => ({ dispatchJobs, realtimeEvents });

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
        conversationId: conversationTasks.conversationId,
        creatorRunId: conversationTasks.creatorRunId,
        id: conversationTasks.id,
        ownerUserId: conversationTasks.ownerUserId,
      });
    realtimeEvents.push(
      ...updatedTasks.map((task) =>
        createRealtimeEvent({
          conversationId: task.conversationId,
          ownerUserId: task.ownerUserId,
          taskId: task.id,
          type: "task.updated" as const,
        }),
      ),
    );

    if (event.type === "run.completed") {
      for (const creatorRunId of compactUniqueStrings(
        updatedTasks.map((task) => task.creatorRunId),
      )) {
        await maybeCreateFinalizationRun(db, {
          creatorRunId,
          createdAt: updatedAt,
          dispatchJobs,
          publicApiBaseUrl: options.publicApiBaseUrl,
          publicWebBaseUrl: options.publicWebBaseUrl,
          realtimeEvents,
        });
      }
    }
  }

  if (event.type === "agenthub.tool.call") {
    if (event.name === "create_task") {
      const input = readCreateTaskToolInput(event.input);

      if (input === null) {
        return result();
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
        return result();
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
        conversation.orchestratorAgentId !== run.agentId
      ) {
        return result();
      }

      const assigneeAgentId = await resolveConversationAgentReference(db, {
        conversation,
        reference: input.assigneeAgentId,
      });

      if (assigneeAgentId === null) {
        return result();
      }

      const isSelfAssigned = assigneeAgentId === run.agentId;

      if (
        !isSelfAssigned &&
        !(await isConversationAgentMember(db, {
          agentId: assigneeAgentId,
          conversation,
        }))
      ) {
        return result();
      }

      const [assignee] = await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(
          and(
            eq(agents.id, assigneeAgentId),
            eq(agents.ownerUserId, run.ownerUserId),
          ),
        )
        .limit(1);

      if (assignee === undefined) {
        return result();
      }

      const createdAt = new Date(event.createdAt);
      const taskId = input.taskId ?? randomUUID();
      const dispatchContent = `@${assignee.name} 已创建任务：${input.title}\nTask ID: ${taskId}`;
      const runAgent = isSelfAssigned
        ? null
        : await getRunnableAgentForUser(db, {
            agentId: assigneeAgentId,
            ownerUserId: run.ownerUserId,
          });

      if (!isSelfAssigned && runAgent === null) {
        const [createdTask] = await db
          .insert(conversationTasks)
          .values({
            id: taskId,
            ownerUserId: run.ownerUserId,
            conversationId: conversation.id,
            creatorRunId: event.runId,
            orchestratorAgentId: run.agentId,
            assigneeAgentId,
            title: input.title,
            description: input.description,
            status: "failed",
            summary: "Assignee agent is not ready.",
            createdAt,
            updatedAt: createdAt,
          })
          .onConflictDoNothing()
          .returning({ id: conversationTasks.id });

        if (createdTask !== undefined) {
          realtimeEvents.push(
            createRealtimeEvent({
              conversationId: conversation.id,
              ownerUserId: run.ownerUserId,
              taskId: createdTask.id,
              type: "task.updated",
            }),
          );
        }

        await maybeCreateFinalizationRun(db, {
          creatorRunId: event.runId,
          createdAt,
          dispatchJobs,
          publicApiBaseUrl: options.publicApiBaseUrl,
          publicWebBaseUrl: options.publicWebBaseUrl,
          realtimeEvents,
        });

        return result();
      }

      const agentGroupsPrompt = runAgent === null
        ? undefined
        : buildAgentGroupsPrompt(
            await listActiveAgentGroupContexts(db, {
              agentId: runAgent.agent.id,
              ownerUserId: run.ownerUserId,
            }),
          );
      const runId = randomUUID();
      const existingTaskRows = await db
        .select()
        .from(conversationTasks)
        .where(eq(conversationTasks.conversationId, conversation.id))
        .orderBy(asc(conversationTasks.createdAt));
      const agentHubMcpTasks = toMcpTaskListFromRows([
        ...existingTaskRows,
        {
          id: taskId,
          ownerUserId: run.ownerUserId,
          conversationId: conversation.id,
          creatorRunId: event.runId,
          orchestratorAgentId: run.agentId,
          assigneeAgentId,
          assigneeRunId: runAgent === null ? event.runId : runId,
          dispatchMessageId: null,
          title: input.title,
          description: input.description ?? null,
          status: runAgent === null ? "running" : "assigned",
          summary: null,
          resultArtifactIds: null,
          completedAt: null,
          finalizerRunId: null,
          createdAt,
          updatedAt: createdAt,
        },
      ]);
      const job: RunQueueJob | null = runAgent === null
        ? null
        : {
            conversationId: conversation.id,
            daemonDeviceId: runAgent.daemonDeviceId,
            prompt: buildAssignedTaskPrompt({
              conversationTitle: conversation.title,
              taskId,
              taskTitle: input.title,
              taskDescription: input.description,
              dispatchMessage: dispatchContent,
              agentGroupsPrompt,
            }),
            agentInstructions: buildAssignedTaskInstructions({
              agentDescription: runAgent.agent.description,
              conversationTitle: conversation.title,
            }),
            agentHubMcpTools: [...agentHubNonOrchestratorMcpTools],
            agentHubMcpTasks,
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
      const queuedEvent: RunEvent | null = job === null
        ? null
        : {
            type: "run.queued",
            runId,
            agentId: job.run.agentId,
            daemonDeviceId: job.daemonDeviceId,
            createdAt: event.createdAt,
          };

      await db.transaction(async (tx) => {
        const [message] = await tx.insert(conversationMessages).values({
          conversationId: conversation.id,
          senderType: "agent",
          senderAgentId: run.agentId,
          runId: event.runId,
          content: dispatchContent,
          status: "completed",
          createdAt,
          updatedAt: createdAt,
        }).returning();

        const [createdTask] = await tx
          .insert(conversationTasks)
          .values({
            id: taskId,
            ownerUserId: run.ownerUserId,
            conversationId: conversation.id,
            creatorRunId: event.runId,
            orchestratorAgentId: run.agentId,
            assigneeAgentId,
            assigneeRunId: job === null ? event.runId : runId,
            dispatchMessageId: message.id,
            title: input.title,
            description: input.description,
            status: job === null ? "running" : "assigned",
            createdAt,
            updatedAt: createdAt,
          })
          .onConflictDoNothing()
          .returning({ id: conversationTasks.id });

        if (createdTask === undefined) {
          return;
        }

        if (job !== null && queuedEvent !== null) {
          await tx.insert(runs).values({
            id: runId,
            ownerUserId: run.ownerUserId,
            conversationId: conversation.id,
            agentId: job.run.agentId,
            daemonDeviceId: job.daemonDeviceId,
            status: "queued",
            prompt: job.prompt,
            workspacePath: job.workspacePath,
            runtime: job.runtime,
            createdAt,
            updatedAt: createdAt,
          });

          await tx.insert(runEvents).values({
            runId,
            eventType: queuedEvent.type,
            payload: queuedEvent,
            createdAt,
          });
        }

        await tx
          .update(conversations)
          .set({
            lastMessageAt: createdAt,
            updatedAt: createdAt,
          })
          .where(eq(conversations.id, conversation.id));

        realtimeEvents.push(
          createRealtimeEvent({
            conversationId: conversation.id,
            message: toConversationMessage(message),
            ownerUserId: run.ownerUserId,
            type: "conversation.message.created",
          }),
          createRealtimeEvent({
            conversationId: conversation.id,
            ownerUserId: run.ownerUserId,
            type: "conversation.updated",
          }),
          createRealtimeEvent({
            conversationId: conversation.id,
            ownerUserId: run.ownerUserId,
            taskId,
            type: "task.updated",
          }),
        );

        if (job !== null && queuedEvent !== null) {
          dispatchJobs.push(job);
          realtimeEvents.push(
            createRealtimeEvent({
              conversationId: conversation.id,
              ownerUserId: run.ownerUserId,
              run: job.run,
              type: "run.updated",
            }),
            createRealtimeEvent({
              conversationId: conversation.id,
              event: queuedEvent,
              ownerUserId: run.ownerUserId,
              runId,
              type: "run.event.created",
            }),
          );
        }
      });

      return result();
    }

    if (event.name === "upload_artifact") {
      const input = readUploadArtifactToolInput(event.input);

      if (input === null) {
        return result();
      }

      return result();
    }

    if (event.name === "complete_task") {
      const input = readCompleteTaskToolInput(event.input);

      if (input === null) {
        return result();
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
        return result();
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
        return result();
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
          return result();
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
      realtimeEvents.push(
        createRealtimeEvent({
          conversationId: run.conversationId,
          ownerUserId: run.ownerUserId,
          taskId: task.id,
          type: "task.updated",
        }),
      );

      await maybeCreateFinalizationRun(db, {
        creatorRunId: task.creatorRunId,
        createdAt: updatedAt,
        dispatchJobs,
        publicApiBaseUrl: options.publicApiBaseUrl,
        publicWebBaseUrl: options.publicWebBaseUrl,
        realtimeEvents,
      });

      return result();
    }

    if (event.name !== "send_message") {
      return result();
    }

    const input = readSendMessageToolInput(event.input);

    if (input === null) {
      return result();
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

    if (run === undefined) {
      return result();
    }

    const conversation = await getSendMessageTargetConversation(db, {
      currentConversationId: run.conversationId,
      ownerUserId: run.ownerUserId,
      runAgentId: run.agentId,
      target: input.target,
    });

    if (conversation === null) {
      return result();
    }

    const persisted = await persistVisibleAgentMessageAndDispatchMentions(db, {
      agentId: run.agentId,
      artifactIds: sendMessageAttachmentArtifactIds(input),
      content: input.content,
      conversation,
      createdAt: new Date(event.createdAt),
      eventCreatedAt: event.createdAt,
      ownerUserId: run.ownerUserId,
      publicApiBaseUrl: options.publicApiBaseUrl,
      publicWebBaseUrl: options.publicWebBaseUrl,
      runId: event.runId,
    });

    dispatchJobs.push(...persisted.dispatchJobs);
    realtimeEvents.push(...persisted.realtimeEvents);
    return result();
  }

  const assistantContent = getAssistantMessageContent(event);

  if (assistantContent === undefined && event.type !== "run.completed") {
    return result();
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
    .where(
      and(
        eq(conversationMessages.runId, event.runId),
        eq(conversationMessages.status, "streaming"),
      ),
    )
    .returning();

  if (message === undefined) {
    return result();
  }

  const [conversation] = await db
    .select({ ownerUserId: conversations.ownerUserId })
    .from(conversations)
    .where(eq(conversations.id, message.conversationId))
    .limit(1);

  await db
    .update(conversations)
    .set({
      lastMessageAt: updatedAt,
      updatedAt,
    })
    .where(eq(conversations.id, message.conversationId));
  if (conversation !== undefined) {
    realtimeEvents.push(
      createRealtimeEvent({
        conversationId: message.conversationId,
        ownerUserId: conversation.ownerUserId,
        type: "conversation.updated",
      }),
      createRealtimeEvent({
        conversationId: message.conversationId,
        message: toConversationMessage(message),
        ownerUserId: conversation.ownerUserId,
        type: "conversation.message.created",
      }),
    );
  }

  return result();
}
