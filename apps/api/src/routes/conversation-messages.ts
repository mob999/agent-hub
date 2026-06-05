import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentHubMcpToolName,
} from "@agent-hub/core";
import {
  agentHubAllMcpTools,
  agentHubNonOrchestratorMcpTools,
  inferArtifactFileInfo,
  isDefaultAvatarPath,
} from "@agent-hub/core";
import {
  appendRunEvent,
  archiveAgentForUser,
  archiveGroupConversationForUser,
  createAgentProvisioningRecords,
  createDaemonDeviceForUser,
  applyRunDispatchPreparation,
  buildAgentIdentityInstructions,
  buildProjectProtocolPrompt,
  buildRecentDirectMessagesPrompt,
  createRunRecord,
  buildConversationRunPrompt,
  createConversationArtifactAction,
  createConversationArtifactFileRevision,
  createConversationArtifactRevision,
  createGroupConversation,
  createProjectConversation,
  createUserMessageAndRun,
  createUserMessageAndRuns,
  createRealtimeEvent,
  deleteArchivedAgentForUser,
  deleteArchivedGroupConversationForUser,
  enqueueAgentProvisioningJob,
  enqueueArtifactActionJob,
  enqueueRunJob,
  enqueueMemoryAppendJob,
  enqueueProjectCloneJob,
  ensureDefaultGroupConversation,
  ensureDirectConversation,
  getAgentForUser,
  getConversationForUser,
  getConversationArtifactForUser,
  getConversationArtifactContentForUser,
  getConversationArtifactDetailsForUser,
  getConversationArtifactFileContentForUser,
  getConversationArtifactFileRawContentForUser,
  getProjectForConversation,
  getProjectChangeWithDiffForConversation,
  getSiteArtifactZipForUser,
  getDaemonDeviceForUser,
  getReadyDaemonRuntime,
  getRunnableAgentForUser,
  listConversationMessagesForUser,
  listConversationArtifactsForUser,
  listConversationArtifactFilesForUser,
  listConversationDeploymentsForUser,
  listProjectChangesForConversation,
  listConversationGoalsForUser,
  listConversationsForUser,
  getRunEventsForUser,
  getRunForUser,
  listAgentsForUser,
  listDaemonDevicesWithRuntimes,
  listRecentDirectConversationMessagesForAgent,
  listRunsForUser,
  listRunningRunIdsByDaemonDevice,
  markProjectBaseHead,
  groupConversationKeyFromTitle,
  normalizeGroupConversationTitle,
  publishSiteArtifactForUser,
  readArtifactContent,
  restoreAgentForUser,
  restoreGroupConversationForUser,
  softDeleteDaemonDeviceForUser,
  searchConversationsForUser,
  resolveTextMentionedAgentIds,
  toAgentRun,
  updateConversationOrchestrator,
  updateDaemonDeviceForUser,
  updateAgentProfileForUser,
  updateGroupConversation,
  updateProjectConversation,
  type RunnableAgent,
  type RunQueueJob,
  type UserMessageAttachmentUpload,
} from "@agent-hub/server";
import { OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth, type AppBindings } from "../auth/middleware.js";
import type { ApiRouteContext } from "../context.js";
import { openApiRoute } from "./openapi.js";

