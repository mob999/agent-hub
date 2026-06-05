import { createHash, randomUUID } from "node:crypto";

import type {
  AgentHubCreateTaskToolInput,
  AgentHubMcpToolResult,
  AgentHubListGoalsToolResult,
  Conversation,
  ConversationArtifact,
  ConversationArtifactAction,
  ConversationArtifactActionType,
  ConversationId,
  ConversationMessage,
  ConversationMessageAttachment,
  ConversationProject,
  ConversationProjectChange,
  ConversationArtifactDetails,
  ConversationArtifactFile,
  ConversationArtifactFileRevision,
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
  conversationArtifactFiles,
  conversationArtifactFileRevisions,
  conversationArtifacts,
  conversationArtifactRevisions,
  conversationDeployments,
  conversationMessageArtifacts,
  conversationMessages,
  conversationGoals,
  conversationGoalTasks,
  conversationProjectChanges,
  conversationProjects,
  conversations,
  runEvents,
  runs,
  type Db,
} from "@agent-hub/db";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { getRunnableAgentForUser } from "../agents/repository.js";
import {
  createStoredZip,
  conversationArtifactSiteFileRevisionStorageKey,
  conversationArtifactSiteFileStorageKey,
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
import {
  applyRunDispatchPreparation,
  prepareRunDispatch,
  type RunDispatchTaskContext,
} from "../runs/dispatch.js";
import { listActiveAgentGroupContexts } from "./agent-groups.js";
import { getDownloadableArtifactContentForRun } from "./artifact-repository.js";
import {
  listConversationGoalsForUser,
  listConversationMessagesForUser,
} from "./conversation-records.js";
import {
  compactUniqueNumbers,
  compactUniqueStrings,
  getConversationAgentIdsForRow,
} from "./helpers.js";
import {
  buildGoalTaskWebHref,
  buildGoalWebHref,
  optionalString,
  toConversation,
  toConversationArtifact,
  toConversationArtifactAction,
  toConversationArtifactFile,
  toConversationArtifactFileRevision,
  toConversationArtifactRevision,
  toConversationDeployment,
  toConversationGoal,
  toConversationGoalTask,
  toConversationMessage,
  toConversationMessageAttachment,
  toConversationProject,
  toConversationProjectChange,
  type ConversationArtifactRow,
  type ConversationGoalRow,
  type ConversationGoalTaskRow,
  type ConversationMessageRow,
  type ConversationRow,
} from "./mappers.js";
import {
  artifactUserFacingLinkInstructions,
  buildAgentGroupsPrompt,
  buildAgentIdentityInstructions,
  buildAssignedTaskInstructions,
  buildAssignedTaskPrompt,
  buildConversationRunPrompt,
  buildProjectProtocolPrompt,
  conversationPromptRole,
  formatArtifactPromptLines,
  orchestratorParallelSerialTaskInstructions,
} from "./prompts.js";
import {
  getProjectChangeForConversation,
  getProjectChangeWithDiffForConversation,
  getProjectForConversation,
  listProjectChangesForConversation,
  updateProjectChangeStatus,
} from "./project-repository.js";
import { applyProjectRunWorkspace } from "./project-run-workspace.js";
import {
  describeSendMessageTarget,
  getSendMessageTargetConversation,
  isConversationAgentMember,
  listConversationAgentRefs,
  persistVisibleAgentMessageAndDispatchMentions,
  sendMessageAttachmentArtifactIds,
} from "./message-dispatch.js";
import type {
  ActiveRunContext,
  AppendRunEventOptions,
  AppendRunEventResult,
  ArchiveGroupConversationResult,
  ConversationStatusFilter,
  CreateConversationArtifactActionInput,
  CreateConversationArtifactFileRevisionInput,
  CreateConversationArtifactRevisionInput,
  CreateGroupConversationResult,
  CreateProjectConversationResult,
  DeleteArchivedGroupConversationResult,
  PersistConversationArtifactUploadInput,
  PersistStaticSiteDeploymentInput,
  ProjectChangeMergeRequest,
  RestoreGroupConversationResult,
  UpdateConversationOrchestratorResult,
  UpdateGroupConversationResult,
  UpdateProjectCloneResult,
  UpdateProjectConversationResult,
  UserMessageAttachmentUpload,
} from "./types.js";
import {
  readApproveTaskToolInput,
  readCancelTaskToolInput,
  readCompleteGoalToolInput,
  readCompleteTaskToolInput,
  readCreateGoalToolInput,
  readCreateTaskToolInput,
  readDeployStaticSiteToolInput,
  readDownloadArtifactToolInput,
  readListArtifactsToolInput,
  readListGoalsToolInput,
  readListGroupMessagesToolInput,
  readListProjectChangesToolInput,
  readMergeProjectChangeToolInput,
  readReadArtifactToolInput,
  readReadProjectChangeToolInput,
  readRejectProjectChangeToolInput,
  readSearchGroupMessagesToolInput,
  readSendMessageToolInput,
  readUploadArtifactToolInput,
} from "./tool-inputs.js";

async function prepareConversationRunJobDispatch(
  db: Db,
  job: RunQueueJob,
  input: {
    conversationId: string;
    createdAt: Date;
    handoffActiveTaskRuns?: boolean;
    ownerUserId: string;
    realtimeEvents?: RealtimeEvent[];
  },
): Promise<{
  handedOffTaskContexts: RunDispatchTaskContext[];
  job: RunQueueJob;
}> {
  const preparation = await prepareRunDispatch(db, {
    agentId: job.run.agentId,
    conversationId: input.conversationId,
    createdAt: input.createdAt,
    daemonDeviceId: job.daemonDeviceId,
    handoffActiveTaskRuns: input.handoffActiveTaskRuns,
    newRunId: job.run.id,
    ownerUserId: input.ownerUserId,
  });

  input.realtimeEvents?.push(...preparation.realtimeEvents);

  const preparedJob = applyRunDispatchPreparation(job, preparation);

  return {
    handedOffTaskContexts: preparation.handedOffTaskContexts,
    job: await applyProjectRunWorkspace(db, {
      conversationId: input.conversationId,
      job: preparedJob,
    }),
  };
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        kind: "file",
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

function buildTaskDispatchContent(input: {
  action: "created" | "approved";
  assigneeName: string;
  goalHref: string;
  goalTitle: string;
  taskHref: string;
  taskIndex: number;
  taskTitle: string;
}): string {
  const actionText = input.action === "created" ? "已创建任务" : "已批准任务";

  return [
    `@${input.assigneeName} ${actionText}：`,
    `Goal: [${input.goalTitle}](${input.goalHref})`,
    `[Task #${input.taskIndex} ${input.taskTitle}](${input.taskHref})`,
  ].join("\n");
}

function getAssistantMessageContent(event: RunEvent): string | undefined {
  if (event.type === "message.delta") {
    return event.content;
  }

  return undefined;
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
  const kind = input.kind ?? "file";
  const filename = sanitizeArtifactFilename(input.filename);
  const storageKey = conversationArtifactStorageKey({
    artifactId,
    conversationId: artifactConversationId,
    filename,
  });
  const siteFiles = kind === "site" ? input.files ?? [] : [];
  const normalizedEntrypoint = kind === "site"
    ? normalizeDeploymentFilePath(input.entrypoint ?? "index.html")
    : undefined;
  const normalizedSiteFiles = siteFiles.map((file) => ({
    ...file,
    path: normalizeDeploymentFilePath(file.path),
  }));

  if (kind === "site") {
    if (normalizedSiteFiles.length === 0) {
      throw new Error("Site artifact upload did not include files.");
    }

    if (
      normalizedEntrypoint === undefined ||
      !normalizedSiteFiles.some((file) => file.path === normalizedEntrypoint)
    ) {
      throw new Error("Site artifact entrypoint was not included.");
    }
  }

  let writtenBytes = 0;
  if (kind === "site") {
    writtenBytes = normalizedSiteFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
    await writeArtifactTextContent({
      content: JSON.stringify({
        entrypoint: normalizedEntrypoint,
        files: normalizedSiteFiles.map((file) => ({
          path: file.path,
          sizeBytes: file.sizeBytes,
        })),
      }, null, 2),
      storageKey,
      storageRoot: input.storageRoot,
    });
  } else {
    writtenBytes = await writeArtifactContent({
      contentBase64: input.contentBase64,
      storageKey,
      storageRoot: input.storageRoot,
    });

    if (writtenBytes !== input.sizeBytes) {
      throw new Error("Artifact content size did not match upload size.");
    }
  }

  const now = new Date();
  const artifact = await db.transaction(async (tx) => {
    const [artifactRow] = await tx
      .insert(conversationArtifacts)
      .values({
        id: artifactId,
        ownerUserId: run.ownerUserId,
        conversationId: artifactConversationId,
        kind,
        goalId: input.goalId,
        goalTaskId,
        taskIndex: input.taskIndex,
        runId: input.runId,
        creatorAgentId: run.agentId,
        status: "ready",
        title: input.title.trim(),
        filename,
        entrypoint: normalizedEntrypoint,
        fileCount: kind === "site" ? normalizedSiteFiles.length : undefined,
        sourcePath: input.sourcePath,
        sizeBytes: writtenBytes,
        storageKey,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (artifactRow === undefined) {
      return undefined;
    }

    if (kind === "site") {
      const fileRows = [];
      for (const file of normalizedSiteFiles) {
        const fileStorageKey = conversationArtifactSiteFileStorageKey({
          artifactId,
          conversationId: artifactConversationId,
          filePath: file.path,
        });
        const fileBytes = await writeArtifactContent({
          contentBase64: file.contentBase64,
          storageKey: fileStorageKey,
          storageRoot: input.storageRoot,
        });

        if (fileBytes !== file.sizeBytes) {
          throw new Error(`Site artifact file size did not match: ${file.path}`);
        }

        fileRows.push({
          artifactId,
          ownerUserId: run.ownerUserId,
          conversationId: artifactConversationId,
          path: file.path,
          mimeType: inferArtifactFileInfo({ filename: file.path }).mimeType,
          sizeBytes: fileBytes,
          storageKey: fileStorageKey,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx.insert(conversationArtifactFiles).values(fileRows);
    }

    return artifactRow;
  });

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
        runtimeSessionId: input.job.runtimeSessionId,
        parentRunId: input.job.run.parentRunId,
        preemptedByRunId: input.job.run.preemptedByRunId,
        dispatchMode: input.job.dispatchMode ?? input.job.run.dispatchMode ?? "new",
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
            runtimeSessionId: job.runtimeSessionId,
            parentRunId: job.run.parentRunId,
            preemptedByRunId: job.run.preemptedByRunId,
            dispatchMode: job.dispatchMode ?? job.run.dispatchMode ?? "new",
          prompt: job.prompt,
          workspacePath: job.workspacePath,
          memoryWorkspacePath: job.memoryWorkspacePath ?? job.workspacePath,
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

function isTerminalTaskStatus(status: string): boolean {
  return status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted";
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
        task.status === "interrupted" ||
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
          dependency.status === "interrupted" ||
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
  const project = conversation.type === "project"
    ? await getProjectForConversation(db, {
        conversationId: conversation.id,
        ownerUserId: goal.ownerUserId,
      })
    : null;
  const projectProtocolPrompt = conversation.type === "project"
    ? buildProjectProtocolPrompt({
        conversationTitle: conversation.title,
        isOrchestrator: true,
        project: project ?? undefined,
      })
    : undefined;
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
    ...orchestratorParallelSerialTaskInstructions,
    "Before approving or creating same-assignee follow-up work, inspect the task graph. Tasks for the same assignee within this Goal must remain serial.",
    "Do not approve a ready task if the same assignee has an earlier active task with status waiting, ready, assigned, or running in this Goal.",
    "If a ready downstream task depends on multiple parallel tasks, approve it only after every dependency is succeeded.",
    "If the completed task output is incomplete or needs rework, create a serial follow-up or recovery task instead of completing the goal.",
    "When creating more work for the same assignee, set dependsOnTaskIndexes to that assignee's previous task index.",
    "create_task and approve_task automatically create the visible assignment message and start the assignee run. Do not follow them with send_message that mentions the assignee; @AgentName and @all force ordinary chat runs and can duplicate the task.",
    "When using send_message for checkpoint updates, omit @AgentName/@all unless you intentionally want a separate ordinary chat reply run.",
    artifactUserFacingLinkInstructions,
    "</agenthub_task_checkpoint>",
    "",
    projectProtocolPrompt,
    projectProtocolPrompt === undefined ? undefined : "",
    agentGroupsPrompt,
    "",
    "<task_graph>",
    taskLines.join("\n\n"),
    "</task_graph>",
  ].filter((line): line is string => line !== undefined).join("\n");
  let job: RunQueueJob = {
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
      projectProtocolPrompt,
      "You are the Orchestrator reviewing a completed task checkpoint. Continue, repair, or complete the goal using AgentHub MCP tools.",
      ...orchestratorParallelSerialTaskInstructions,
      "Keep tasks for the same assignee serial within the Goal. Check list_goals/task_graph before approving same-assignee downstream work, and do not approve it while an earlier same-assignee task is active.",
      "Approve downstream work only after all required dependency tasks are succeeded; use serial follow-up or recovery tasks when an output needs rework.",
      "Do not use send_message with @AgentName or @all to dispatch task work. Use create_task for new tasks and approve_task for ready downstream tasks; both tools dispatch automatically.",
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

    const preparedJob = await prepareConversationRunJobDispatch(tx as unknown as Db, job, {
      conversationId: conversation.id,
      createdAt: input.createdAt,
      ownerUserId: goal.ownerUserId,
      realtimeEvents: input.realtimeEvents,
    });
    job = preparedJob.job;

    await tx.insert(runs).values({
      id: runId,
      ownerUserId: goal.ownerUserId,
      conversationId: conversation.id,
      agentId: runAgent.agent.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      status: "queued",
      runtimeSessionId: job.runtimeSessionId,
      parentRunId: job.run.parentRunId,
      preemptedByRunId: job.run.preemptedByRunId,
      dispatchMode: job.dispatchMode ?? job.run.dispatchMode ?? "new",
      prompt: job.prompt,
      workspacePath: job.workspacePath,
      memoryWorkspacePath: job.memoryWorkspacePath ?? job.workspacePath,
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
  const project = input.conversation.type === "project"
    ? await getProjectForConversation(db, {
        conversationId: input.conversation.id,
        ownerUserId: input.ownerUserId,
      })
    : null;
  const projectProtocolPrompt = input.conversation.type === "project"
    ? buildProjectProtocolPrompt({
        conversationTitle: input.conversation.title,
        project: project ?? undefined,
      })
    : undefined;

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
      projectProtocolPrompt,
    }),
    agentInstructions: buildAssignedTaskInstructions({
      agentName: runAgent.agent.name,
      agentDescription: runAgent.agent.description,
      conversationTitle: input.conversation.title,
      projectProtocolPrompt,
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

async function listCurrentGroupMessagesForTool(
  db: Db,
  input: {
    beforeMessageId?: string;
    context: {
      conversation: ConversationRow;
      run: { ownerUserId: string };
    };
    limit?: number;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<ConversationMessage[]> {
  if (
    input.context.conversation.type !== "group" &&
    input.context.conversation.type !== "project"
  ) {
    return [];
  }

  let before: Date | undefined;

  if (input.beforeMessageId !== undefined) {
    const [message] = await db
      .select({ createdAt: conversationMessages.createdAt })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, input.beforeMessageId),
          eq(conversationMessages.conversationId, input.context.conversation.id),
        ),
      )
      .limit(1);
    before = message?.createdAt;
  }

  return await listConversationMessagesForUser(db, {
    before,
    conversationId: input.context.conversation.id,
    limit: input.limit ?? 30,
    ownerUserId: input.context.run.ownerUserId,
    publicApiBaseUrl: input.publicApiBaseUrl,
    publicWebBaseUrl: input.publicWebBaseUrl,
  }) ?? [];
}

async function searchCurrentGroupMessagesForTool(
  db: Db,
  input: {
    context: {
      conversation: ConversationRow;
      run: { ownerUserId: string };
    };
    limit?: number;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
    query: string;
  },
): Promise<ConversationMessage[]> {
  if (
    input.context.conversation.type !== "group" &&
    input.context.conversation.type !== "project"
  ) {
    return [];
  }

  const messages = await listConversationMessagesForUser(db, {
    conversationId: input.context.conversation.id,
    limit: 500,
    ownerUserId: input.context.run.ownerUserId,
    publicApiBaseUrl: input.publicApiBaseUrl,
    publicWebBaseUrl: input.publicWebBaseUrl,
  }) ?? [];
  const query = input.query.toLowerCase();
  const matches = messages.filter((message) =>
    message.content.toLowerCase().includes(query)
  );

  return matches.slice(-(input.limit ?? 20));
}

export async function appendRunEventToConversationMessage(
  db: Db,
  event: RunEvent,
  options: AppendRunEventOptions = {},
): Promise<AppendRunEventResult> {
  const dispatchJobs: RunQueueJob[] = [];
  const memoryAppendJobs: MemoryAppendQueueJob[] = [];
  const projectMergeRequests: ProjectChangeMergeRequest[] = [];
  const realtimeEvents: RealtimeEvent[] = [];
  let toolResult: AgentHubMcpToolResult | undefined;
  const result = (): AppendRunEventResult => ({
    dispatchJobs,
    memoryAppendJobs,
    projectMergeRequests,
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
        ...(event.type === "run.completed" && event.status === "interrupted"
          ? { blockedReason: "Interrupted by a newer run for this agent." }
          : {}),
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

      if (event.status !== "interrupted") {
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
  }

  if (event.type === "agenthub.tool.call") {
    if (event.name === "list_group_messages") {
      const context = await getToolRunContext(db, event.runId);

      if (context === null) {
        return result();
      }

      const input = readListGroupMessagesToolInput(event.input);
      toolResult = {
        accepted: true,
        messages: input === null
          ? []
          : await listCurrentGroupMessagesForTool(db, {
              beforeMessageId: input.beforeMessageId,
              context,
              limit: input.limit,
              publicApiBaseUrl: options.publicApiBaseUrl,
              publicWebBaseUrl: options.publicWebBaseUrl,
            }),
      };
      return result();
    }

    if (event.name === "search_group_messages") {
      const context = await getToolRunContext(db, event.runId);

      if (context === null) {
        return result();
      }

      const input = readSearchGroupMessagesToolInput(event.input);
      toolResult = {
        accepted: true,
        messages: input === null
          ? []
          : await searchCurrentGroupMessagesForTool(db, {
              context,
              limit: input.limit,
              publicApiBaseUrl: options.publicApiBaseUrl,
              publicWebBaseUrl: options.publicWebBaseUrl,
              query: input.query,
            }),
      };
      return result();
    }

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

    if (event.name === "list_project_changes") {
      const context = await getToolRunContext(db, event.runId);
      const input = readListProjectChangesToolInput(event.input);

      if (context === null || context.conversation.type !== "project") {
        return result();
      }

      toolResult = {
        accepted: true,
        changes: await listProjectChangesForConversation(db, {
          conversationId: context.conversation.id,
          ownerUserId: context.run.ownerUserId,
          status: input?.status,
        }) ?? [],
      };
      return result();
    }

    if (event.name === "read_project_change") {
      const context = await getToolRunContext(db, event.runId);
      const input = readReadProjectChangeToolInput(event.input);

      if (
        context === null ||
        context.conversation.type !== "project" ||
        input === null
      ) {
        return result();
      }

      const change = await getProjectChangeWithDiffForConversation(db, {
        changeId: input.changeId,
        conversationId: context.conversation.id,
        ownerUserId: context.run.ownerUserId,
      });

      if (change !== null) {
        toolResult = {
          accepted: true,
          change: change.change,
          diff: change.diff,
        };
      }
      return result();
    }

    if (event.name === "merge_project_change") {
      const context = await getToolRunContext(db, event.runId);
      const input = readMergeProjectChangeToolInput(event.input);

      if (
        context === null ||
        context.conversation.type !== "project" ||
        input === null ||
        context.conversation.orchestratorAgentId !== context.run.agentId
      ) {
        return result();
      }

      const [project, change] = await Promise.all([
        getProjectForConversation(db, {
          conversationId: context.conversation.id,
          ownerUserId: context.run.ownerUserId,
        }),
        getProjectChangeForConversation(db, {
          changeId: input.changeId,
          conversationId: context.conversation.id,
          ownerUserId: context.run.ownerUserId,
        }),
      ]);

      if (
        project === null ||
        project.cloneStatus !== "ready" ||
        project.baseRepoPath === undefined ||
        change === null ||
        change.status !== "open"
      ) {
        return result();
      }

      projectMergeRequests.push({
        baseRepoPath: project.baseRepoPath,
        branchName: change.branchName,
        changeId: change.id,
        daemonDeviceId: project.daemonDeviceId,
        message: input.message,
      });

      toolResult = {
        accepted: true,
        change,
      };
      return result();
    }

    if (event.name === "reject_project_change") {
      const context = await getToolRunContext(db, event.runId);
      const input = readRejectProjectChangeToolInput(event.input);

      if (
        context === null ||
        context.conversation.type !== "project" ||
        input === null ||
        context.conversation.orchestratorAgentId !== context.run.agentId
      ) {
        return result();
      }

      const change = await updateProjectChangeStatus(db, {
        changeId: input.changeId,
        ownerUserId: context.run.ownerUserId,
        status: "rejected",
        summary: input.reason,
      });

      if (change !== null) {
        toolResult = {
          accepted: true,
          change,
        };
      }
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

    if (event.name === "download_artifact") {
      const input = readDownloadArtifactToolInput(event.input);
      const context = await getToolRunContext(db, event.runId);

      if (
        input === null ||
        context === null ||
        options.storageRoot === undefined
      ) {
        return result();
      }

      const record = await getDownloadableArtifactContentForRun(db, {
        artifactId: input.artifactId,
        conversationId: context.conversation.id,
        goalId: input.goalId,
        ownerUserId: context.run.ownerUserId,
        storageRoot: options.storageRoot,
      });

      if (record === null) {
        return result();
      }

      toolResult = {
        accepted: true,
        artifact: toConversationArtifact(record.artifact, {
          publicApiBaseUrl: options.publicApiBaseUrl,
          publicWebBaseUrl: options.publicWebBaseUrl,
        }),
        contentBase64: record.content.toString("base64"),
        filename: record.filename,
        sizeBytes: record.content.byteLength,
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
        (context.conversation.type !== "group" && context.conversation.type !== "project") ||
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
            inArray(conversations.type, ["group", "project"]),
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
      const dispatchContent = buildTaskDispatchContent({
        action: "created",
        assigneeName: assignee.name,
        goalHref,
        goalTitle: goal.title,
        taskHref,
        taskIndex,
        taskTitle: input.title,
      });
      const shouldDispatch = taskStatus === "assigned";
      let job = shouldDispatch && !isSelfAssigned
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

      if (job !== null) {
        const preparedJob = await prepareConversationRunJobDispatch(db, job, {
          conversationId: conversation.id,
          createdAt,
          handoffActiveTaskRuns: false,
          ownerUserId: run.ownerUserId,
          realtimeEvents,
        });
        job = preparedJob.job;
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
            runtimeSessionId: job.runtimeSessionId,
            parentRunId: job.run.parentRunId,
            preemptedByRunId: job.run.preemptedByRunId,
            dispatchMode: job.dispatchMode ?? job.run.dispatchMode ?? "new",
            prompt: job.prompt,
            workspacePath: job.workspacePath,
            memoryWorkspacePath: job.memoryWorkspacePath ?? job.workspacePath,
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
      const dispatchContent = buildTaskDispatchContent({
        action: "approved",
        assigneeName: assignee?.name ?? task.assigneeAgentId,
        goalHref,
        goalTitle: goal.title,
        taskHref,
        taskIndex: task.index,
        taskTitle: task.title,
      });
      const goalTasks = await listGoalTasks(db, goal.id);
      let job = await createAssignedTaskRunJob(db, {
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

      const preparedJob = await prepareConversationRunJobDispatch(db, job, {
        conversationId: context.conversation.id,
        createdAt: updatedAt,
        handoffActiveTaskRuns: false,
        ownerUserId: context.run.ownerUserId,
        realtimeEvents,
      });
      job = preparedJob.job;

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
          runtimeSessionId: job.runtimeSessionId,
          parentRunId: job.run.parentRunId,
          preemptedByRunId: job.run.preemptedByRunId,
          dispatchMode: job.dispatchMode ?? job.run.dispatchMode ?? "new",
          prompt: job.prompt,
          workspacePath: job.workspacePath,
          memoryWorkspacePath: job.memoryWorkspacePath ?? job.workspacePath,
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
      createConversationTranscriptMemoryJobs,
      createdAt: new Date(event.createdAt),
      eventCreatedAt: event.createdAt,
      ownerUserId: run.ownerUserId,
      prepareConversationRunJobDispatch,
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

