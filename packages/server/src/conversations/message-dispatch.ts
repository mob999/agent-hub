import { randomUUID } from "node:crypto";

import type {
  AgentHubSendMessageTarget,
  AgentHubSendMessageToolInput,
  ConversationMessage,
  ConversationMessageAttachment,
  RealtimeEvent,
  RunEvent,
} from "@agent-hub/core";
import {
  agentHubAllMcpTools,
  agentHubNonOrchestratorMcpTools,
} from "@agent-hub/core";
import {
  agents,
  conversationAgentMembers,
  conversationArtifacts,
  conversationGoalTasks,
  conversationMessageArtifacts,
  conversationMessages,
  conversations,
  runEvents,
  runs,
  type Db,
} from "@agent-hub/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getRunnableAgentForUser } from "../agents/repository.js";
import type { MemoryAppendQueueJob, RunQueueJob } from "../queue/index.js";
import { createRealtimeEvent } from "../realtime/index.js";
import type { RunDispatchTaskContext } from "../runs/dispatch.js";
import { listActiveAgentGroupContexts } from "./agent-groups.js";
import {
  buildRecentDirectMessagesPrompt,
  ensureDirectConversation,
  listConversationGoalsForUser,
  listConversationMessagesForUser,
  listRecentDirectConversationMessagesForAgent,
} from "./conversation-records.js";
import {
  compactUniqueStrings,
  defaultGroupConversationKey,
} from "./helpers.js";
import {
  toConversationArtifact,
  toConversationMessage,
  toConversationMessageAttachment,
  type ConversationMessageRow,
  type ConversationRow,
} from "./mappers.js";
import {
  buildActiveRunsPrompt,
  buildAgentGroupsPrompt,
  buildAssignedTaskInstructions,
  buildAssignedTaskPrompt,
  buildMentionedGroupChatAgentInstructions,
  buildMentionedGroupChatRunPrompt,
  buildProjectProtocolPrompt,
} from "./prompts.js";
import { getProjectForConversation } from "./project-repository.js";

type CreateConversationTranscriptMemoryJobs = (
  db: Db,
  input: {
    conversation: Pick<
      ConversationRow,
      "id" | "key" | "ownerUserId" | "title" | "type" | "directAgentId"
    >;
    message: ConversationMessage;
  },
) => Promise<MemoryAppendQueueJob[]>;

type PrepareConversationRunJobDispatch = (
  db: Db,
  job: RunQueueJob,
  input: {
    conversationId: string;
    createdAt: Date;
    ownerUserId: string;
    realtimeEvents?: RealtimeEvent[];
  },
) => Promise<{
  handedOffTaskContexts: RunDispatchTaskContext[];
  job: RunQueueJob;
}>;

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