export function createConversationMessageRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    publishRealtimeEvents,
    realtimeEventsForCreatedRuns,
    isUploadedFile,
    getFormString,
    userMessageForPrompt,
    writeUserMessageAttachments,
    validateUploadFiles,
    groupChatMcpToolsForAgent,
    toMcpGoalList,
    applyContextCompressionToJob,
    prepareApiRunJobDispatch,
    prepareApiRunJobsDispatch,
    buildAgentGroupsPromptForAgent,
    buildGroupChatAgentInstructions,
    buildGroupChatRunPrompt,
    buildGroupTaskOrchestratorInstructions,
    buildGroupTaskOrchestratorPrompt,
  } = context.services;

  app.use("/conversations/*", requireAuth);

  openApiRoute(app, "post", "/conversations/:conversationId/messages", async (c) => {
    const user = c.get("user");
  
    if (!user) {
      return c.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        },
        401,
      );
    }
  
    const isMultipart = c.req.header("content-type")
      ?.toLowerCase()
      .includes("multipart/form-data") ?? false;
    const body = isMultipart
      ? (() => ({} as { agentId?: unknown; content?: unknown; mode?: unknown }))()
      : (await c.req.json().catch(() => ({}))) as {
          agentId?: unknown;
          content?: unknown;
          mode?: unknown;
        };
    const form = isMultipart ? await c.req.formData() : null;
    const uploadFiles = form === null
      ? []
      : [
          ...form.getAll("attachments"),
          ...form.getAll("attachments[]"),
        ].filter(isUploadedFile);
    const uploadValidationError = validateUploadFiles(uploadFiles);
  
    if (uploadValidationError !== null) {
      return c.json(
        {
          error: {
            code: "INVALID_ATTACHMENT_REQUEST",
            message: uploadValidationError,
          },
        },
        400,
      );
    }
  
    const rawContent = form === null ? body.content : getFormString(form, "content");
    const rawMode = form === null ? body.mode : getFormString(form, "mode");
    const rawAgentId = form === null ? body.agentId : getFormString(form, "agentId");
    const content = typeof rawContent === "string" ? rawContent.trim() : "";
    const mode = rawMode === undefined || rawMode === "chat"
      ? "chat"
      : rawMode === "task"
        ? "task"
        : undefined;
  
    if ((content.length === 0 && uploadFiles.length === 0) || mode === undefined) {
      return c.json(
        {
          error: {
            code: "INVALID_MESSAGE_REQUEST",
            message: "content or attachments are required and mode must be chat or task.",
          },
        },
        400,
      );
    }
  
    const conversation = await getConversationForUser(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (conversation === null) {
      return c.json(
        {
          error: {
            code: "CONVERSATION_NOT_FOUND",
            message: "Conversation was not found.",
          },
        },
        404,
      );
    }
  
    if (conversation.status !== "active") {
      return c.json(
        {
          error: {
            code: "CONVERSATION_ARCHIVED",
            message: "Restore this conversation before sending a message.",
          },
        },
        400,
      );
    }
  
    const requestedAgentId =
      typeof rawAgentId === "string" && rawAgentId.length > 0
        ? rawAgentId
        : undefined;
    let userMessageAttachmentsCache: UserMessageAttachmentUpload[] | null = null;
    const getUserMessageAttachments = async () => {
      userMessageAttachmentsCache ??= await writeUserMessageAttachments({
        conversationId: conversation.id,
        files: uploadFiles,
      });
  
      return userMessageAttachmentsCache;
    };
    const now = new Date().toISOString();
    const priorMessages = await listConversationMessagesForUser(db, {
      conversationId: conversation.id,
      ownerUserId: user.id,
      limit: 30,
    });
  
    if (priorMessages === null) {
      return c.json(
        {
          error: {
            code: "CONVERSATION_NOT_FOUND",
            message: "Conversation was not found.",
          },
        },
        404,
      );
    }
  
    const currentConversationGoals =
      conversation.type === "group" || conversation.type === "project"
        ? await listConversationGoalsForUser(db, {
            conversationId: conversation.id,
            ownerUserId: user.id,
            publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
            publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
          })
        : [];
  
    if (currentConversationGoals === null) {
      return c.json(
        {
          error: {
            code: "CONVERSATION_NOT_FOUND",
            message: "Conversation was not found.",
          },
        },
        404,
      );
    }
  
    const agentHubMcpGoals = toMcpGoalList(currentConversationGoals);
  
    const userAgents = await listAgentsForUser(db, { ownerUserId: user.id });
    const agentNamesById = Object.fromEntries(
      userAgents.map((agent) => [
        agent.agent.id,
        agent.agent.name,
      ]),
    );
  
    if (conversation.type === "direct") {
      const runAgent = conversation.directAgentId === undefined
        ? null
        : await getRunnableAgentForUser(db, {
            agentId: conversation.directAgentId,
            ownerUserId: user.id,
          });
  
      if (runAgent === null) {
        return c.json(
          {
            error: {
              code: "AGENT_NOT_READY",
              message: "Agent is not ready to run yet.",
            },
          },
          400,
        );
      }
  
      const agentGroupsPrompt = await buildAgentGroupsPromptForAgent({
        agentId: runAgent.agent.id,
        ownerUserId: user.id,
      });
      const userMessageAttachments = await getUserMessageAttachments();
      const currentUserMessageForPrompt = userMessageForPrompt(
        content,
        userMessageAttachments,
        { conversationId: conversation.id },
      );
      const initialJob = applyContextCompressionToJob({
        conversationId: conversation.id,
        daemonDeviceId: runAgent.daemonDeviceId,
        prompt: [
          agentGroupsPrompt,
          buildConversationRunPrompt({
            agentNamesById,
            currentUserMessage: currentUserMessageForPrompt,
            messages: priorMessages,
          }),
        ].join("\n\n"),
        agentInstructions: buildAgentIdentityInstructions({
          agentDescription: runAgent.agent.description,
          agentName: runAgent.agent.name,
          scenario: "direct chat",
        }),
        agentHubMcpTools: [...agentHubNonOrchestratorMcpTools],
        agentHubMcpGoals,
        workspacePath: runAgent.workspacePath,
        run: {
          id: randomUUID(),
          agentId: runAgent.agent.id,
          daemonDeviceId: runAgent.daemonDeviceId,
          status: "queued",
          createdAt: now,
          updatedAt: now,
        },
        runtime: runAgent.runtime,
      }, {
        agentNamesById,
        currentUserMessage: currentUserMessageForPrompt,
        messages: priorMessages,
      });
      const { job, realtimeEvents: preemptRealtimeEvents } =
        await prepareApiRunJobDispatch(initialJob, {
          conversationId: conversation.id,
          ownerUserId: user.id,
        });
      const result = await createUserMessageAndRun(db, {
        ownerUserId: user.id,
        conversationId: conversation.id,
        job,
        userMessageContent: content,
        userMessageAttachments,
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
        publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      });
  
      if (result === null) {
        return c.json(
          {
            error: {
              code: "CONVERSATION_NOT_FOUND",
              message: "Conversation was not found.",
            },
          },
          404,
        );
      }
  
      const queueMessageId = await enqueueRunJob(redis, job);
      await Promise.all(
        result.memoryAppendJobs.map((memoryJob) => enqueueMemoryAppendJob(redis, memoryJob)),
      );
      const assistant = result.messages.assistant;
      await publishRealtimeEvents(
        [
          ...preemptRealtimeEvents,
          ...realtimeEventsForCreatedRuns({
            conversation: result.conversation,
            jobs: [job],
            messages: [
              result.messages.user,
              ...(assistant === undefined ? [] : [assistant]),
            ],
            ownerUserId: user.id,
          }),
        ],
      );
  
      return c.json(
        {
          conversation: result.conversation,
          messages: {
            ...result.messages,
            assistants: assistant === undefined ? [] : [assistant],
          },
          run: job.run,
          runs: [job.run],
          queueMessageId,
          queueMessageIds: [queueMessageId],
        },
        202,
      );
    }
  
    const groupAgentIds = conversation.agentIds ?? [];
    const mentionedAgentIds = resolveTextMentionedAgentIds(
      content,
      userAgents
        .filter((agent) => groupAgentIds.includes(agent.agent.id))
        .map((agent) => ({ id: agent.agent.id, name: agent.agent.name })),
    );
  
    if (mode === "task") {
      if (conversation.orchestratorAgentId === undefined) {
        return c.json(
          {
            error: {
              code: "ORCHESTRATOR_NOT_CONFIGURED",
              message: "Set a group orchestrator before using Task mode.",
            },
          },
          400,
        );
      }
  
      if (!groupAgentIds.includes(conversation.orchestratorAgentId)) {
        return c.json(
          {
            error: {
              code: "ORCHESTRATOR_NOT_IN_GROUP",
              message: "Orchestrator must be a member of this group.",
            },
          },
          400,
        );
      }
  
      const orchestrator = await getRunnableAgentForUser(db, {
        agentId: conversation.orchestratorAgentId,
        ownerUserId: user.id,
      });
  
      if (orchestrator === null) {
        return c.json(
          {
            error: {
              code: "ORCHESTRATOR_NOT_READY",
              message: "The configured orchestrator is not ready to run.",
            },
          },
          400,
        );
      }
  
      const readyGroupAgents: RunnableAgent[] = [];
  
      for (const agentId of groupAgentIds) {
        const runAgent = await getRunnableAgentForUser(db, {
          agentId,
          ownerUserId: user.id,
        });
  
        if (runAgent !== null) {
          readyGroupAgents.push(runAgent);
        }
      }
  
      const agentGroupsPrompt = await buildAgentGroupsPromptForAgent({
        agentId: orchestrator.agent.id,
        currentConversationId: conversation.id,
        ownerUserId: user.id,
      });
      const projectProtocolPrompt = conversation.type === "project"
        ? buildProjectProtocolPrompt({
            conversationTitle: conversation.title,
            isOrchestrator: true,
            project: conversation.project,
          })
        : undefined;
      const userMessageAttachments = await getUserMessageAttachments();
      const currentUserMessageForPrompt = userMessageForPrompt(
        content,
        userMessageAttachments,
        { conversationId: conversation.id },
      );
      const initialJob = applyContextCompressionToJob({
        conversationId: conversation.id,
        daemonDeviceId: orchestrator.daemonDeviceId,
        prompt: buildGroupTaskOrchestratorPrompt({
          agentNamesById,
          agentName: orchestrator.agent.name,
          agents: readyGroupAgents,
          agentGroupsPrompt,
          conversationTitle: conversation.title,
          currentUserMessage: currentUserMessageForPrompt,
          messages: priorMessages,
          orchestratorAgentId: conversation.orchestratorAgentId,
          projectProtocolPrompt,
        }),
        agentInstructions: buildGroupTaskOrchestratorInstructions({
          agentIdentityInstructions: buildAgentIdentityInstructions({
            agentDescription: orchestrator.agent.description,
            agentName: orchestrator.agent.name,
            conversationTitle: conversation.title,
            isOrchestrator: true,
            scenario: "task orchestrator",
          }),
          conversationTitle: conversation.title,
          projectProtocolPrompt,
        }),
        agentHubMcpTools: [...agentHubAllMcpTools],
        agentHubMcpGoals,
        workspacePath: orchestrator.workspacePath,
        run: {
          id: randomUUID(),
          agentId: orchestrator.agent.id,
          daemonDeviceId: orchestrator.daemonDeviceId,
          status: "queued",
          createdAt: now,
          updatedAt: now,
        },
        runtime: orchestrator.runtime,
      }, {
        agentNamesById,
        currentUserMessage: currentUserMessageForPrompt,
        messages: priorMessages,
      });
      const { job, realtimeEvents: preemptRealtimeEvents } =
        await prepareApiRunJobDispatch(initialJob, {
          conversationId: conversation.id,
          ownerUserId: user.id,
        });
      const result = await createUserMessageAndRuns(db, {
        ownerUserId: user.id,
        conversationId: conversation.id,
        jobs: [job],
        userMessageContent: content,
        userMessageAttachments,
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
        publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      });
  
      if (result === null) {
        return c.json(
          {
            error: {
              code: "CONVERSATION_NOT_FOUND",
              message: "Conversation was not found.",
            },
          },
          404,
        );
      }
  
      const queueMessageId = await enqueueRunJob(redis, job);
      await Promise.all(
        result.memoryAppendJobs.map((memoryJob) => enqueueMemoryAppendJob(redis, memoryJob)),
      );
      await publishRealtimeEvents(
        [
          ...preemptRealtimeEvents,
          ...realtimeEventsForCreatedRuns({
            conversation: result.conversation,
            jobs: [job],
            messages: [
              result.messages.user,
              ...result.messages.assistants,
            ],
            ownerUserId: user.id,
          }),
        ],
      );
  
      return c.json(
        {
          conversation: result.conversation,
          messages: result.messages,
          run: job.run,
          runs: [job.run],
          queueMessageId,
          queueMessageIds: [queueMessageId],
        },
        202,
      );
    }
  
    const targetAgentIds = requestedAgentId !== undefined
      ? [requestedAgentId]
      : mentionedAgentIds.length > 0
        ? mentionedAgentIds
        : groupAgentIds;
    const nonMemberAgentId = targetAgentIds.find(
      (agentId) => !groupAgentIds.includes(agentId),
    );
  
    if (nonMemberAgentId !== undefined) {
      return c.json(
        {
          error: {
            code: "AGENT_NOT_IN_GROUP",
            message: "Agent is not a member of this group.",
          },
        },
        400,
      );
    }
  
    const runAgents: RunnableAgent[] = [];
  
    for (const agentId of targetAgentIds) {
      const runAgent = await getRunnableAgentForUser(db, {
        agentId,
        ownerUserId: user.id,
      });
  
      if (runAgent !== null) {
        runAgents.push(runAgent);
      }
    }
  
    if (runAgents.length === 0) {
      return c.json(
        {
          error: {
            code: "NO_READY_AGENT",
            message: "Create a ready agent before sending a group message.",
          },
        },
        400,
      );
    }
  
    const userMessageAttachments = await getUserMessageAttachments();
    const currentUserMessageForPrompt = userMessageForPrompt(
      content,
      userMessageAttachments,
      { conversationId: conversation.id },
    );
    const initialJobs = await Promise.all(
      runAgents.map(async (runAgent): Promise<RunQueueJob> => {
        const isOrchestrator = conversation.orchestratorAgentId === runAgent.agent.id;
        const projectProtocolPrompt = conversation.type === "project"
          ? buildProjectProtocolPrompt({
              conversationTitle: conversation.title,
              isOrchestrator,
              project: conversation.project,
            })
          : undefined;
  
        return applyContextCompressionToJob({
          conversationId: conversation.id,
          daemonDeviceId: runAgent.daemonDeviceId,
          prompt: buildGroupChatRunPrompt({
            agentGroupsPrompt: await buildAgentGroupsPromptForAgent({
              agentId: runAgent.agent.id,
              currentConversationId: conversation.id,
              ownerUserId: user.id,
            }),
            agentNamesById,
            agentName: runAgent.agent.name,
            conversationTitle: conversation.title,
            currentUserMessage: currentUserMessageForPrompt,
            directMessagesPrompt: buildRecentDirectMessagesPrompt({
              agentName: runAgent.agent.name,
              agentNamesById,
              messages: await listRecentDirectConversationMessagesForAgent(db, {
                agentId: runAgent.agent.id,
                limit: 20,
                ownerUserId: user.id,
                publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
                publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
              }),
            }),
            isOrchestrator,
            messages: priorMessages,
            projectProtocolPrompt,
          }),
          agentInstructions: buildGroupChatAgentInstructions({
            agentIdentityInstructions: buildAgentIdentityInstructions({
              agentDescription: runAgent.agent.description,
              agentName: runAgent.agent.name,
              conversationTitle: conversation.title,
              isOrchestrator,
              scenario: "group chat",
            }),
            conversationTitle: conversation.title,
            isOrchestrator,
            projectProtocolPrompt,
          }),
          agentHubMcpTools: groupChatMcpToolsForAgent({
            agentId: runAgent.agent.id,
            orchestratorAgentId: conversation.orchestratorAgentId,
          }),
          agentHubMcpGoals,
          workspacePath: runAgent.workspacePath,
          run: {
            id: randomUUID(),
            agentId: runAgent.agent.id,
            daemonDeviceId: runAgent.daemonDeviceId,
            status: "queued",
            createdAt: now,
            updatedAt: now,
          },
          runtime: runAgent.runtime,
        }, {
          agentNamesById,
          currentUserMessage: currentUserMessageForPrompt,
          messages: priorMessages,
        });
      }),
    );
    const { jobs, realtimeEvents: preemptRealtimeEvents } =
      await prepareApiRunJobsDispatch(initialJobs, {
        conversationId: conversation.id,
        ownerUserId: user.id,
      });
    const result = await createUserMessageAndRuns(db, {
      ownerUserId: user.id,
      conversationId: conversation.id,
      jobs,
      userMessageContent: content,
      userMessageAttachments,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
    });
  
    if (result === null) {
      return c.json(
        {
          error: {
            code: "CONVERSATION_NOT_FOUND",
            message: "Conversation was not found.",
          },
        },
        404,
      );
    }
  
    const queueMessageIds = await Promise.all(
      jobs.map((job) => enqueueRunJob(redis, job)),
    );
    await Promise.all(
      result.memoryAppendJobs.map((memoryJob) => enqueueMemoryAppendJob(redis, memoryJob)),
    );
    await publishRealtimeEvents(
      [
        ...preemptRealtimeEvents,
        ...realtimeEventsForCreatedRuns({
          conversation: result.conversation,
          jobs,
          messages: [
            result.messages.user,
            ...result.messages.assistants,
          ],
          ownerUserId: user.id,
        }),
      ],
    );
  
    return c.json(
      {
        conversation: result.conversation,
        messages: result.messages,
        runs: jobs.map((job) => job.run),
        queueMessageIds,
      },
      202,
    );
  });

  return app;
}
