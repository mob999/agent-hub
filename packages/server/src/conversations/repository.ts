import { createHash, randomUUID } from "node:crypto";

import type {
  AgentHubCreateGoalToolInput,
  AgentHubCreateTaskToolInput,
  AgentHubApproveTaskToolInput,
  AgentHubCancelTaskToolInput,
  AgentHubCompleteGoalToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubDeployStaticSiteToolInput,
  AgentHubListArtifactsToolInput,
  AgentHubReadArtifactToolInput,
  AgentHubMcpToolCall,
  AgentHubMcpToolResult,
  AgentHubListGoalsToolResult,
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
  ConversationDeployment,
  ConversationGoal,
  ConversationGoalTask,
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
  conversationDeployments,
  conversationMessageArtifacts,
  conversationMessages,
  conversationGoals,
  conversationGoalTasks,
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
  buildDeploymentUrl,
  conversationDeploymentFileStorageKey,
  conversationDeploymentStoragePrefix,
  conversationArtifactRevisionStorageKey,
  conversationArtifactStorageKey,
  sanitizeArtifactFilename,
  writeArtifactContent,
  writeArtifactBuffer,
  writeArtifactTextContent,
  readArtifactContent,
} from "../artifacts/index.js";
import type {
  ArtifactActionQueueJob,
  MemoryAppendQueueJob,
  RunQueueJob,
} from "../queue/index.js";
import { createRealtimeEvent } from "../realtime/index.js";

export const defaultGroupConversationKey = "all";
export const defaultGroupConversationTitle = "all";

type ConversationRow = typeof conversations.$inferSelect;
type ConversationMessageRow = typeof conversationMessages.$inferSelect;
type ConversationGoalRow = typeof conversationGoals.$inferSelect;
type ConversationGoalTaskRow = typeof conversationGoalTasks.$inferSelect;
type ConversationArtifactRow = typeof conversationArtifacts.$inferSelect;
type ConversationMessageArtifactRow =
  typeof conversationMessageArtifacts.$inferSelect;
type ConversationArtifactRevisionRow =
  typeof conversationArtifactRevisions.$inferSelect;
type ConversationArtifactActionRow = typeof conversationArtifactActions.$inferSelect;
type ConversationDeploymentRow = typeof conversationDeployments.$inferSelect;

export interface UserMessageAttachmentUpload {
  artifactId: string;
  attachmentType: ConversationMessageAttachment["type"];
  filename: string;
  sizeBytes: number;
  storageKey: string;
  title: string;
}

export interface ActiveRunContext {
  createdAt: string;
  goalId?: string;
  latestEventType?: string;
  runId: string;
  status: string;
  taskIndex?: number;
}

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

export type DeleteArchivedGroupConversationResult =
  | { status: "deleted" }
  | { status: "not-found" }
  | { status: "reserved-key" }
  | { status: "not-archived" };

export interface AppendRunEventResult {
  dispatchJobs: RunQueueJob[];
  memoryAppendJobs: MemoryAppendQueueJob[];
  toolResult?: AgentHubMcpToolResult;
  realtimeEvents: RealtimeEvent[];
}

export interface AppendRunEventOptions {
  publicApiBaseUrl?: string;
  publicWebBaseUrl?: string;
  storageRoot?: string;
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
  goalId?: string;
  taskIndex?: number;
  title: string;
}