export function sendMessageAttachmentArtifactIds(
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

export async function getSendMessageTargetConversation(
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

export async function isConversationAgentMember(
  db: Db,
  input: {
    agentId: string;
    conversation: Pick<ConversationRow, "id" | "key" | "ownerUserId" | "type">;
  },
): Promise<boolean> {
  if (input.conversation.type !== "group" && input.conversation.type !== "project") {
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

export async function listConversationAgentRefs(
  db: Db,
  conversation: Pick<ConversationRow, "id" | "key" | "ownerUserId" | "type">,
): Promise<Array<{ id: string; name: string }>> {
  if (conversation.type !== "group" && conversation.type !== "project") {
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

export function describeSendMessageTarget(
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
      taskDescription: conversationGoalTasks.description,
      taskId: conversationGoalTasks.id,
      taskIndex: conversationGoalTasks.index,
      taskTitle: conversationGoalTasks.title,
    })
    .from(conversationGoalTasks)
    .where(inArray(conversationGoalTasks.assigneeRunId, activeRunIds));
  const taskByRunId = new Map(
    taskRows.flatMap((task) =>
      task.runId === null
        ? []
        : [[
            task.runId,
            {
              goalId: task.goalId,
              taskDescription: task.taskDescription ?? undefined,
              taskId: task.taskId,
              taskIndex: task.taskIndex,
              taskTitle: task.taskTitle,
            },
          ]]
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
        taskDescription: task?.taskDescription,
        taskId: task?.taskId,
        taskIndex: task?.taskIndex,
        taskTitle: task?.taskTitle,
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
    prepareConversationRunJobDispatch: PrepareConversationRunJobDispatch;
    senderAgentId: string;
    triggerMessageId: string;
  },
): Promise<{ dispatchJobs: RunQueueJob[]; realtimeEvents: RealtimeEvent[] }> {
  if (
    (input.conversation.type !== "group" && input.conversation.type !== "project") ||
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
  const project = input.conversation.type === "project"
    ? await getProjectForConversation(db, {
        conversationId: input.conversation.id,
        ownerUserId: input.ownerUserId,
      })
    : null;
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
    const projectProtocolPrompt = input.conversation.type === "project"
      ? buildProjectProtocolPrompt({
          conversationTitle: input.conversation.title,
          isOrchestrator,
          project: project ?? undefined,
        })
      : undefined;
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
    const directMessages = await listRecentDirectConversationMessagesForAgent(db, {
      agentId: runAgent.agent.id,
      limit: 20,
      ownerUserId: input.ownerUserId,
    });
    const initialJob: RunQueueJob = {
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
          messages: directMessages,
        }),
        isOrchestrator,
        messages: priorMessages,
        projectProtocolPrompt,
        senderAgentName,
      }),
      agentInstructions: buildMentionedGroupChatAgentInstructions({
        agentName: runAgent.agent.name,
        agentDescription: runAgent.agent.description,
        conversationTitle: input.conversation.title,
        isOrchestrator,
        projectProtocolPrompt,
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
    const preparedJob = await input.prepareConversationRunJobDispatch(db, initialJob, {
      conversationId: input.conversation.id,
      createdAt: input.createdAt,
      ownerUserId: input.ownerUserId,
      realtimeEvents,
    });
    const handedOffTask = preparedJob.handedOffTaskContexts[0];
    let job = preparedJob.job;
    if (handedOffTask !== undefined) {
      const refreshedGoals =
        (await listConversationGoalsForUser(db, {
          conversationId: input.conversation.id,
          ownerUserId: input.ownerUserId,
        })) ?? agentHubMcpGoals;

      job = {
        ...job,
        prompt: buildAssignedTaskPrompt({
          agentGroupsPrompt,
          continuationMessage: input.content,
          conversationTitle: input.conversation.title,
          dispatchMessage: input.content,
          goalId: handedOffTask.goalId,
          goalTitle: handedOffTask.goalTitle,
          projectProtocolPrompt,
          taskDescription: handedOffTask.taskDescription,
          taskId: handedOffTask.taskId,
          taskIndex: handedOffTask.taskIndex,
          taskTitle: handedOffTask.taskTitle,
        }),
        agentInstructions: buildAssignedTaskInstructions({
          agentName: runAgent.agent.name,
          agentDescription: runAgent.agent.description,
          conversationTitle: input.conversation.title,
          projectProtocolPrompt,
        }),
        agentHubMcpTools: [...agentHubNonOrchestratorMcpTools],
        agentHubMcpGoals: refreshedGoals,
      };
    } else if (job.runtimeSessionId !== undefined) {
      job = {
        ...job,
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
            messages: directMessages,
          }),
          isOrchestrator,
          messages: priorMessages,
          projectProtocolPrompt,
          senderAgentName,
        }),
      };
    }
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
    });

    dispatchJobs.push(job);
    realtimeEvents.push(runEvent, queuedRealtimeEvent);
  }

  return { dispatchJobs, realtimeEvents };
}

export async function persistVisibleAgentMessageAndDispatchMentions(
  db: Db,
  input: {
    agentId: string;
    artifactIds?: string[];
    content: string;
    conversation: ConversationRow;
    createConversationTranscriptMemoryJobs: CreateConversationTranscriptMemoryJobs;
    createdAt: Date;
    eventCreatedAt: string;
    ownerUserId: string;
    prepareConversationRunJobDispatch: PrepareConversationRunJobDispatch;
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
    prepareConversationRunJobDispatch: input.prepareConversationRunJobDispatch,
    senderAgentId: input.agentId,
    triggerMessageId: message.id,
  });
  const conversationMessage = toConversationMessage(message, attachments);
  const memoryAppendJobs = await input.createConversationTranscriptMemoryJobs(db, {
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
