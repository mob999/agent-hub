import type {
  Conversation,
  ConversationArtifact,
  ConversationArtifactAction,
  ConversationArtifactFile,
  ConversationArtifactFileRevision,
  ConversationArtifactRevision,
  ConversationDeployment,
  ConversationGoal,
  ConversationGoalTask,
  ConversationId,
  ConversationMessage,
  ConversationMessageAttachment,
  ConversationMessageCard,
  ConversationProject,
  ConversationProjectChange,
} from "@agent-hub/core";
import {
  conversationArtifactActions,
  conversationArtifactFiles,
  conversationArtifactFileRevisions,
  conversationArtifactRevisions,
  conversationArtifacts,
  conversationDeployments,
  conversationGoalTasks,
  conversationGoals,
  conversationMessageArtifacts,
  conversationMessages,
  conversationProjectChanges,
  conversationProjects,
  conversations,
} from "@agent-hub/db";

import {
  buildArtifactDownloadUrl,
  buildArtifactEditorUrl,
  buildDeploymentUrl,
} from "../artifacts/index.js";

export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type ConversationGoalRow = typeof conversationGoals.$inferSelect;
export type ConversationGoalTaskRow = typeof conversationGoalTasks.$inferSelect;
export type ConversationArtifactRow = typeof conversationArtifacts.$inferSelect;
export type ConversationArtifactFileRow =
  typeof conversationArtifactFiles.$inferSelect;
export type ConversationArtifactFileRevisionRow =
  typeof conversationArtifactFileRevisions.$inferSelect;
export type ConversationMessageArtifactRow =
  typeof conversationMessageArtifacts.$inferSelect;
export type ConversationArtifactRevisionRow =
  typeof conversationArtifactRevisions.$inferSelect;
export type ConversationArtifactActionRow =
  typeof conversationArtifactActions.$inferSelect;
export type ConversationDeploymentRow =
  typeof conversationDeployments.$inferSelect;
export type ConversationProjectRow = typeof conversationProjects.$inferSelect;
export type ConversationProjectChangeRow =
  typeof conversationProjectChanges.$inferSelect;

export function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

function isMessageCard(value: unknown): value is ConversationMessageCard {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const card = value as Record<string, unknown>;
  if (
    card.type === "goal.created" &&
    typeof card.goalId === "string" &&
    typeof card.title === "string"
  ) {
    return card.preview === undefined || typeof card.preview === "string";
  }

  if (
    card.type === "task.assigned" &&
    typeof card.assigneeAgentId === "string" &&
    typeof card.goalId === "string" &&
    typeof card.taskIndex === "number" &&
    typeof card.title === "string"
  ) {
    return (card.preview === undefined || typeof card.preview === "string") &&
      (card.runId === undefined || typeof card.runId === "string");
  }

  return false;
}

function optionalMessageCards(value: unknown[] | null): ConversationMessageCard[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const cards = value.filter(isMessageCard);
  return cards.length > 0 ? cards : undefined;
}

export function toConversation(
  row: ConversationRow,
  agentIds?: string[],
  project?: ConversationProject,
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
    project,
  };
}

export function toConversationProject(
  row: ConversationProjectRow,
): ConversationProject {
  return {
    conversationId: row.conversationId,
    ownerUserId: row.ownerUserId,
    remoteUrl: row.remoteUrl,
    daemonDeviceId: row.daemonDeviceId,
    baseRepoPath: optionalString(row.baseRepoPath),
    defaultBranch: optionalString(row.defaultBranch),
    baseHead: optionalString(row.baseHead),
    cloneStatus: row.cloneStatus as ConversationProject["cloneStatus"],
    cloneError: optionalString(row.cloneError),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationProjectChange(
  row: ConversationProjectChangeRow,
): ConversationProjectChange {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    goalId: optionalString(row.goalId),
    taskIndex: row.taskIndex ?? undefined,
    agentId: row.agentId,
    runId: row.runId,
    branchName: row.branchName,
    worktreePath: row.worktreePath,
    baseCommit: optionalString(row.baseCommit),
    headCommit: optionalString(row.headCommit),
    status: row.status as ConversationProjectChange["status"],
    summary: optionalString(row.summary),
    diffStat: optionalString(row.diffStat),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    mergedAt: row.mergedAt?.toISOString(),
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
    cards: optionalMessageCards(row.cards),
    attachments: attachments.length > 0 ? attachments : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationArtifact(
  row: ConversationArtifactRow,
  input: { publicApiBaseUrl?: string; publicWebBaseUrl?: string } = {},
): ConversationArtifact {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    kind: row.kind as ConversationArtifact["kind"],
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
    entrypoint: optionalString(row.entrypoint),
    fileCount: row.fileCount ?? undefined,
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

export function toConversationMessageAttachment(
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

export function toConversationArtifactFile(
  row: ConversationArtifactFileRow,
): ConversationArtifactFile {
  return {
    id: row.id,
    artifactId: row.artifactId,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    path: row.path,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    latestRevisionId: optionalString(row.latestRevisionId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversationArtifactFileRevision(
  row: ConversationArtifactFileRevisionRow,
): ConversationArtifactFileRevision {
  return {
    id: row.id,
    artifactFileId: row.artifactFileId,
    artifactId: row.artifactId,
    ownerUserId: row.ownerUserId,
    conversationId: row.conversationId,
    path: row.path,
    editorUserId: optionalString(row.editorUserId),
    contentHash: row.contentHash,
    summary: optionalString(row.summary),
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
    cardMessageId: optionalString(row.cardMessageId),
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

export function buildGoalWebHref(input: {
  conversationId: string;
  goalId: string;
  publicWebBaseUrl?: string;
}): string {
  const path = `/chat/${input.conversationId}/goals/${input.goalId}`;

  return input.publicWebBaseUrl === undefined
    ? path
    : new URL(path, input.publicWebBaseUrl).toString();
}

export function buildGoalTaskWebHref(input: {
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
    sourceArtifactId: optionalString(row.sourceArtifactId),
    sourceRevisionId: optionalString(row.sourceRevisionId),
    publishedByUserId: optionalString(row.publishedByUserId),
    publishedFrom: row.publishedFrom as ConversationDeployment["publishedFrom"],
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