export interface PersistStaticSiteDeploymentInput {
  entrypoint: string;
  files: Array<{
    path: string;
    contentBase64: string;
    sizeBytes: number;
  }>;
  goalId?: string;
  publicApiBaseUrl?: string;
  runId: string;
  storageRoot: string;
  taskIndex?: number;
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
    goalId: optionalString(row.goalId),
    goalTaskId: optionalString(row.goalTaskId),
    taskIndex: row.taskIndex ?? undefined,
    runId: optionalString(row.runId),
    creatorAgentId: optionalString(row.creatorAgentId),
    creatorType: row.creatorType as ConversationArtifact["creatorType"],
    creatorUserId: optionalString(row.creatorUserId),
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

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

export const artifactUserFacingLinkInstructions =
  "When mentioning artifacts to the user, always use Markdown links in the form [title](editorUrl). Prefer artifact.userFacingLink/editorUrl; use downloadUrl only if editorUrl is missing. Do not show bare filenames or artifact ids as the deliverable entry.";

export function formatArtifactPromptLines(artifact: ConversationArtifact): string[] {
  const userFacingUrl = artifact.editorUrl ?? artifact.downloadUrl;
  const userFacingLink = userFacingUrl === undefined
    ? artifact.title
    : `[${escapeMarkdownLinkText(artifact.title)}](${userFacingUrl})`;

  return [
    "    artifact:",
    `      title: ${artifact.title}`,
    `      id: ${artifact.id}`,
    `      editorUrl: ${artifact.editorUrl ?? "none"}`,
    `      downloadUrl: ${artifact.downloadUrl ?? "none"}`,
    `      userFacingLink: ${userFacingLink}`,
  ];
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

async function insertUserMessageAttachments(
  db: Db,
  input: {
    attachments?: UserMessageAttachmentUpload[];
    conversationId: string;
    createdAt: Date;
    messageId: string;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<ConversationMessageAttachment[]> {
  const attachments = input.attachments ?? [];

  if (attachments.length === 0) {
    return [];
  }

  const artifactRows = await db
    .insert(conversationArtifacts)
    .values(
      attachments.map((attachment) => ({
        id: attachment.artifactId,
        ownerUserId: input.ownerUserId,
        conversationId: input.conversationId,
        creatorType: "user",
        creatorUserId: input.ownerUserId,
        status: "ready",
        title: attachment.title,
        filename: attachment.filename,
        sizeBytes: attachment.sizeBytes,
        storageKey: attachment.storageKey,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })),
    )
    .returning();
  const artifactById = new Map(artifactRows.map((artifact) => [artifact.id, artifact]));
  const messageArtifactRows = await db
    .insert(conversationMessageArtifacts)
    .values(
      attachments.flatMap((attachment, index) =>
        artifactById.has(attachment.artifactId)
          ? [{
              messageId: input.messageId,
              artifactId: attachment.artifactId,
              type: attachment.attachmentType,
              position: index,
              createdAt: input.createdAt,
            }]
          : []
      ),
    )
    .returning();

  return messageArtifactRows.flatMap((messageArtifact) => {
    const artifact = artifactById.get(messageArtifact.artifactId);

    return artifact === undefined
      ? []
      : [
          toConversationMessageAttachment(
            messageArtifact,
            toConversationArtifact(artifact, {
              publicApiBaseUrl: input.publicApiBaseUrl,
              publicWebBaseUrl: input.publicWebBaseUrl,
            }),
          ),
        ];
  });
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

export function toConversationGoalTask(
  row: ConversationGoalTaskRow,
  artifacts: ConversationArtifact[] = [],
  input: {
    conversationId?: ConversationId;
    publicWebBaseUrl?: string;
  } = {},
): ConversationGoalTask {
  return {
    id: row.id,
    goalId: row.goalId,
    index: row.index,
    assigneeAgentId: row.assigneeAgentId,
    assigneeRunId: optionalString(row.assigneeRunId),
    dispatchMessageId: optionalString(row.dispatchMessageId),
    dependsOnTaskIndexes: row.dependsOnTaskIndexes ?? [],
    title: row.title,
    description: optionalString(row.description),
    status: row.status as ConversationGoalTask["status"],
    blockedReason: optionalString(row.blockedReason),
    summary: optionalString(row.summary),
    resultArtifactIds: row.resultArtifactIds ?? undefined,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    completedAt: row.completedAt?.toISOString(),
    checkpointRunId: optionalString(row.checkpointRunId),
    webUrl:
      input.conversationId === undefined
        ? undefined
        : buildGoalTaskWebHref({
            conversationId: input.conversationId,
            goalId: row.goalId,
            publicWebBaseUrl: input.publicWebBaseUrl,
            taskIndex: row.index,
          }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationGoal(
  row: ConversationGoalRow,
  tasks: ConversationGoalTask[] = [],
  input: { publicWebBaseUrl?: string } = {},
): ConversationGoal {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    orchestratorAgentId: row.orchestratorAgentId,
    initialRunId: row.initialRunId,
    title: row.title,
    description: optionalString(row.description),
    status: row.status as ConversationGoal["status"],
    summary: optionalString(row.summary),
    tasks,
    completedAt: row.completedAt?.toISOString(),
    webUrl: buildGoalWebHref({
      conversationId: row.conversationId,
      goalId: row.id,
      publicWebBaseUrl: input.publicWebBaseUrl,
    }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildGoalWebHref(input: {
  conversationId: string;
  goalId: string;
  publicWebBaseUrl?: string;
}): string {
  const path = `/chat/${input.conversationId}/goals/${input.goalId}`;

  return input.publicWebBaseUrl === undefined
    ? path
    : new URL(path, input.publicWebBaseUrl).toString();
}

function buildGoalTaskWebHref(input: {
  conversationId: string;
  goalId: string;
  publicWebBaseUrl?: string;
  taskIndex: number;
}): string {
  const path = `/chat/${input.conversationId}/goals/${input.goalId}/tasks/${input.taskIndex}`;

  return input.publicWebBaseUrl === undefined
    ? path
    : new URL(path, input.publicWebBaseUrl).toString();
}

function toMcpGoalListFromRows(input: {
  goals: ConversationGoalRow[];
  tasksByGoalId: Map<string, ConversationGoalTaskRow[]>;
}): AgentHubListGoalsToolResult["goals"] {
  return input.goals.map((goal) =>
    toConversationGoal(
      goal,
      (input.tasksByGoalId.get(goal.id) ?? []).map((task) =>
        toConversationGoalTask(task)
      ),
    )
  );
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

export function buildAgentIdentityInstructions(input: {
  agentDescription?: string | null;
  agentName: string;
  conversationTitle?: string;
  isOrchestrator?: boolean;
  scenario: string;
}): string {
  const description = input.agentDescription?.trim();

  return [
    "<agenthub_agent_identity>",
    `You are ${input.agentName} in AgentHub.`,
    `Current scenario: ${input.scenario}.`,
    input.conversationTitle === undefined
      ? undefined
      : `Current conversation: #${input.conversationTitle}.`,
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group."
      : undefined,
    "Your runtime may be Codex, Claude Code, OpenCode, or another adapter, but that runtime is only the execution engine.",
    "Do not introduce yourself as Codex, Claude Code, OpenCode, or the runtime.",
    "Stay in character as this AgentHub agent and follow the role/profile below.",
    description === undefined || description.length === 0
      ? "Profile: No description provided."
      : ["Profile:", description].join("\n"),
    "</agenthub_agent_identity>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export interface AgentGroupContext {
  agents: Array<{ description?: string; id: string; name: string }>;
  conversationId: ConversationId;
  groupName: string;
  orchestratorAgentId?: string;
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
        .select({ description: agents.description, id: agents.id, name: agents.name })
        .from(agents)
        .where(
          and(
            eq(agents.ownerUserId, input.ownerUserId),
            eq(agents.status, "active"),
            inArray(agents.id, agentIds),
          ),
        )
        .orderBy(asc(agents.createdAt));
  const agentDetailsById = new Map(
    agentRows.map((agent) => [
      agent.id,
      {
        description: optionalString(agent.description),
        id: agent.id,
        name: agent.name,
      },
    ]),
  );

  return activeGroups
    .filter((conversation) => conversation.agentIds?.includes(input.agentId))
    .map((conversation) => ({
      agents: (conversation.agentIds ?? []).flatMap((agentId) => {
        const agent = agentDetailsById.get(agentId);

        return agent === undefined ? [] : [agent];
      }),
      conversationId: conversation.id,
      groupName: conversation.key === defaultGroupConversationKey
        ? defaultGroupConversationKey
        : conversation.title,
      orchestratorAgentId: conversation.orchestratorAgentId,
      title: conversation.title,
    }));
}

export function buildAgentGroupsPrompt(
  groups: AgentGroupContext[],
  options: { currentConversationId?: string } = {},
): string {
  const groupLines = groups.length === 0
    ? ["You are not a member of any active AgentHub groups."]
    : [
        "You are a member of these active AgentHub groups:",
        ...groups.flatMap((group) => {
          const isCurrentGroup = group.conversationId === options.currentConversationId;

          if (!isCurrentGroup) {
            return [
              `- #${group.title} (groupName: ${group.groupName}, conversationId: ${group.conversationId})`,
            ];
          }

          const orchestrator = group.orchestratorAgentId === undefined
            ? undefined
            : group.agents.find((agent) => agent.id === group.orchestratorAgentId);
          const memberLines = group.agents.length === 0
            ? ["  members: none"]
            : [
                "  members:",
                ...group.agents.map((agent) => {
                  const description = agent.description?.trim();
                  const role = agent.id === group.orchestratorAgentId
                    ? " [Orchestrator]"
                    : "";

                  return `  - @${agent.name}${role}: ${
                    description === undefined || description.length === 0
                      ? "No description provided."
                      : description
                  }`;
                }),
              ];

          return [
            `- #${group.title} (groupName: ${group.groupName}, conversationId: ${group.conversationId}; orchestrator: ${
              orchestrator === undefined ? "none" : `@${orchestrator.name}`
            })`,
            ...memberLines,
          ];
        }),
      ];

  return [
    "<agenthub_agent_groups>",
    ...groupLines,
    "Only the current group includes member details. Other groups are listed without member rosters.",
    "Use send_message with target { type: \"group\", groupName } to send a visible message to one of these groups.",
    "To wake another agent in a group, include @AgentName in the message content. To wake all other ready agents in the target group, include @all.",
    "If you are only replying to the current conversation or giving a status update, do not mention @AgentName or @all; mentioning an agent or @all forces AgentHub to start reply runs.",
    "Use send_message with target { type: \"user\" } to send a visible private message to the current user.",
    "Archived groups are not listed and cannot be targeted.",
    "</agenthub_agent_groups>",
  ].join("\n");
}

export function buildActiveRunsPrompt(
  activeRuns: ActiveRunContext[],
): string | undefined {
  const filteredRuns = activeRuns.filter((run) =>
    run.status === "queued" || run.status === "running"
  );

  if (filteredRuns.length === 0) {
    return undefined;
  }

  return [
    "<agenthub_active_runs>",
    "You already have active runs in this conversation.",
    "Do not assume they are complete. Coordinate with the visible conversation state and avoid duplicating the exact same work unless the user explicitly asks.",
    ...filteredRuns.map((run) => {
      const details = [
        `Run ${run.runId}: ${run.status}`,
        `createdAt: ${run.createdAt}`,
        run.latestEventType === undefined
          ? undefined
          : `latestEvent: ${run.latestEventType}`,
        run.goalId === undefined ? undefined : `Goal ID: ${run.goalId}`,
        run.taskIndex === undefined ? undefined : `Task #${run.taskIndex}`,
      ].filter((detail): detail is string => detail !== undefined);

      return `- ${details.join(", ")}`;
    }),
    "</agenthub_active_runs>",
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

function compactUniqueNumbers(values: number[]): number[] {
  return [
    ...new Set(
      values.filter((value) => Number.isInteger(value) && value >= 0),
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

export async function listConversationDeploymentsForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    publicApiBaseUrl?: string;
  },
): Promise<ConversationDeployment[] | null> {
  const conversation = await getConversationForUser(db, input);

  if (conversation === null) {
    return null;
  }

  const rows = await db
    .select()
    .from(conversationDeployments)
    .where(eq(conversationDeployments.conversationId, input.conversationId))
    .orderBy(desc(conversationDeployments.createdAt));

  return rows.map((row) =>
    toConversationDeployment(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
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
  if (artifact.status !== "ready" || artifact.creatorType === "user") {
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

  if (record.artifact.runId === undefined) {
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

  const targetConversation = input.goalId === undefined
    ? await getSendMessageTargetConversation(db, {
        currentConversationId: run.conversationId,
        ownerUserId: run.ownerUserId,
        runAgentId: run.agentId,
        target: input.messageTarget,
      })
    : null;
  const artifactConversationId = input.goalId === undefined
    ? targetConversation?.id
    : run.conversationId;

  if (artifactConversationId === undefined) {
    throw new Error("Artifact upload target conversation was not found.");
  }

  let goalTaskId: string | undefined;
  if (input.goalId !== undefined) {
    if (input.taskIndex === undefined) {
      throw new Error("Artifact task index is required for goal uploads.");
    }

    const [task] = await db
      .select({
        id: conversationGoalTasks.id,
      })
      .from(conversationGoalTasks)
      .innerJoin(conversationGoals, eq(conversationGoalTasks.goalId, conversationGoals.id))
      .where(
        and(
          eq(conversationGoals.id, input.goalId),
          eq(conversationGoals.conversationId, artifactConversationId),
          eq(conversationGoalTasks.index, input.taskIndex),
          eq(conversationGoalTasks.assigneeRunId, input.runId),
          eq(conversationGoalTasks.assigneeAgentId, run.agentId),
        ),
      )
      .limit(1);

    if (task === undefined) {
      throw new Error("Artifact goal task does not belong to this run.");
    }
    goalTaskId = task.id;
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
      goalId: input.goalId,
      goalTaskId,
      taskIndex: input.taskIndex,
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
    userMessageAttachments?: UserMessageAttachmentUpload[];
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<{
  conversation: Conversation;
  memoryAppendJobs: MemoryAppendQueueJob[];
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
    const userAttachments = await insertUserMessageAttachments(tx as unknown as Db, {
      attachments: input.userMessageAttachments,
      conversationId: input.conversationId,
      createdAt,
      messageId: userMessage.id,
      ownerUserId: input.ownerUserId,
      publicApiBaseUrl: input.publicApiBaseUrl,
      publicWebBaseUrl: input.publicWebBaseUrl,
    });
    const userMessageWithAttachments = toConversationMessage(
      userMessage,
      userAttachments,
    );

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
      memoryAppendJobs: await createConversationTranscriptMemoryJobs(tx as unknown as Db, {
        conversation: conversationRow,
        message: userMessageWithAttachments,
      }),
      messages: {
        user: userMessageWithAttachments,
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
    userMessageAttachments?: UserMessageAttachmentUpload[];
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<{
  conversation: Conversation;
  memoryAppendJobs: MemoryAppendQueueJob[];
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
    const userAttachments = await insertUserMessageAttachments(tx as unknown as Db, {
      attachments: input.userMessageAttachments,
      conversationId: input.conversationId,
      createdAt,
      messageId: userMessage.id,
      ownerUserId: input.ownerUserId,
      publicApiBaseUrl: input.publicApiBaseUrl,
      publicWebBaseUrl: input.publicWebBaseUrl,
    });
    const userMessageWithAttachments = toConversationMessage(
      userMessage,
      userAttachments,
    );

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
      memoryAppendJobs: await createConversationTranscriptMemoryJobs(tx as unknown as Db, {
        conversation: conversationRow,
        message: userMessageWithAttachments,
      }),
      messages: {
        user: userMessageWithAttachments,
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

function readListGoalsToolInput(
  input: unknown,
): { status?: ConversationGoal["status"] } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const status = (input as Record<string, unknown>).status;

  return typeof status === "string" && status.length > 0
    ? { status: status as ConversationGoal["status"] }
    : {};
}

function readCreateGoalToolInput(
  input: unknown,
): AgentHubCreateGoalToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("title" in input)
  ) {
    return null;
  }

  const goalInput = input as AgentHubCreateGoalToolInput;
  const title = goalInput.title.trim();
  const description = goalInput.description?.trim();

  return title.length > 0 && title.length <= 160
    ? {
        title,
        description: description && description.length > 0 ? description : undefined,
      }
    : null;
}

function readCreateTaskToolInput(
  input: unknown,
): AgentHubCreateTaskToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("goalId" in input) ||
    !("title" in input) ||
    !("assigneeAgentId" in input)
  ) {
    return null;
  }

  const taskInput = input as AgentHubCreateTaskToolInput;
  const title = taskInput.title.trim();
  const description = taskInput.description?.trim();

  return typeof taskInput.goalId === "string" &&
    taskInput.goalId.length > 0 &&
    title.length > 0 &&
    title.length <= 160 &&
    typeof taskInput.assigneeAgentId === "string" &&
    taskInput.assigneeAgentId.length > 0
    ? {
        goalId: taskInput.goalId,
        title,
        description: description && description.length > 0 ? description : undefined,
        assigneeAgentId: taskInput.assigneeAgentId,
        dependsOnTaskIndexes: Array.isArray(taskInput.dependsOnTaskIndexes)
          ? compactUniqueNumbers(taskInput.dependsOnTaskIndexes)
          : undefined,
      }
    : null;
}

function readApproveTaskToolInput(
  input: unknown,
): AgentHubApproveTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = record.taskIndex;

  return typeof goalId === "string" &&
    goalId.length > 0 &&
    typeof taskIndex === "number" &&
    Number.isInteger(taskIndex) &&
    taskIndex >= 0
    ? { goalId, taskIndex }
    : null;
}

function readCancelTaskToolInput(
  input: unknown,
): AgentHubCancelTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = record.taskIndex;
  const reason = record.reason;

  return typeof goalId === "string" &&
    goalId.length > 0 &&
    typeof taskIndex === "number" &&
    Number.isInteger(taskIndex) &&
    taskIndex >= 0
    ? {
        goalId,
        taskIndex,
        reason: typeof reason === "string" && reason.trim().length > 0
          ? reason.trim()
          : undefined,
      }
    : null;
}

function readCompleteGoalToolInput(
  input: unknown,
): AgentHubCompleteGoalToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const summary = record.summary;

  return typeof goalId === "string" && goalId.length > 0
    ? {
        goalId,
        summary: typeof summary === "string" && summary.trim().length > 0
          ? summary.trim()
          : undefined,
      }
    : null;
}

function readListArtifactsToolInput(
  input: unknown,
): AgentHubListArtifactsToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = record.taskIndex;
  const limit = record.limit;

  return {
    goalId: typeof goalId === "string" && goalId.length > 0
      ? goalId
      : undefined,
    taskIndex: typeof taskIndex === "number" &&
      Number.isInteger(taskIndex) &&
      taskIndex >= 0
      ? taskIndex
      : undefined,
    limit: typeof limit === "number" && Number.isInteger(limit) && limit > 0
      ? Math.min(limit, 50)
      : undefined,
  };
}

function readReadArtifactToolInput(
  input: unknown,
): AgentHubReadArtifactToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const artifactId = record.artifactId;

  return typeof artifactId === "string" &&
    artifactId.length > 0
    ? {
        artifactId,
        goalId: typeof goalId === "string" && goalId.length > 0
          ? goalId
          : undefined,
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
    !("goalId" in input) ||
    !("taskIndex" in input) ||
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
    typeof artifactInput.goalId === "string" &&
    artifactInput.goalId.length > 0 &&
    typeof artifactInput.taskIndex === "number" &&
    Number.isInteger(artifactInput.taskIndex) &&
    artifactInput.taskIndex >= 0 &&
    localPath.length > 0
    ? {
        goalId: artifactInput.goalId,
        taskIndex: artifactInput.taskIndex,
        title,
        localPath,
        filename: filename && filename.length > 0 ? filename : undefined,
      }
    : null;
}

function readDeployStaticSiteToolInput(
  input: unknown,
): AgentHubDeployStaticSiteToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("title" in input) ||
    !("localPath" in input)
  ) {
    return null;
  }

  const deploymentInput = input as AgentHubDeployStaticSiteToolInput;
  const title = deploymentInput.title.trim();
  const localPath = deploymentInput.localPath.trim();
  const entrypoint = deploymentInput.entrypoint?.trim();

  return title.length > 0 &&
    title.length <= 160 &&
    localPath.length > 0 &&
    (deploymentInput.goalId === undefined ||
      typeof deploymentInput.goalId === "string") &&
    (deploymentInput.taskIndex === undefined ||
      (typeof deploymentInput.taskIndex === "number" &&
        Number.isInteger(deploymentInput.taskIndex) &&
        deploymentInput.taskIndex >= 0))
    ? {
        goalId: deploymentInput.goalId,
        taskIndex: deploymentInput.taskIndex,
        title,
        localPath,
        entrypoint: entrypoint && entrypoint.length > 0 ? entrypoint : undefined,
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
    !("goalId" in input) ||
    !("taskIndex" in input) ||
    !("summary" in input)
  ) {
    return null;
  }

  const taskInput = input as AgentHubCompleteTaskToolInput;
  const summary = taskInput.summary.trim();
  const artifactIds = Array.isArray(taskInput.artifactIds)
    ? compactUniqueStrings(taskInput.artifactIds)
    : undefined;

  return typeof taskInput.goalId === "string" &&
    taskInput.goalId.length > 0 &&
    typeof taskInput.taskIndex === "number" &&
    Number.isInteger(taskInput.taskIndex) &&
    taskInput.taskIndex >= 0 &&
    summary.length > 0
    ? {
        goalId: taskInput.goalId,
        taskIndex: taskInput.taskIndex,
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
  const allPattern = /@all/gi;
  let allMatch: RegExpExecArray | null;

  while ((allMatch = allPattern.exec(content)) !== null) {
    const start = allMatch.index;
    const end = start + allMatch[0].length;

    if (!hasMentionBoundary(content, end)) {
      continue;
    }

    matchedMentions.push(
      ...refs.map((agent) => ({ agentId: agent.id, start, end })),
    );
    break;
  }

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

async function createConversationTranscriptMemoryJobs(
  db: Db,
  input: {
    conversation: Pick<ConversationRow, "id" | "key" | "ownerUserId" | "title" | "type" | "directAgentId">;
    message: ConversationMessage;
  },
): Promise<MemoryAppendQueueJob[]> {
  const agentIds = input.conversation.type === "direct"
    ? [input.conversation.directAgentId].filter((id): id is string => id !== null && id !== undefined)
    : (await listConversationAgentRefs(db, input.conversation)).map((agent) => agent.id);
  const uniqueAgentIds = [...new Set(agentIds)];
  const createdAt = input.message.createdAt;
  const date = createdAt.slice(0, 10);
  const sender = input.message.senderType === "agent"
    ? `agent:${input.message.senderAgentId ?? "unknown"}`
    : input.message.senderType;
  const content = [
    `Conversation: #${input.conversation.title} (${input.conversation.id})`,
    `Message: ${input.message.id}`,
    `Sender: ${sender}`,
    input.message.runId === undefined ? undefined : `Run: ${input.message.runId}`,
    `Created at: ${createdAt}`,
    "",
    input.message.content.trim() || "(empty message)",
    ...((input.message.attachments ?? []).length === 0
      ? []
      : [
          "",
          "Attachments:",
          ...(input.message.attachments ?? []).map((attachment) => {
            const artifact = attachment.artifact;
            const link = artifact.editorUrl ?? artifact.downloadUrl;

            return link === undefined
              ? `- ${artifact.title} (${artifact.id})`
              : `- [${artifact.title}](${link}) (${artifact.id})`;
          }),
        ]),
  ].filter((line): line is string => line !== undefined).join("\n");
  const jobs: MemoryAppendQueueJob[] = [];

  for (const agentId of uniqueAgentIds) {
    const runAgent = await getRunnableAgentForUser(db, {
      agentId,
      ownerUserId: input.conversation.ownerUserId,
    });

    if (runAgent === null) {
      continue;
    }

    jobs.push({
      agentId,
      daemonDeviceId: runAgent.daemonDeviceId,
      workspacePath: runAgent.workspacePath,
      kind: "transcript",
      title: input.conversation.title,
      content,
      date,
      dedupeKey: `message:${input.message.id}`,
      createdAt,
    });
  }

  return jobs;
}

async function createRunDailyMemoryJob(
  db: Db,
  input: {
    content: string;
    createdAt: string;
    dedupeKey: string;
    runId: string;
    tags?: string[];
    title: string;
  },
): Promise<MemoryAppendQueueJob[]> {
  const [run] = await db
    .select({
      agentId: runs.agentId,
      daemonDeviceId: runs.daemonDeviceId,
      workspacePath: runs.workspacePath,
    })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .limit(1);

  if (run === undefined) {
    return [];
  }

  return [
    {
      agentId: run.agentId,
      daemonDeviceId: run.daemonDeviceId,
      workspacePath: run.workspacePath,
      kind: "daily",
      title: input.title,
      content: input.content,
      tags: input.tags,
      date: input.createdAt.slice(0, 10),
      dedupeKey: input.dedupeKey,
      createdAt: input.createdAt,
    },
  ];
}

function describeSendMessageTarget(
  target: AgentHubSendMessageTarget | undefined,
): string {
  if (target === undefined || target.type === "current") {
    return "current conversation";
  }

  if (target.type === "user") {
    return "private conversation with the user";
  }

  return `group ${target.groupName}`;
}

export async function createArtifactUploadMemoryAppendJobs(
  db: Db,
  input: { artifact: ConversationArtifact },
): Promise<MemoryAppendQueueJob[]> {
  if (input.artifact.runId === undefined) {
    return [];
  }

  return createRunDailyMemoryJob(db, {
    runId: input.artifact.runId,
    createdAt: input.artifact.createdAt,
    title: "Artifact uploaded",
    tags: ["artifact", "upload"],
    dedupeKey: `artifact-upload:${input.artifact.id}`,
    content: [
      `Uploaded artifact: ${input.artifact.title} (${input.artifact.id})`,
      `Conversation: ${input.artifact.conversationId}`,
      input.artifact.goalId === undefined ? undefined : `Goal: ${input.artifact.goalId}`,
      input.artifact.taskIndex === undefined ? undefined : `Task index: ${input.artifact.taskIndex}`,
      input.artifact.editorUrl === undefined ? undefined : `Editor: ${input.artifact.editorUrl}`,
      input.artifact.downloadUrl === undefined ? undefined : `Download: ${input.artifact.downloadUrl}`,
    ].filter((line): line is string => line !== undefined).join("\n"),
  });
}

function normalizeDeploymentFilePath(filePath: string): string {
  const normalized = filePath.split(/[\\/]+/).filter(Boolean).join("/");

  if (
    normalized.length === 0 ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".."
  ) {
    throw new Error("Deployment file path is invalid.");
  }

  return normalized;
}

export async function persistStaticSiteDeployment(
  db: Db,
  input: PersistStaticSiteDeploymentInput,
): Promise<ConversationDeployment> {
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
    throw new Error("Static site deployment run was not found.");
  }

  let goalTaskId: string | undefined;
  if (input.goalId !== undefined) {
    if (input.taskIndex === undefined) {
      throw new Error("Deployment task index is required for goal deployments.");
    }

    const [task] = await db
      .select({
        id: conversationGoalTasks.id,
      })
      .from(conversationGoalTasks)
      .innerJoin(conversationGoals, eq(conversationGoalTasks.goalId, conversationGoals.id))
      .where(
        and(
          eq(conversationGoals.id, input.goalId),
          eq(conversationGoals.conversationId, run.conversationId),
          eq(conversationGoalTasks.index, input.taskIndex),
          eq(conversationGoalTasks.assigneeRunId, input.runId),
          eq(conversationGoalTasks.assigneeAgentId, run.agentId),
        ),
      )
      .limit(1);

    if (task === undefined) {
      throw new Error("Deployment goal task does not belong to this run.");
    }
    goalTaskId = task.id;
  }

  const normalizedEntrypoint = normalizeDeploymentFilePath(input.entrypoint);
  const deploymentFiles = input.files.map((file) => ({
    ...file,
    path: normalizeDeploymentFilePath(file.path),
  }));
  const entrypointFile = deploymentFiles.find(
    (file) => file.path === normalizedEntrypoint,
  );

  if (entrypointFile === undefined) {
    throw new Error("Static site entrypoint was not included in deployment.");
  }

  const deploymentId = randomUUID();
  const storagePrefix = conversationDeploymentStoragePrefix({
    conversationId: run.conversationId,
    deploymentId,
  });

  for (const file of deploymentFiles) {
    const content = Buffer.from(file.contentBase64, "base64");
    if (content.byteLength !== file.sizeBytes) {
      throw new Error(`Deployment file size did not match: ${file.path}`);
    }

    await writeArtifactBuffer({
      content,
      storageKey: conversationDeploymentFileStorageKey({
        storagePrefix,
        filePath: file.path,
      }),
      storageRoot: input.storageRoot,
    });
  }

  const now = new Date();
  const [deployment] = await db
    .insert(conversationDeployments)
    .values({
      id: deploymentId,
      ownerUserId: run.ownerUserId,
      conversationId: run.conversationId,
      goalId: input.goalId,
      taskIndex: input.taskIndex,
      runId: input.runId,
      creatorAgentId: run.agentId,
      title: input.title.trim(),
      entrypoint: normalizedEntrypoint,
      status: "ready",
      storagePrefix,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (deployment === undefined) {
    throw new Error("Static site deployment could not be persisted.");
  }

  void goalTaskId;

  return toConversationDeployment(deployment, {
    publicApiBaseUrl: input.publicApiBaseUrl,
  });
}

export async function getConversationDeploymentFileForUser(
  db: Db,
  input: {
    deploymentId: string;
    ownerUserId: string;
    requestedPath?: string;
    storageRoot: string;
    publicApiBaseUrl?: string;
  },
): Promise<
  | {
      content: Buffer;
      deployment: ConversationDeployment;
      filename: string;
    }
  | null
> {
  const [row] = await db
    .select()
    .from(conversationDeployments)
    .where(
      and(
        eq(conversationDeployments.id, input.deploymentId),
        eq(conversationDeployments.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  if (row === undefined || row.status !== "ready") {
    return null;
  }

  const requestedPath = input.requestedPath?.trim();
  const filePath =
    requestedPath === undefined || requestedPath.length === 0
      ? row.entrypoint
      : normalizeDeploymentFilePath(requestedPath);
  const content = await readArtifactContent({
    storageKey: conversationDeploymentFileStorageKey({
      storagePrefix: row.storagePrefix,
      filePath,
    }),
    storageRoot: input.storageRoot,
  });

  return {
    content,
    deployment: toConversationDeployment(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
    }),
    filename: filePath,
  };
}

export async function createArtifactActionMemoryAppendJobs(
  db: Db,
  input: {
    action: ConversationArtifactAction;
    createdAt?: string;
  },
): Promise<MemoryAppendQueueJob[]> {
  if (input.action.status !== "succeeded") {
    return [];
  }

  const [row] = await db
    .select({
      artifact: conversationArtifacts,
      run: runs,
    })
    .from(conversationArtifacts)
    .innerJoin(runs, eq(conversationArtifacts.runId, runs.id))
    .where(eq(conversationArtifacts.id, input.action.artifactId))
    .limit(1);

  if (row === undefined) {
    return [];
  }

  const createdAt = input.createdAt ?? input.action.updatedAt;

  return [
    {
      agentId: row.run.agentId,
      daemonDeviceId: row.run.daemonDeviceId,
      workspacePath: row.run.workspacePath,
      kind: "daily",
      title: "Artifact action completed",
      tags: ["artifact", "action", input.action.type],
      date: createdAt.slice(0, 10),
      dedupeKey: `artifact-action:${input.action.id}:${input.action.status}`,
      createdAt,
      content: [
        `Completed artifact action: ${input.action.type}`,
        `Action: ${input.action.id}`,
        `Artifact: ${row.artifact.title} (${row.artifact.id})`,
        `Conversation: ${row.artifact.conversationId}`,
        row.artifact.goalId === null ? undefined : `Goal: ${row.artifact.goalId}`,
        row.artifact.taskIndex === null ? undefined : `Task index: ${row.artifact.taskIndex}`,
      ].filter((line): line is string => line !== undefined).join("\n"),
    },
  ];
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
  goalId: string;
  goalTitle: string;
  taskId: string;
  taskIndex: number;
  taskTitle: string;
  taskDescription?: string;
  dispatchMessage: string;
}): string {
  return [
    "<agenthub_assigned_task>",
    `Group: #${input.conversationTitle}`,
    `Goal ID: ${input.goalId}`,
    `Goal: ${input.goalTitle}`,
    `Task ID: ${input.taskId}`,
    `Task Index: ${input.taskIndex}`,
    `Task: ${input.taskTitle}`,
    input.taskDescription ? `Description: ${input.taskDescription}` : undefined,
    "",
    "You were assigned this task by the group orchestrator.",
    "Create the requested report or result file in your current workspace.",
    "You can inspect prior group workspace artifacts with list_artifacts and read_artifact before producing your result.",
    "Use the exact Goal ID and Task Index above when calling AgentHub MCP upload_artifact and complete_task.",
    "If the result is a report, screenshot, zip, or source package, upload it with upload_artifact. If the result is a runnable static HTML/CSS/JavaScript website, deploy it with deploy_static_site using the exact Goal ID and Task Index above, then include the returned deployment URL in your summary or visible message.",
    "After uploading/deploying, call complete_task with a concise summary and any uploaded artifact ids.",
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
  agentName: string;
  agentDescription?: string;
  conversationTitle: string;
}): string {
  return [
    buildAgentIdentityInstructions({
      agentDescription: input.agentDescription,
      agentName: input.agentName,
      conversationTitle: input.conversationTitle,
      scenario: "assigned task",
    }),
    `You are working inside AgentHub group #${input.conversationTitle}.`,
    "Visible task updates must be sent with send_message. Completed files must be reported with upload_artifact; runnable static websites should be deployed with deploy_static_site. Always finish assigned work with complete_task.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n\n");
}

function buildMentionedGroupChatAgentInstructions(input: {
  agentName: string;
  agentDescription?: string;
  conversationTitle: string;
  isOrchestrator?: boolean;
}): string {
  return [
    buildAgentIdentityInstructions({
      agentDescription: input.agentDescription,
      agentName: input.agentName,
      conversationTitle: input.conversationTitle,
      isOrchestrator: input.isOrchestrator,
      scenario: "mentioned group chat",
    }),
    `You are participating in the AgentHub group chat #${input.conversationTitle}.`,
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group, even in Chat mode."
      : undefined,
    "Visible group replies must be sent with the AgentHub MCP tool send_message.",
    "For ordinary replies or progress updates, do not include @AgentName or @all. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run, or @all when you intentionally want all other ready agents in the group to run.",
    "Do not answer a group chat by writing normal assistant text.",
  ].filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n\n");
}

export function buildMentionedGroupChatRunPrompt(input: {
  activeRunsPrompt?: string;
  agentGroupsPrompt: string;
  agentName: string;
  agentNamesById: Record<string, string>;
  conversationTitle: string;
  currentMessage: string;
  directMessagesPrompt?: string;
  isOrchestrator?: boolean;
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
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group, even in Chat mode."
      : undefined,
    input.isOrchestrator === true
      ? "You may coordinate other agents by sending visible messages with @AgentName or @all, but only reply when useful."
      : undefined,
    `${input.senderAgentName} explicitly mentioned you in the latest message.`,
    "If you should reply, call the MCP tool send_message with { content: string }.",
    "For ordinary replies, do not include @AgentName or @all. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run, or @all when you intentionally want all other ready agents in the group to run.",
    "If you should not reply, do not call send_message.",
    "Never use normal assistant text as the visible group reply. Normal assistant text is ignored by AgentHub group chat.",
    "</agenthub_group_chat_protocol>",
    "",
    input.agentGroupsPrompt,
    "",
    input.directMessagesPrompt,
    input.directMessagesPrompt === undefined ? undefined : "",
    input.activeRunsPrompt,
    input.activeRunsPrompt === undefined ? undefined : "",
    conversationPrompt,
  ].filter((line): line is string => line !== undefined).join("\n");
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

async function getActiveRunContextPromptForAgent(
  db: Db,
  input: {
    agentId: string;
    conversationId: string;
    ownerUserId: string;
  },
): Promise<string | undefined> {
  const activeRunRows = await db
    .select({
      createdAt: runs.createdAt,
      id: runs.id,
      status: runs.status,
    })
    .from(runs)
    .where(
      and(
        eq(runs.ownerUserId, input.ownerUserId),
        eq(runs.conversationId, input.conversationId),
        eq(runs.agentId, input.agentId),
        inArray(runs.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(3);

  if (activeRunRows.length === 0) {
    return undefined;
  }

  const activeRunIds = activeRunRows.map((run) => run.id);
  const latestEventRows = await db
    .select({
      eventType: runEvents.eventType,
      runId: runEvents.runId,
    })
    .from(runEvents)
    .where(inArray(runEvents.runId, activeRunIds))
    .orderBy(desc(runEvents.createdAt));
  const latestEventTypeByRunId = new Map<string, string>();

  for (const event of latestEventRows) {
    if (!latestEventTypeByRunId.has(event.runId)) {
      latestEventTypeByRunId.set(event.runId, event.eventType);
    }
  }

  const taskRows = await db
    .select({
      goalId: conversationGoalTasks.goalId,
      runId: conversationGoalTasks.assigneeRunId,
      taskIndex: conversationGoalTasks.index,
    })
    .from(conversationGoalTasks)
    .where(inArray(conversationGoalTasks.assigneeRunId, activeRunIds));
  const taskByRunId = new Map(
    taskRows.flatMap((task) =>
      task.runId === null
        ? []
        : [[task.runId, { goalId: task.goalId, taskIndex: task.taskIndex }]]
    ),
  );

  return buildActiveRunsPrompt(
    activeRunRows.map((run) => {
      const task = taskByRunId.get(run.id);

      return {
        createdAt: run.createdAt.toISOString(),
        goalId: task?.goalId,
        latestEventType: latestEventTypeByRunId.get(run.id),
        runId: run.id,
        status: run.status,
        taskIndex: task?.taskIndex,
      };
    }),
  );
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
  const agentHubMcpGoals =
    (await listConversationGoalsForUser(db, {
      conversationId: input.conversation.id,
      ownerUserId: input.ownerUserId,
    })) ?? [];
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

    const isOrchestrator = input.conversation.orchestratorAgentId === runAgent.agent.id;
    const runId = randomUUID();
    const agentGroupsPrompt = buildAgentGroupsPrompt(
      await listActiveAgentGroupContexts(db, {
        agentId: runAgent.agent.id,
        ownerUserId: input.ownerUserId,
      }),
      { currentConversationId: input.conversation.id },
    );
    const activeRunsPrompt = await getActiveRunContextPromptForAgent(db, {
      agentId: runAgent.agent.id,
      conversationId: input.conversation.id,
      ownerUserId: input.ownerUserId,
    });
    const job: RunQueueJob = {
      conversationId: input.conversation.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      prompt: buildMentionedGroupChatRunPrompt({
        activeRunsPrompt,
        agentGroupsPrompt,
        agentName: runAgent.agent.name,
        agentNamesById,
        conversationTitle: input.conversation.title,
        currentMessage: input.content,
        directMessagesPrompt: buildRecentDirectMessagesPrompt({
          agentName: runAgent.agent.name,
          agentNamesById,
          messages: await listRecentDirectConversationMessagesForAgent(db, {
            agentId: runAgent.agent.id,
            limit: 20,
            ownerUserId: input.ownerUserId,
          }),
        }),
        isOrchestrator,
        messages: priorMessages,
        senderAgentName,
      }),
      agentInstructions: buildMentionedGroupChatAgentInstructions({
        agentName: runAgent.agent.name,
        agentDescription: runAgent.agent.description,
        conversationTitle: input.conversation.title,
        isOrchestrator,
      }),
      agentHubMcpTools: isOrchestrator
        ? [...agentHubAllMcpTools]
        : [...agentHubNonOrchestratorMcpTools],
      agentHubMcpGoals,
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
  memoryAppendJobs: MemoryAppendQueueJob[];
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
  const conversationMessage = toConversationMessage(message, attachments);
  const memoryAppendJobs = await createConversationTranscriptMemoryJobs(db, {
    conversation: input.conversation,
    message: conversationMessage,
  });
  const realtimeEvents: RealtimeEvent[] = [
    createRealtimeEvent({
      conversationId: input.conversation.id,
      message: conversationMessage,
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
    memoryAppendJobs,
    message: conversationMessage,
    realtimeEvents,
  };
}

export function toConversationDeployment(
  row: ConversationDeploymentRow,
  input: { publicApiBaseUrl?: string } = {},
): ConversationDeployment {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    goalId: optionalString(row.goalId),
    taskIndex: row.taskIndex ?? undefined,
    runId: row.runId,
    creatorAgentId: row.creatorAgentId,
    title: row.title,
    entrypoint: row.entrypoint,
    status: row.status as ConversationDeployment["status"],
    url:
      input.publicApiBaseUrl === undefined
        ? undefined
        : buildDeploymentUrl({
            deploymentId: row.id,
            publicApiBaseUrl: input.publicApiBaseUrl,
          }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "succeeded" ||
    status === "failed" ||
    status === "cancelled";
}

function isActiveTaskStatus(status: string): boolean {
  return status === "waiting" ||
    status === "ready" ||
    status === "assigned" ||
    status === "running";
}

async function listGoalTasks(
  db: Db,
  goalId: string,
): Promise<ConversationGoalTaskRow[]> {
  return db
    .select()
    .from(conversationGoalTasks)
    .where(eq(conversationGoalTasks.goalId, goalId))
    .orderBy(asc(conversationGoalTasks.index));
}

function dependencyStatusForTask(
  taskInput: AgentHubCreateTaskToolInput,
  existingTasks: ConversationGoalTaskRow[],
): { blockedReason?: string; status: ConversationGoalTask["status"] } {
  const dependencyIndexes = taskInput.dependsOnTaskIndexes ?? [];

  if (dependencyIndexes.length === 0) {
    return { status: "assigned" };
  }

  const tasksByIndex = new Map(existingTasks.map((task) => [task.index, task]));
  const missingDependency = dependencyIndexes.find((index) => !tasksByIndex.has(index));

  if (missingDependency !== undefined) {
    return {
      blockedReason: `Dependency task #${missingDependency} was not found.`,
      status: "blocked",
    };
  }

  const failedDependency = dependencyIndexes
    .map((index) => tasksByIndex.get(index))
    .find((task) =>
      task !== undefined &&
      (task.status === "failed" ||
        task.status === "cancelled" ||
        task.status === "blocked")
    );

  if (failedDependency !== undefined) {
    return {
      blockedReason: `Dependency task #${failedDependency.index} is ${failedDependency.status}.`,
      status: "blocked",
    };
  }

  return dependencyIndexes.every((index) => tasksByIndex.get(index)?.status === "succeeded")
    ? { status: "ready" }
    : { status: "waiting" };
}

async function updateDependentTaskReadiness(
  db: Db,
  input: {
    createdAt: Date;
    goalId: string;
    realtimeEvents: RealtimeEvent[];
  },
): Promise<void> {
  const goalTasks = await listGoalTasks(db, input.goalId);
  const [goal] = await db
    .select()
    .from(conversationGoals)
    .where(eq(conversationGoals.id, input.goalId))
    .limit(1);

  if (goal === undefined) {
    return;
  }

  const tasksByIndex = new Map(goalTasks.map((task) => [task.index, task]));

  for (const task of goalTasks) {
    if (task.status !== "waiting" && task.status !== "ready") {
      continue;
    }

    const dependencyIndexes = task.dependsOnTaskIndexes ?? [];

    if (dependencyIndexes.length === 0) {
      continue;
    }

    const failedDependency = dependencyIndexes
      .map((index) => tasksByIndex.get(index))
      .find((dependency) =>
        dependency !== undefined &&
        (dependency.status === "failed" ||
          dependency.status === "cancelled" ||
          dependency.status === "blocked")
      );
    const nextStatus: ConversationGoalTask["status"] = failedDependency !== undefined
      ? "blocked"
      : dependencyIndexes.every((index) => tasksByIndex.get(index)?.status === "succeeded")
        ? "ready"
        : "waiting";
    const blockedReason = failedDependency === undefined
      ? null
      : `Dependency task #${failedDependency.index} is ${failedDependency.status}.`;

    if (
      task.status === nextStatus &&
      (task.blockedReason ?? null) === blockedReason
    ) {
      continue;
    }

    await db
      .update(conversationGoalTasks)
      .set({
        status: nextStatus,
        blockedReason,
        updatedAt: input.createdAt,
      })
      .where(eq(conversationGoalTasks.id, task.id));
    input.realtimeEvents.push(
      createRealtimeEvent({
        conversationId: goal.conversationId,
        ownerUserId: goal.ownerUserId,
        taskId: task.id,
        type: "task.updated",
      }),
    );
  }
}

async function maybeCreateCheckpointRunForTask(
  db: Db,
  input: {
    createdAt: Date;
    dispatchJobs: RunQueueJob[];
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
    realtimeEvents: RealtimeEvent[];
    goalTaskId: string;
  },
): Promise<void> {
  const [task] = await db
    .select()
    .from(conversationGoalTasks)
    .where(eq(conversationGoalTasks.id, input.goalTaskId))
    .limit(1);

  if (
    task === undefined ||
    task.checkpointRunId !== null ||
    !isTerminalTaskStatus(task.status)
  ) {
    return;
  }

  const [goal] = await db
    .select()
    .from(conversationGoals)
    .where(eq(conversationGoals.id, task.goalId))
    .limit(1);

  if (goal === undefined || goal.status !== "active") {
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, goal.conversationId))
    .limit(1);

  if (
    conversation === undefined ||
    conversation.orchestratorAgentId === null
  ) {
    return;
  }

  const runAgent = await getRunnableAgentForUser(db, {
    agentId: conversation.orchestratorAgentId,
    ownerUserId: goal.ownerUserId,
  });

  if (runAgent === null) {
    return;
  }

  const goalTasks = await listGoalTasks(db, goal.id);
  const artifactRows = await db
    .select()
    .from(conversationArtifacts)
    .where(eq(conversationArtifacts.goalId, goal.id))
    .orderBy(asc(conversationArtifacts.createdAt));
  const artifactsByTask = new Map<string, ConversationArtifact[]>();

  for (const artifactRow of artifactRows) {
    if (artifactRow.goalTaskId === null) {
      continue;
    }

    const artifacts = artifactsByTask.get(artifactRow.goalTaskId) ?? [];
    artifacts.push(
      toConversationArtifact(artifactRow, {
        publicApiBaseUrl: input.publicApiBaseUrl,
        publicWebBaseUrl: input.publicWebBaseUrl,
      }),
    );
    artifactsByTask.set(artifactRow.goalTaskId, artifacts);
  }

  const agentGroupsPrompt = buildAgentGroupsPrompt(
    await listActiveAgentGroupContexts(db, {
      agentId: runAgent.agent.id,
      ownerUserId: goal.ownerUserId,
    }),
    { currentConversationId: conversation.id },
  );
  const runId = randomUUID();
  const createdAtIso = input.createdAt.toISOString();
  const taskLines = goalTasks.map((row) => {
    const artifactLines = (artifactsByTask.get(row.id) ?? []).flatMap(formatArtifactPromptLines);

    return [
      `Task #${row.index}: ${row.title}`,
      `   id: ${row.id}`,
      `   assigneeAgentId: ${row.assigneeAgentId}`,
      `   status: ${row.status}`,
      `   dependsOnTaskIndexes: ${(row.dependsOnTaskIndexes ?? []).join(", ") || "none"}`,
      row.blockedReason ? `   blockedReason: ${row.blockedReason}` : undefined,
      row.summary ? `   summary: ${row.summary}` : undefined,
      ...artifactLines,
    ].filter((line): line is string => line !== undefined).join("\n");
  });
  const prompt = [
    "<agenthub_task_checkpoint>",
    `Group: #${conversation.title}`,
    `Goal ID: ${goal.id}`,
    `Goal: ${goal.title}`,
    `Completed task index: ${task.index}`,
    `Completed task ID: ${task.id}`,
    `Completed task status: ${task.status}`,
    task.summary ? `Completed task summary: ${task.summary}` : undefined,
    "Review the completed task and decide how to continue the goal.",
    "Use approve_task for ready downstream tasks, create_task for new follow-up or recovery tasks, cancel_task for obsolete tasks, send_message for visible updates, and complete_goal only when the goal is done.",
    artifactUserFacingLinkInstructions,
    "</agenthub_task_checkpoint>",
    "",
    agentGroupsPrompt,
    "",
    "<task_graph>",
    taskLines.join("\n\n"),
    "</task_graph>",
  ].filter((line): line is string => line !== undefined).join("\n");
  const job: RunQueueJob = {
    conversationId: conversation.id,
    daemonDeviceId: runAgent.daemonDeviceId,
    prompt,
    agentInstructions: [
      buildAgentIdentityInstructions({
        agentDescription: runAgent.agent.description,
        agentName: runAgent.agent.name,
        conversationTitle: conversation.title,
        isOrchestrator: true,
        scenario: "task checkpoint",
      }),
      "You are the Orchestrator reviewing a completed task checkpoint. Continue, repair, or complete the goal using AgentHub MCP tools.",
      "When you send a user-facing summary that mentions artifacts, use the provided userFacingLink Markdown links. Prefer editor links and never leave deliverables as bare filenames.",
    ].join("\n\n"),
    agentHubMcpTools: [...agentHubAllMcpTools],
    agentHubMcpGoals: [toConversationGoal(goal, goalTasks.map((row) => toConversationGoalTask(row)))],
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
    const [lockedTask] = await tx
      .select()
      .from(conversationGoalTasks)
      .where(eq(conversationGoalTasks.id, task.id))
      .limit(1);

    if (
      lockedTask === undefined ||
      lockedTask.checkpointRunId !== null ||
      !isTerminalTaskStatus(lockedTask.status)
    ) {
      return;
    }

    await tx.insert(runs).values({
      id: runId,
      ownerUserId: goal.ownerUserId,
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
      .update(conversationGoalTasks)
      .set({
        checkpointRunId: runId,
        updatedAt: input.createdAt,
      })
      .where(eq(conversationGoalTasks.id, task.id));

    input.dispatchJobs.push(job);
    input.realtimeEvents.push(
      createRealtimeEvent({
        conversationId: conversation.id,
        ownerUserId: goal.ownerUserId,
        run: job.run,
        type: "run.updated",
      }),
      createRealtimeEvent({
        conversationId: conversation.id,
        event: queuedEvent,
        ownerUserId: goal.ownerUserId,
        runId,
        type: "run.event.created",
      }),
      createRealtimeEvent({
        conversationId: conversation.id,
        ownerUserId: goal.ownerUserId,
        taskId: task.id,
        type: "task.updated",
      }),
    );
  });
}

async function createAssignedTaskRunJob(
  db: Db,
  input: {
    agentGroupsPrompt?: string;
    agentHubMcpGoals: AgentHubListGoalsToolResult["goals"];
    assigneeAgentId: string;
    conversation: ConversationRow;
    createdAtIso: string;
    dispatchContent: string;
    goalId: string;
    goalTitle: string;
    ownerUserId: string;
    taskDescription?: string | null;
    taskId: string;
    taskIndex: number;
    taskTitle: string;
  },
): Promise<RunQueueJob | null> {
  const runAgent = await getRunnableAgentForUser(db, {
    agentId: input.assigneeAgentId,
    ownerUserId: input.ownerUserId,
  });

  if (runAgent === null) {
    return null;
  }

  const runId = randomUUID();
  const agentGroupsPrompt = input.agentGroupsPrompt ??
    buildAgentGroupsPrompt(
      await listActiveAgentGroupContexts(db, {
        agentId: runAgent.agent.id,
        ownerUserId: input.ownerUserId,
      }),
      { currentConversationId: input.conversation.id },
    );

  return {
    conversationId: input.conversation.id,
    daemonDeviceId: runAgent.daemonDeviceId,
    prompt: buildAssignedTaskPrompt({
      conversationTitle: input.conversation.title,
      goalId: input.goalId,
      goalTitle: input.goalTitle,
      taskId: input.taskId,
      taskIndex: input.taskIndex,
      taskTitle: input.taskTitle,
      taskDescription: input.taskDescription ?? undefined,
      dispatchMessage: input.dispatchContent,
      agentGroupsPrompt,
    }),
    agentInstructions: buildAssignedTaskInstructions({
      agentName: runAgent.agent.name,
      agentDescription: runAgent.agent.description,
      conversationTitle: input.conversation.title,
    }),
    agentHubMcpTools: [...agentHubNonOrchestratorMcpTools],
    agentHubMcpGoals: input.agentHubMcpGoals,
    workspacePath: runAgent.workspacePath,
    run: {
      id: runId,
      agentId: runAgent.agent.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      status: "queued",
      createdAt: input.createdAtIso,
      updatedAt: input.createdAtIso,
    },
    runtime: runAgent.runtime,
  };
}

async function getToolRunContext(
  db: Db,
  runId: string,
): Promise<{
  conversation: ConversationRow;
  run: { agentId: string; conversationId: string; ownerUserId: string };
} | null> {
  const [run] = await db
    .select({
      agentId: runs.agentId,
      conversationId: runs.conversationId,
      ownerUserId: runs.ownerUserId,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);

  if (run === undefined || run.conversationId === null) {
    return null;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, run.conversationId),
        eq(conversations.ownerUserId, run.ownerUserId),
      ),
    )
    .limit(1);

  return conversation === undefined
    ? null
    : {
        conversation,
        run: {
          ...run,
          conversationId: run.conversationId,
        },
      };
}

export async function appendRunEventToConversationMessage(
  db: Db,
  event: RunEvent,
  options: AppendRunEventOptions = {},
): Promise<AppendRunEventResult> {
  const dispatchJobs: RunQueueJob[] = [];
  const memoryAppendJobs: MemoryAppendQueueJob[] = [];
  const realtimeEvents: RealtimeEvent[] = [];
  let toolResult: AgentHubMcpToolResult | undefined;
  const result = (): AppendRunEventResult => ({
    dispatchJobs,
    memoryAppendJobs,
    realtimeEvents,
    toolResult,
  });

  if (event.type === "run.started" || event.type === "run.completed") {
    const updatedAt = new Date(event.createdAt);
    const updatedTasks = await db
      .update(conversationGoalTasks)
      .set({
        status: event.type === "run.started"
          ? "running"
          : event.status === "succeeded"
            ? sql`case when ${conversationGoalTasks.status} = 'succeeded' then 'succeeded' else 'failed' end`
            : event.status,
        updatedAt,
      })
      .where(eq(conversationGoalTasks.assigneeRunId, event.runId))
      .returning({
        goalId: conversationGoalTasks.goalId,
        id: conversationGoalTasks.id,
      });
    const updatedGoals = updatedTasks.length === 0
      ? []
      : await db
          .select({
            id: conversationGoals.id,
            conversationId: conversationGoals.conversationId,
            ownerUserId: conversationGoals.ownerUserId,
          })
          .from(conversationGoals)
          .where(inArray(conversationGoals.id, updatedTasks.map((task) => task.goalId)));
    const goalsById = new Map(updatedGoals.map((goal) => [goal.id, goal]));
    realtimeEvents.push(
      ...updatedTasks.flatMap((task) => {
        const goal = goalsById.get(task.goalId);

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

    if (event.type === "run.completed") {
      for (const goalId of compactUniqueStrings(
        updatedTasks.map((task) => task.goalId),
      )) {
        await updateDependentTaskReadiness(db, {
          createdAt: updatedAt,
          goalId,
          realtimeEvents,
        });
      }

      for (const task of updatedTasks) {
        await maybeCreateCheckpointRunForTask(db, {
          goalTaskId: task.id,
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
    if (event.name === "list_goals") {
      const context = await getToolRunContext(db, event.runId);

      if (context === null) {
        return result();
      }

      const input = readListGoalsToolInput(event.input);
      const status = input?.status;
      const goals = await listConversationGoalsForUser(db, {
        conversationId: context.conversation.id,
        ownerUserId: context.run.ownerUserId,
        publicApiBaseUrl: options.publicApiBaseUrl,
        publicWebBaseUrl: options.publicWebBaseUrl,
      });

      toolResult = {
        accepted: true,
        goals: (goals ?? []).filter((goal) =>
          status === undefined || goal.status === status
        ),
      };
      return result();
    }

    if (event.name === "list_artifacts") {
      const input = readListArtifactsToolInput(event.input);
      const context = await getToolRunContext(db, event.runId);

      if (input === null || context === null) {
        return result();
      }

      const conditions = [
        eq(conversationArtifacts.ownerUserId, context.run.ownerUserId),
        eq(conversationArtifacts.conversationId, context.conversation.id),
      ];

      if (input.goalId !== undefined) {
        conditions.push(eq(conversationArtifacts.goalId, input.goalId));
      }

      if (input.taskIndex !== undefined) {
        conditions.push(eq(conversationArtifacts.taskIndex, input.taskIndex));
      }

      const artifactRows = await db
        .select()
        .from(conversationArtifacts)
        .where(and(...conditions))
        .orderBy(desc(conversationArtifacts.createdAt))
        .limit(input.limit ?? 20);

      toolResult = {
        accepted: true,
        artifacts: artifactRows.map((artifact) =>
          toConversationArtifact(artifact, {
            publicApiBaseUrl: options.publicApiBaseUrl,
            publicWebBaseUrl: options.publicWebBaseUrl,
          })
        ),
      };
      return result();
    }

    if (event.name === "read_artifact") {
      const input = readReadArtifactToolInput(event.input);
      const context = await getToolRunContext(db, event.runId);

      if (
        input === null ||
        context === null ||
        options.storageRoot === undefined
      ) {
        return result();
      }

      const [artifactRow] = await db
        .select()
        .from(conversationArtifacts)
        .where(
          and(
            eq(conversationArtifacts.id, input.artifactId),
            eq(conversationArtifacts.ownerUserId, context.run.ownerUserId),
            eq(conversationArtifacts.conversationId, context.conversation.id),
            ...(input.goalId === undefined
              ? []
              : [eq(conversationArtifacts.goalId, input.goalId)]),
          ),
        )
        .limit(1);

      if (artifactRow === undefined) {
        return result();
      }

      const content = await readArtifactContent({
        storageKey: artifactRow.storageKey,
        storageRoot: options.storageRoot,
      });
      const maxBytes = 256 * 1024;
      const sliced = content.subarray(0, maxBytes);
      const looksText = /^text\/|json|markdown|xml|javascript|typescript|css|html/.test(
        inferArtifactFileInfo({ filename: artifactRow.filename }).mimeType,
      );

      toolResult = {
        accepted: true,
        artifact: toConversationArtifact(artifactRow, {
          publicApiBaseUrl: options.publicApiBaseUrl,
          publicWebBaseUrl: options.publicWebBaseUrl,
        }),
        ...(looksText
          ? { contentText: sliced.toString("utf8"), encoding: "text" as const }
          : { contentBase64: sliced.toString("base64"), encoding: "base64" as const }),
        truncated: content.byteLength > maxBytes ? true : undefined,
      };
      return result();
    }

    if (event.name === "create_goal") {
      const input = readCreateGoalToolInput(event.input);
      const context = await getToolRunContext(db, event.runId);
      const createdAt = new Date(event.createdAt);

      if (
        input === null ||
        context === null ||
        context.conversation.type !== "group" ||
        context.conversation.orchestratorAgentId !== context.run.agentId
      ) {
        return result();
      }

      const [goal] = await db
        .insert(conversationGoals)
        .values({
          id: randomUUID(),
          ownerUserId: context.run.ownerUserId,
          conversationId: context.conversation.id,
          orchestratorAgentId: context.run.agentId,
          initialRunId: event.runId,
          title: input.title,
          description: input.description,
          status: "active",
          createdAt,
          updatedAt: createdAt,
        })
        .returning();

      if (goal === undefined) {
        return result();
      }

      realtimeEvents.push(
        createRealtimeEvent({
          conversationId: context.conversation.id,
          ownerUserId: context.run.ownerUserId,
          taskId: goal.id,
          type: "task.updated",
        }),
      );
      toolResult = {
        accepted: true,
        goal: toConversationGoal(goal, [], {
          publicWebBaseUrl: options.publicWebBaseUrl,
        }),
      };
      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Goal created",
          tags: ["goal", "task"],
          dedupeKey: `goal-created:${goal.id}`,
          content: [
            `Created goal: ${goal.title} (${goal.id})`,
            goal.description === null ? undefined : `Description: ${goal.description}`,
            `Conversation: ${context.conversation.title} (${context.conversation.id})`,
          ].filter((line): line is string => line !== undefined).join("\n"),
        }),
      );
      return result();
    }

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

      const [goal] = await db
        .select()
        .from(conversationGoals)
        .where(
          and(
            eq(conversationGoals.id, input.goalId),
            eq(conversationGoals.conversationId, conversation.id),
            eq(conversationGoals.ownerUserId, run.ownerUserId),
            eq(conversationGoals.orchestratorAgentId, run.agentId),
            eq(conversationGoals.status, "active"),
          ),
        )
        .limit(1);

      if (goal === undefined) {
        return result();
      }

      const createdAt = new Date(event.createdAt);
      const taskId = randomUUID();
      const existingTaskRows = await listGoalTasks(db, goal.id);
      const taskIndex =
        existingTaskRows.reduce((max, task) => Math.max(max, task.index), -1) + 1;
      const dependencyState = dependencyStatusForTask(input, existingTaskRows);
      let taskStatus = dependencyState.status;
      let blockedReason = dependencyState.blockedReason;
      const goalHref = buildGoalWebHref({
        conversationId: conversation.id,
        goalId: goal.id,
        publicWebBaseUrl: options.publicWebBaseUrl,
      });
      const taskHref = buildGoalTaskWebHref({
        conversationId: conversation.id,
        goalId: goal.id,
        publicWebBaseUrl: options.publicWebBaseUrl,
        taskIndex,
      });
      const dispatchContent = `@${assignee.name} 已创建任务：${input.title}\nGoal ID: [${goal.id}](${goalHref})\n[Task #${taskIndex}](${taskHref})`;
      const shouldDispatch = taskStatus === "assigned";
      const job = shouldDispatch && !isSelfAssigned
        ? await createAssignedTaskRunJob(db, {
            assigneeAgentId,
            agentHubMcpGoals: [toConversationGoal(goal, existingTaskRows.map((row) => toConversationGoalTask(row)))],
            conversation,
            createdAtIso: event.createdAt,
            dispatchContent,
            goalId: goal.id,
            goalTitle: goal.title,
            ownerUserId: run.ownerUserId,
            taskDescription: input.description,
            taskId,
            taskIndex,
            taskTitle: input.title,
          })
        : null;

      if (shouldDispatch && !isSelfAssigned && job === null) {
        taskStatus = "failed";
        blockedReason = "Assignee agent is not ready.";
      }

      const assigneeRunId = isSelfAssigned
        ? event.runId
        : job?.run.id;
      const queuedEvent: RunEvent | null = job === null
        ? null
        : {
            type: "run.queued",
            runId: job.run.id,
            agentId: job.run.agentId,
            daemonDeviceId: job.daemonDeviceId,
            createdAt: event.createdAt,
          };
      toolResult = {
        accepted: true,
        task: toConversationGoalTask({
          id: taskId,
          goalId: goal.id,
          index: taskIndex,
          assigneeAgentId,
          assigneeRunId: assigneeRunId ?? null,
          dispatchMessageId: null,
          dependsOnTaskIndexes: input.dependsOnTaskIndexes ?? [],
          title: input.title,
          description: input.description ?? null,
          status: taskStatus,
          blockedReason: blockedReason ?? null,
          summary: null,
          resultArtifactIds: null,
          completedAt: null,
          checkpointRunId: null,
          createdAt,
          updatedAt: createdAt,
        }, [], {
          conversationId: conversation.id,
          publicWebBaseUrl: options.publicWebBaseUrl,
        }),
      };

      await db.transaction(async (tx) => {
        const [message] = shouldDispatch
          ? await tx.insert(conversationMessages).values({
              conversationId: conversation.id,
              senderType: "agent",
              senderAgentId: run.agentId,
              runId: event.runId,
              content: dispatchContent,
              status: "completed",
              createdAt,
              updatedAt: createdAt,
            }).returning()
          : [undefined];

        const [createdTask] = await tx
          .insert(conversationGoalTasks)
          .values({
            id: taskId,
            goalId: goal.id,
            index: taskIndex,
            assigneeAgentId,
            assigneeRunId,
            dispatchMessageId: message?.id,
            dependsOnTaskIndexes: input.dependsOnTaskIndexes ?? [],
            title: input.title,
            description: input.description,
            status: taskStatus,
            blockedReason,
            createdAt,
            updatedAt: createdAt,
          })
          .onConflictDoNothing()
          .returning({ id: conversationGoalTasks.id });

        if (createdTask === undefined) {
          return;
        }

        if (job !== null && queuedEvent !== null) {
          await tx.insert(runs).values({
            id: job.run.id,
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
            runId: job.run.id,
            eventType: queuedEvent.type,
            payload: queuedEvent,
            createdAt,
          });
        }

        await tx
          .update(conversations)
          .set({
            ...(message === undefined ? {} : { lastMessageAt: createdAt }),
            updatedAt: createdAt,
          })
          .where(eq(conversations.id, conversation.id));

        realtimeEvents.push(
          ...(message === undefined
            ? []
            : [
                createRealtimeEvent({
                  conversationId: conversation.id,
                  message: toConversationMessage(message),
                  ownerUserId: run.ownerUserId,
                  type: "conversation.message.created" as const,
                }),
              ]),
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
              runId: job.run.id,
              type: "run.event.created",
            }),
          );
        }
      });

      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Task created",
          tags: ["goal", "task", shouldDispatch ? "dispatch" : taskStatus],
          dedupeKey: `task-created:${taskId}`,
          content: [
            `Created task: ${input.title}`,
            `Goal: ${goal.title} (${goal.id})`,
            `Task index: ${taskIndex}`,
            `Assignee: ${assignee.name} (${assigneeAgentId})`,
            `Status: ${taskStatus}`,
            blockedReason === undefined ? undefined : `Blocked reason: ${blockedReason}`,
            (input.dependsOnTaskIndexes ?? []).length === 0
              ? "Dependencies: none"
              : `Dependencies: ${(input.dependsOnTaskIndexes ?? []).join(", ")}`,
          ].filter((line): line is string => line !== undefined).join("\n"),
        }),
      );

      return result();
    }

    if (event.name === "approve_task") {
      const input = readApproveTaskToolInput(event.input);
      const context = await getToolRunContext(db, event.runId);
      const updatedAt = new Date(event.createdAt);

      if (input === null || context === null) {
        return result();
      }

      const [goal] = await db
        .select()
        .from(conversationGoals)
        .where(
          and(
            eq(conversationGoals.id, input.goalId),
            eq(conversationGoals.conversationId, context.conversation.id),
            eq(conversationGoals.ownerUserId, context.run.ownerUserId),
            eq(conversationGoals.orchestratorAgentId, context.run.agentId),
            eq(conversationGoals.status, "active"),
          ),
        )
        .limit(1);

      if (goal === undefined) {
        return result();
      }

      const [task] = await db
        .select()
        .from(conversationGoalTasks)
        .where(
          and(
            eq(conversationGoalTasks.goalId, goal.id),
            eq(conversationGoalTasks.index, input.taskIndex),
            eq(conversationGoalTasks.status, "ready"),
          ),
        )
        .limit(1);

      if (task === undefined) {
        return result();
      }

      const [assignee] = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, task.assigneeAgentId))
        .limit(1);
      const goalHref = buildGoalWebHref({
        conversationId: context.conversation.id,
        goalId: goal.id,
        publicWebBaseUrl: options.publicWebBaseUrl,
      });
      const taskHref = buildGoalTaskWebHref({
        conversationId: context.conversation.id,
        goalId: goal.id,
        publicWebBaseUrl: options.publicWebBaseUrl,
        taskIndex: task.index,
      });
      const dispatchContent = `@${assignee?.name ?? task.assigneeAgentId} 已批准任务：${task.title}\nGoal ID: [${goal.id}](${goalHref})\n[Task #${task.index}](${taskHref})`;
      const goalTasks = await listGoalTasks(db, goal.id);
      const job = await createAssignedTaskRunJob(db, {
        assigneeAgentId: task.assigneeAgentId,
        agentHubMcpGoals: [toConversationGoal(goal, goalTasks.map((row) => toConversationGoalTask(row)))],
        conversation: context.conversation,
        createdAtIso: event.createdAt,
        dispatchContent,
        goalId: goal.id,
        goalTitle: goal.title,
        ownerUserId: context.run.ownerUserId,
        taskDescription: task.description,
        taskId: task.id,
        taskIndex: task.index,
        taskTitle: task.title,
      });

      if (job === null) {
        await db
          .update(conversationGoalTasks)
          .set({
            status: "blocked",
            blockedReason: "Assignee agent is not ready.",
            updatedAt,
          })
          .where(eq(conversationGoalTasks.id, task.id));
        realtimeEvents.push(
          createRealtimeEvent({
            conversationId: goal.conversationId,
            ownerUserId: goal.ownerUserId,
            taskId: task.id,
            type: "task.updated",
          }),
        );
        memoryAppendJobs.push(
          ...await createRunDailyMemoryJob(db, {
            runId: event.runId,
            createdAt: event.createdAt,
            title: "Task approval blocked",
            tags: ["goal", "task", "approve", "blocked"],
            dedupeKey: `task-approve-blocked:${task.id}:${event.runId}`,
            content: [
              `Could not approve task because the assignee is not ready.`,
              `Goal: ${goal.title} (${goal.id})`,
              `Task: #${task.index} ${task.title}`,
              `Assignee: ${task.assigneeAgentId}`,
            ].join("\n"),
          }),
        );
        toolResult = { accepted: true, goalId: goal.id, taskIndex: task.index };
        return result();
      }

      const queuedEvent: RunEvent = {
        type: "run.queued",
        runId: job.run.id,
        agentId: job.run.agentId,
        daemonDeviceId: job.daemonDeviceId,
        createdAt: event.createdAt,
      };
      let createdMessage: ConversationMessage | undefined;

      await db.transaction(async (tx) => {
        const [message] = await tx.insert(conversationMessages).values({
          conversationId: context.conversation.id,
          senderType: "agent",
          senderAgentId: context.run.agentId,
          runId: event.runId,
          content: dispatchContent,
          status: "completed",
          createdAt: updatedAt,
          updatedAt,
        }).returning();
        createdMessage = toConversationMessage(message);

        await tx.insert(runs).values({
          id: job.run.id,
          ownerUserId: context.run.ownerUserId,
          conversationId: context.conversation.id,
          agentId: job.run.agentId,
          daemonDeviceId: job.daemonDeviceId,
          status: "queued",
          prompt: job.prompt,
          workspacePath: job.workspacePath,
          runtime: job.runtime,
          createdAt: updatedAt,
          updatedAt,
        });

        await tx.insert(runEvents).values({
          runId: job.run.id,
          eventType: queuedEvent.type,
          payload: queuedEvent,
          createdAt: updatedAt,
        });

        await tx
          .update(conversationGoalTasks)
          .set({
            assigneeRunId: job.run.id,
            dispatchMessageId: message.id,
            status: "assigned",
            blockedReason: null,
            updatedAt,
          })
          .where(eq(conversationGoalTasks.id, task.id));

        await tx
          .update(conversations)
          .set({ lastMessageAt: updatedAt, updatedAt })
          .where(eq(conversations.id, context.conversation.id));
      });

      dispatchJobs.push(job);
      realtimeEvents.push(
        ...(createdMessage === undefined
          ? []
          : [
              createRealtimeEvent({
                conversationId: context.conversation.id,
                message: createdMessage,
                ownerUserId: context.run.ownerUserId,
                type: "conversation.message.created" as const,
              }),
            ]),
        createRealtimeEvent({
          conversationId: context.conversation.id,
          ownerUserId: context.run.ownerUserId,
          type: "conversation.updated",
        }),
        createRealtimeEvent({
          conversationId: context.conversation.id,
          ownerUserId: context.run.ownerUserId,
          taskId: task.id,
          type: "task.updated",
        }),
        createRealtimeEvent({
          conversationId: context.conversation.id,
          ownerUserId: context.run.ownerUserId,
          run: job.run,
          type: "run.updated",
        }),
        createRealtimeEvent({
          conversationId: context.conversation.id,
          event: queuedEvent,
          ownerUserId: context.run.ownerUserId,
          runId: job.run.id,
          type: "run.event.created",
        }),
      );
      toolResult = { accepted: true, goalId: goal.id, taskIndex: task.index, runId: job.run.id };
      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Task approved",
          tags: ["goal", "task", "approve", "dispatch"],
          dedupeKey: `task-approved:${task.id}:${job.run.id}`,
          content: [
            `Approved task for dispatch.`,
            `Goal: ${goal.title} (${goal.id})`,
            `Task: #${task.index} ${task.title}`,
            `Assignee: ${assignee?.name ?? task.assigneeAgentId} (${task.assigneeAgentId})`,
            `Run: ${job.run.id}`,
          ].join("\n"),
        }),
      );
      return result();
    }

    if (event.name === "cancel_task") {
      const input = readCancelTaskToolInput(event.input);
      const context = await getToolRunContext(db, event.runId);
      const updatedAt = new Date(event.createdAt);

      if (input === null || context === null) {
        return result();
      }

      const [goal] = await db
        .select()
        .from(conversationGoals)
        .where(
          and(
            eq(conversationGoals.id, input.goalId),
            eq(conversationGoals.conversationId, context.conversation.id),
            eq(conversationGoals.ownerUserId, context.run.ownerUserId),
            eq(conversationGoals.orchestratorAgentId, context.run.agentId),
            eq(conversationGoals.status, "active"),
          ),
        )
        .limit(1);

      if (goal === undefined) {
        return result();
      }

      const [task] = await db
        .update(conversationGoalTasks)
        .set({
          status: "cancelled",
          blockedReason: input.reason ?? null,
          updatedAt,
        })
        .where(
          and(
            eq(conversationGoalTasks.goalId, goal.id),
            eq(conversationGoalTasks.index, input.taskIndex),
          ),
        )
        .returning();

      if (task === undefined) {
        return result();
      }

      realtimeEvents.push(
        createRealtimeEvent({
          conversationId: goal.conversationId,
          ownerUserId: goal.ownerUserId,
          taskId: task.id,
          type: "task.updated",
        }),
      );
      await updateDependentTaskReadiness(db, {
        createdAt: updatedAt,
        goalId: goal.id,
        realtimeEvents,
      });
      toolResult = { accepted: true, goalId: goal.id, taskIndex: task.index };
      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Task cancelled",
          tags: ["goal", "task", "cancel"],
          dedupeKey: `task-cancelled:${task.id}:${event.runId}`,
          content: [
            `Cancelled task.`,
            `Goal: ${goal.title} (${goal.id})`,
            `Task: #${task.index} ${task.title}`,
            input.reason === undefined ? undefined : `Reason: ${input.reason}`,
          ].filter((line): line is string => line !== undefined).join("\n"),
        }),
      );
      return result();
    }

    if (event.name === "complete_goal") {
      const input = readCompleteGoalToolInput(event.input);
      const context = await getToolRunContext(db, event.runId);
      const updatedAt = new Date(event.createdAt);

      if (input === null || context === null) {
        return result();
      }

      const [goal] = await db
        .select()
        .from(conversationGoals)
        .where(
          and(
            eq(conversationGoals.id, input.goalId),
            eq(conversationGoals.conversationId, context.conversation.id),
            eq(conversationGoals.ownerUserId, context.run.ownerUserId),
            eq(conversationGoals.orchestratorAgentId, context.run.agentId),
            eq(conversationGoals.status, "active"),
          ),
        )
        .limit(1);

      if (goal === undefined) {
        return result();
      }

      const goalTasks = await listGoalTasks(db, goal.id);

      if (goalTasks.some((task) => isActiveTaskStatus(task.status))) {
        return result();
      }

      const [updatedGoal] = await db
        .update(conversationGoals)
        .set({
          status: "completed",
          summary: input.summary ?? null,
          completedAt: updatedAt,
          updatedAt,
        })
        .where(eq(conversationGoals.id, goal.id))
        .returning();

      if (updatedGoal === undefined) {
        return result();
      }

      toolResult = {
        accepted: true,
        goal: toConversationGoal(
          updatedGoal,
          goalTasks.map((task) =>
            toConversationGoalTask(task, [], {
              conversationId: updatedGoal.conversationId,
              publicWebBaseUrl: options.publicWebBaseUrl,
            })
          ),
          { publicWebBaseUrl: options.publicWebBaseUrl },
        ),
      };
      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Goal completed",
          tags: ["goal", "complete"],
          dedupeKey: `goal-completed:${goal.id}:${event.runId}`,
          content: [
            `Completed goal: ${updatedGoal.title} (${updatedGoal.id})`,
            input.summary === undefined ? undefined : `Summary: ${input.summary}`,
            `Tasks: ${goalTasks.length}`,
          ].filter((line): line is string => line !== undefined).join("\n"),
        }),
      );
      return result();
    }

    if (event.name === "upload_artifact") {
      const input = readUploadArtifactToolInput(event.input);

      if (input === null) {
        return result();
      }

      toolResult = { accepted: true, artifact: {} as ConversationArtifact };
      return result();
    }

    if (event.name === "deploy_static_site") {
      const input = readDeployStaticSiteToolInput(event.input);

      if (input === null) {
        return result();
      }

      toolResult = {
        accepted: true,
        deployment: {} as ConversationDeployment,
      };
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
        .from(conversationGoalTasks)
        .innerJoin(conversationGoals, eq(conversationGoalTasks.goalId, conversationGoals.id))
        .where(
          and(
            eq(conversationGoals.id, input.goalId),
            eq(conversationGoals.conversationId, run.conversationId),
            eq(conversationGoalTasks.index, input.taskIndex),
            eq(conversationGoalTasks.assigneeRunId, event.runId),
            eq(conversationGoalTasks.assigneeAgentId, run.agentId),
          ),
        )
        .limit(1);

      if (task === undefined) {
        return result();
      }
      const goal = task.conversation_goals;
      const goalTask = task.conversation_goal_tasks;

      const artifactIds = input.artifactIds ?? [];

      if (artifactIds.length > 0) {
        const artifactRows = await db
          .select({ id: conversationArtifacts.id })
          .from(conversationArtifacts)
          .where(
            and(
              eq(conversationArtifacts.conversationId, run.conversationId),
              eq(conversationArtifacts.goalId, goal.id),
              eq(conversationArtifacts.goalTaskId, goalTask.id),
              eq(conversationArtifacts.runId, event.runId),
              inArray(conversationArtifacts.id, artifactIds),
            ),
          );

        if (artifactRows.length !== artifactIds.length) {
          return result();
        }
      }

      await db
        .update(conversationGoalTasks)
        .set({
          status: "succeeded",
          summary: input.summary,
          resultArtifactIds: artifactIds,
          completedAt: updatedAt,
          updatedAt,
        })
        .where(eq(conversationGoalTasks.id, goalTask.id));
      realtimeEvents.push(
        createRealtimeEvent({
          conversationId: run.conversationId,
          ownerUserId: run.ownerUserId,
          taskId: goalTask.id,
          type: "task.updated",
        }),
      );

      await updateDependentTaskReadiness(db, {
        createdAt: updatedAt,
        goalId: goal.id,
        realtimeEvents,
      });

      await maybeCreateCheckpointRunForTask(db, {
        goalTaskId: goalTask.id,
        createdAt: updatedAt,
        dispatchJobs,
        publicApiBaseUrl: options.publicApiBaseUrl,
        publicWebBaseUrl: options.publicWebBaseUrl,
        realtimeEvents,
      });
      toolResult = { accepted: true };
      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Task completed",
          tags: ["goal", "task", "complete"],
          dedupeKey: `task-completed:${goalTask.id}:${event.runId}`,
          content: [
            `Completed assigned task.`,
            `Goal: ${goal.title} (${goal.id})`,
            `Task: #${goalTask.index} ${goalTask.title}`,
            `Summary: ${input.summary}`,
            artifactIds.length === 0
              ? "Artifacts: none"
              : `Artifacts: ${artifactIds.join(", ")}`,
          ].join("\n"),
        }),
      );

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
    memoryAppendJobs.push(...persisted.memoryAppendJobs);
    if (input.target !== undefined && input.target.type !== "current") {
      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Cross-conversation message sent",
          tags: ["message", "cross-conversation"],
          dedupeKey: `cross-message:${persisted.message.id}`,
          content: [
            `Sent a visible message to ${describeSendMessageTarget(input.target)}.`,
            `Target conversation: ${persisted.message.conversationId}`,
            `Message: ${persisted.message.id}`,
            "",
            input.content,
          ].join("\n"),
        }),
      );
    }
    if (persisted.dispatchJobs.length > 0) {
      memoryAppendJobs.push(
        ...await createRunDailyMemoryJob(db, {
          runId: event.runId,
          createdAt: event.createdAt,
          title: "Agent mention fan-out",
          tags: ["message", "mention", "fanout"],
          dedupeKey: `mention-fanout:${persisted.message.id}`,
          content: [
            `A visible message triggered ${persisted.dispatchJobs.length} agent run(s).`,
            `Conversation: ${persisted.message.conversationId}`,
            `Message: ${persisted.message.id}`,
            `Runs: ${persisted.dispatchJobs.map((job) => job.run.id).join(", ")}`,
            "",
            input.content,
          ].join("\n"),
        }),
      );
    }
    realtimeEvents.push(...persisted.realtimeEvents);
    toolResult = {
      accepted: true,
      conversationId: persisted.message.conversationId,
      messageId: persisted.message.id,
    };
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
    .select()
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
    const conversationMessage = toConversationMessage(message);
    if (event.type === "run.completed") {
      memoryAppendJobs.push(
        ...await createConversationTranscriptMemoryJobs(db, {
          conversation,
          message: conversationMessage,
        }),
      );
    }
    realtimeEvents.push(
      createRealtimeEvent({
        conversationId: message.conversationId,
        ownerUserId: conversation.ownerUserId,
        type: "conversation.updated",
      }),
      createRealtimeEvent({
        conversationId: message.conversationId,
        message: conversationMessage,
        ownerUserId: conversation.ownerUserId,
        type: "conversation.message.created",
      }),
    );
  }

  return result();
}
