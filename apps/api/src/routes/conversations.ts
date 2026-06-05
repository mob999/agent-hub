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
  cacheTtlSeconds,
  cachedJson,
  conversationArtifactsCacheKey,
  conversationDeploymentsCacheKey,
  conversationMessagesCacheKey,
  conversationTasksCacheKey,
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
  invalidateConversationCache,
  invalidateUserConversationListCache,
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
  userConversationsCacheKey,
  type RunnableAgent,
  type RunQueueJob,
  type UserMessageAttachmentUpload,
} from "@agent-hub/server";
import { OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth, type AppBindings } from "../auth/middleware.js";
import type { ApiRouteContext } from "../context.js";
import { openApiRoute } from "./openapi.js";

export function createConversationsRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    isValidAgentIdList,
    parseOptionalAgentId,
    parseRecordStatusFilter,
  } = context.services;
  const invalidateConversationLists = (userId: string) =>
    invalidateUserConversationListCache(redis, { logger, userId });
  const invalidateConversationDetails = (input: {
    conversationId: string;
    ownerUserId: string;
  }) => invalidateConversationCache(redis, { ...input, logger });

  app.use("/conversations", requireAuth);
  app.use("/conversations/*", requireAuth);
  openApiRoute(app, "get", "/conversations", async (c) => {
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
  
    const status = parseRecordStatusFilter(c.req.query("status"));
  
    if (status === null) {
      return c.json(
        {
          error: {
            code: "INVALID_STATUS_FILTER",
            message: "status must be active, archived, or all.",
          },
        },
        400,
      );
    }
  
    return c.json({
      conversations: await cachedJson(
        redis,
        {
          key: userConversationsCacheKey({ status: status ?? "default", userId: user.id }),
          logger,
          ttlSeconds: cacheTtlSeconds.sidebar,
        },
        () => listConversationsForUser(db, {
          ownerUserId: user.id,
          status,
        }),
      ),
    });
  });
  
  openApiRoute(app, "post", "/conversations/default-group", async (c) => {
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
  
    const conversation = await ensureDefaultGroupConversation(db, {
      ownerUserId: user.id,
    });
    await invalidateConversationLists(user.id);
  
    return c.json({ conversation }, 200);
  });
  
  openApiRoute(app, "post", "/conversations/groups", async (c) => {
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
  
    const body = (await c.req.json().catch(() => ({}))) as {
      agentIds?: unknown;
      description?: unknown;
      orchestratorAgentId?: unknown;
      title?: unknown;
    };
    const title = typeof body.title === "string"
      ? normalizeGroupConversationTitle(body.title)
      : "";
    const description = typeof body.description === "string"
      ? body.description.trim()
      : "";
    const key = groupConversationKeyFromTitle(title);
    const orchestratorAgentId = parseOptionalAgentId(body.orchestratorAgentId);
  
    if (
      title.length === 0 ||
      title.length > 80 ||
      key.length > 80 ||
      !isValidAgentIdList(body.agentIds) ||
      (body.orchestratorAgentId !== undefined && orchestratorAgentId === undefined)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_GROUP_REQUEST",
            message:
              "title, 1-20 unique agentIds, and an optional valid orchestratorAgentId are required.",
          },
        },
        400,
      );
    }
  
    const result = await createGroupConversation(db, {
      ownerUserId: user.id,
      title,
      description: description.length > 0 ? description : undefined,
      agentIds: body.agentIds,
      orchestratorAgentId,
    });
  
    if (result.status === "reserved-key") {
      return c.json(
        {
          error: {
            code: "RESERVED_GROUP_KEY",
            message: "The all group is reserved.",
          },
        },
        409,
      );
    }
  
    if (result.status === "duplicate-key") {
      return c.json(
        {
          error: {
            code: "GROUP_ALREADY_EXISTS",
            message: "A group with this name already exists.",
          },
        },
        409,
      );
    }
  
    if (result.status === "agents-not-found") {
      return c.json(
        {
          error: {
            code: "AGENTS_NOT_FOUND",
            message: "One or more agents were not found.",
          },
        },
        404,
      );
    }
  
    if (result.status === "orchestrator-not-in-group") {
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
    await invalidateConversationLists(user.id);
  
    return c.json({ conversation: result.conversation }, 201);
  });
  
  openApiRoute(app, "post", "/conversations/projects", async (c) => {
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
  
    const body = (await c.req.json().catch(() => ({}))) as {
      agentIds?: unknown;
      description?: unknown;
      orchestratorAgentId?: unknown;
      remoteUrl?: unknown;
      title?: unknown;
    };
    const remoteUrl = typeof body.remoteUrl === "string"
      ? body.remoteUrl.trim()
      : "";
    const title = typeof body.title === "string"
      ? normalizeGroupConversationTitle(body.title)
      : undefined;
    const description = typeof body.description === "string"
      ? body.description.trim()
      : "";
    const orchestratorAgentId = parseOptionalAgentId(body.orchestratorAgentId);
  
    if (
      remoteUrl.length === 0 ||
      remoteUrl.length > 2048 ||
      (title !== undefined && (title.length === 0 || title.length > 80)) ||
      !isValidAgentIdList(body.agentIds) ||
      (body.orchestratorAgentId !== undefined && orchestratorAgentId === undefined)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_PROJECT_REQUEST",
            message:
              "remoteUrl, 1-20 unique agentIds, and an optional valid orchestratorAgentId are required.",
          },
        },
        400,
      );
    }
  
    const result = await createProjectConversation(db, {
      ownerUserId: user.id,
      title,
      description: description.length > 0 ? description : undefined,
      remoteUrl,
      agentIds: body.agentIds,
      orchestratorAgentId,
    });
  
    if (result.status === "agents-not-found") {
      return c.json(
        {
          error: {
            code: "AGENTS_NOT_FOUND",
            message: "One or more ready agents were not found.",
          },
        },
        404,
      );
    }
  
    if (result.status === "agents-not-same-daemon") {
      return c.json(
        {
          error: {
            code: "PROJECT_AGENTS_NOT_SAME_DAEMON",
            message: "Project agents must be ready on the same daemon.",
          },
        },
        400,
      );
    }
  
    if (result.status === "orchestrator-not-in-project") {
      return c.json(
        {
          error: {
            code: "ORCHESTRATOR_NOT_IN_PROJECT",
            message: "Orchestrator must be a member of this project.",
          },
        },
        400,
      );
    }
  
    await enqueueProjectCloneJob(redis, {
      conversationId: result.conversation.id,
      daemonDeviceId: result.daemonDeviceId,
      remoteUrl,
    });
    await invalidateConversationLists(user.id);
  
    return c.json({ conversation: result.conversation }, 201);
  });
  
  openApiRoute(app, "patch", "/conversations/groups/:conversationId", async (c) => {
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
  
    const body = (await c.req.json().catch(() => ({}))) as {
      agentIds?: unknown;
      description?: unknown;
      orchestratorAgentId?: unknown;
      title?: unknown;
    };
    const title = typeof body.title === "string"
      ? normalizeGroupConversationTitle(body.title)
      : "";
    const description = typeof body.description === "string"
      ? body.description.trim()
      : "";
    const key = groupConversationKeyFromTitle(title);
    const orchestratorAgentId = parseOptionalAgentId(body.orchestratorAgentId);
  
    if (
      title.length === 0 ||
      title.length > 80 ||
      key.length > 80 ||
      !isValidAgentIdList(body.agentIds) ||
      (body.orchestratorAgentId !== undefined && orchestratorAgentId === undefined)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_GROUP_REQUEST",
            message:
              "title, 1-20 unique agentIds, and an optional valid orchestratorAgentId are required.",
          },
        },
        400,
      );
    }
  
    const result = await updateGroupConversation(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
      title,
      description: description.length > 0 ? description : undefined,
      agentIds: body.agentIds,
      orchestratorAgentId,
    });
  
    if (result.status === "not-found") {
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
  
    if (result.status === "reserved-key") {
      return c.json(
        {
          error: {
            code: "RESERVED_GROUP_KEY",
            message: "The all group is reserved.",
          },
        },
        409,
      );
    }
  
    if (result.status === "duplicate-key") {
      return c.json(
        {
          error: {
            code: "GROUP_ALREADY_EXISTS",
            message: "A group with this name already exists.",
          },
        },
        409,
      );
    }
  
    if (result.status === "agents-not-found") {
      return c.json(
        {
          error: {
            code: "AGENTS_NOT_FOUND",
            message: "One or more agents were not found.",
          },
        },
        404,
      );
    }
  
    if (result.status === "orchestrator-not-in-group") {
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
    await invalidateConversationDetails({
      conversationId: result.conversation.id,
      ownerUserId: user.id,
    });
  
    return c.json({ conversation: result.conversation });
  });
  
  openApiRoute(app, "patch", "/conversations/projects/:conversationId", async (c) => {
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
  
    const body = (await c.req.json().catch(() => ({}))) as {
      agentIds?: unknown;
      description?: unknown;
      orchestratorAgentId?: unknown;
      title?: unknown;
    };
    const title = typeof body.title === "string"
      ? normalizeGroupConversationTitle(body.title)
      : "";
    const description = typeof body.description === "string"
      ? body.description.trim()
      : "";
    const orchestratorAgentId = parseOptionalAgentId(body.orchestratorAgentId);
  
    if (
      title.length === 0 ||
      title.length > 160 ||
      !isValidAgentIdList(body.agentIds) ||
      (body.orchestratorAgentId !== undefined && orchestratorAgentId === undefined)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_PROJECT_REQUEST",
            message:
              "title, 1-20 unique agentIds, and an optional valid orchestratorAgentId are required.",
          },
        },
        400,
      );
    }
  
    const result = await updateProjectConversation(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
      title,
      description: description.length > 0 ? description : undefined,
      agentIds: body.agentIds,
      orchestratorAgentId,
    });
  
    if (result.status === "not-found") {
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
  
    if (result.status === "agents-not-found") {
      return c.json(
        {
          error: {
            code: "AGENTS_NOT_FOUND",
            message: "One or more ready agents were not found.",
          },
        },
        404,
      );
    }
  
    if (result.status === "agents-not-same-daemon") {
      return c.json(
        {
          error: {
            code: "PROJECT_AGENTS_NOT_SAME_DAEMON",
            message: "Project agents must be ready on the same daemon.",
          },
        },
        400,
      );
    }
  
    if (result.status === "orchestrator-not-in-project") {
      return c.json(
        {
          error: {
            code: "ORCHESTRATOR_NOT_IN_PROJECT",
            message: "Orchestrator must be a member of this project.",
          },
        },
        400,
      );
    }
    await invalidateConversationDetails({
      conversationId: result.conversation.id,
      ownerUserId: user.id,
    });
  
    return c.json({ conversation: result.conversation });
  });
  
  openApiRoute(app, "patch", "/conversations/groups/:conversationId/archive", async (c) => {
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
  
    const result = await archiveGroupConversationForUser(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (result.status === "not-found") {
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
  
    if (result.status === "reserved-key") {
      return c.json(
        {
          error: {
            code: "RESERVED_GROUP_KEY",
            message: "The all group cannot be archived.",
          },
        },
        409,
      );
    }
    await invalidateConversationDetails({
      conversationId: result.conversation.id,
      ownerUserId: user.id,
    });
  
    return c.json({ conversation: result.conversation });
  });
  
  openApiRoute(app, "patch", "/conversations/groups/:conversationId/restore", async (c) => {
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
  
    const result = await restoreGroupConversationForUser(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (result.status === "not-found") {
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
  
    if (result.status === "reserved-key") {
      return c.json(
        {
          error: {
            code: "RESERVED_GROUP_KEY",
            message: "The all group cannot be restored from Saved.",
          },
        },
        409,
      );
    }
    await invalidateConversationDetails({
      conversationId: result.conversation.id,
      ownerUserId: user.id,
    });
  
    return c.json({ conversation: result.conversation });
  });
  
  openApiRoute(app, "delete", "/conversations/groups/:conversationId", async (c) => {
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
  
    const result = await deleteArchivedGroupConversationForUser(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (result.status === "not-found") {
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
  
    if (result.status === "reserved-key") {
      return c.json(
        {
          error: {
            code: "RESERVED_GROUP_KEY",
            message: "The all group cannot be permanently deleted.",
          },
        },
        409,
      );
    }
  
    if (result.status === "not-archived") {
      return c.json(
        {
          error: {
            code: "CONVERSATION_NOT_ARCHIVED",
            message: "Only archived groups can be permanently deleted.",
          },
        },
        400,
      );
    }
    await invalidateConversationDetails({
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    return c.json({ ok: true });
  });
  
  openApiRoute(app, "patch", "/conversations/:conversationId/orchestrator", async (c) => {
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
  
    const body = (await c.req.json().catch(() => ({}))) as {
      orchestratorAgentId?: unknown;
    };
    const orchestratorAgentId = parseOptionalAgentId(body.orchestratorAgentId);
  
    if (
      body.orchestratorAgentId !== undefined &&
      orchestratorAgentId === undefined
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_ORCHESTRATOR_REQUEST",
            message: "orchestratorAgentId must be a valid agent id.",
          },
        },
        400,
      );
    }
  
    const result = await updateConversationOrchestrator(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
      orchestratorAgentId,
    });
  
    if (result.status === "not-found") {
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
  
    if (result.status === "agents-not-found") {
      return c.json(
        {
          error: {
            code: "AGENT_NOT_FOUND",
            message: "Agent was not found.",
          },
        },
        404,
      );
    }
  
    if (result.status === "orchestrator-not-in-group") {
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
    await invalidateConversationDetails({
      conversationId: result.conversation.id,
      ownerUserId: user.id,
    });
  
    return c.json({ conversation: result.conversation });
  });
  
  openApiRoute(app, "post", "/conversations/direct", async (c) => {
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
  
    const body = (await c.req.json().catch(() => ({}))) as {
      agentId?: unknown;
    };
  
    if (typeof body.agentId !== "string" || body.agentId.length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_CONVERSATION_REQUEST",
            message: "agentId is required.",
          },
        },
        400,
      );
    }
  
    const conversation = await ensureDirectConversation(db, {
      agentId: body.agentId,
      ownerUserId: user.id,
    });
  
    if (conversation === null) {
      return c.json(
        {
          error: {
            code: "AGENT_NOT_FOUND",
            message: "Agent was not found.",
          },
        },
        404,
      );
    }
    await invalidateConversationLists(user.id);
  
    return c.json({ conversation }, 200);
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/messages", async (c) => {
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
  
    const rawLimit = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
      : 50;
    const beforeQuery = c.req.query("before");
    const before =
      beforeQuery === undefined || beforeQuery.length === 0
        ? undefined
        : new Date(beforeQuery);
  
    if (before !== undefined && Number.isNaN(before.getTime())) {
      return c.json(
        {
          error: {
            code: "INVALID_MESSAGES_REQUEST",
            message: "before must be an ISO date string.",
          },
        },
        400,
      );
    }
  
    const conversationId = c.req.param("conversationId");
    const messages = await cachedJson(
      redis,
      {
        key: conversationMessagesCacheKey({
          before: before?.toISOString(),
          conversationId,
          limit,
        }),
        logger,
        ttlSeconds: cacheTtlSeconds.conversationDetail,
      },
      () => listConversationMessagesForUser(db, {
        conversationId,
        ownerUserId: user.id,
        limit,
        before,
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
        publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      }),
    );
  
    if (messages === null) {
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
  
    return c.json({ messages });
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/tasks", async (c) => {
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
  
    const conversationId = c.req.param("conversationId");
    const goals = await cachedJson(
      redis,
      {
        key: conversationTasksCacheKey(conversationId),
        logger,
        ttlSeconds: cacheTtlSeconds.conversationDetail,
      },
      () => listConversationGoalsForUser(db, {
        conversationId,
        ownerUserId: user.id,
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
        publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      }),
    );
  
    if (goals === null) {
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
  
    return c.json({ goals });
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/artifacts", async (c) => {
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
  
    const conversationId = c.req.param("conversationId");
    const artifacts = await cachedJson(
      redis,
      {
        key: conversationArtifactsCacheKey(conversationId),
        logger,
        ttlSeconds: cacheTtlSeconds.conversationDetail,
      },
      () => listConversationArtifactsForUser(db, {
        conversationId,
        ownerUserId: user.id,
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
        publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      }),
    );
  
    if (artifacts === null) {
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
  
    return c.json({ artifacts });
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/deployments", async (c) => {
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
  
    const conversationId = c.req.param("conversationId");
    const deployments = await cachedJson(
      redis,
      {
        key: conversationDeploymentsCacheKey(conversationId),
        logger,
        ttlSeconds: cacheTtlSeconds.conversationDetail,
      },
      () => listConversationDeploymentsForUser(db, {
        conversationId,
        ownerUserId: user.id,
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      }),
    );
  
    if (deployments === null) {
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
  
    return c.json({ deployments });
  });

  return app;
}
