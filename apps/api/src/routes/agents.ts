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
  normalizeAgentTags,
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
  invalidateUserSidebarCache,
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
  userAgentsCacheKey,
  type RunnableAgent,
  type RunQueueJob,
  type UserMessageAttachmentUpload,
} from "@agent-hub/server";
import { OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth, type AppBindings } from "../auth/middleware.js";
import type { ApiRouteContext } from "../context.js";
import { openApiRoute } from "./openapi.js";

export function createAgentsRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    isRuntimeKind,
    parseRecordStatusFilter,
    todayUtcDate,
    readAgentMemoryFile,
    listAgentDailyMemoryFiles,
    memoryDatePattern,
  } = context.services;

  app.use("/agents", requireAuth);
  app.use("/agents/*", requireAuth);
  openApiRoute(app, "get", "/agents", async (c) => {
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
      agents: await cachedJson(
        redis,
        {
          key: userAgentsCacheKey({ status: status ?? "default", userId: user.id }),
          logger,
          ttlSeconds: cacheTtlSeconds.sidebar,
        },
        () => listAgentsForUser(db, {
          ownerUserId: user.id,
          status,
        }),
      ),
    });
  });
  
  openApiRoute(app, "post", "/agents", async (c) => {
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
      name?: unknown;
      description?: unknown;
      tags?: unknown;
      avatar?: unknown;
      daemonDeviceId?: unknown;
      runtimeKind?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" && body.description.trim().length > 0
        ? body.description.trim()
        : undefined;
    const avatar = body.avatar === undefined
      ? undefined
      : isDefaultAvatarPath(body.avatar)
      ? body.avatar
      : null;
    const hasTags = Object.hasOwn(body, "tags");
    const tags = hasTags ? normalizeAgentTags(body.tags) : { tags: [] };
  
    if (
      name.length === 0 ||
      name.length > 120 ||
      tags.error !== undefined ||
      avatar === null ||
      typeof body.daemonDeviceId !== "string" ||
      body.daemonDeviceId.length === 0 ||
      !isRuntimeKind(body.runtimeKind)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_AGENT_REQUEST",
            message:
              "name, avatar, daemonDeviceId, a supported runtimeKind, and up to 6 tags of 20 characters each are required.",
          },
        },
        400,
      );
    }
  
    const runtime = await getReadyDaemonRuntime(db, {
      daemonDeviceId: body.daemonDeviceId,
      runtimeKind: body.runtimeKind,
    });
  
    if (runtime === null) {
      return c.json(
        {
          error: {
            code: "RUNTIME_UNAVAILABLE",
            message: "Selected daemon runtime is not available.",
          },
        },
        400,
      );
    }
  
    const createdAt = new Date();
    const agent = await createAgentProvisioningRecords(db, {
      id: randomUUID(),
      ownerUserId: user.id,
      name,
      description,
      tags: tags.tags,
      avatar: avatar ?? undefined,
      runtime,
      createdAt,
    });
    const queueMessageId = await enqueueAgentProvisioningJob(redis, {
      agent: agent.agent,
      daemonDeviceId: runtime.daemonDeviceId,
      runtime: {
        runtimeKind: runtime.runtimeKind,
        runtimeVersion: runtime.runtimeVersion,
        executablePath: runtime.executablePath,
        capabilities: runtime.capabilities,
        updatedAt: createdAt.toISOString(),
      },
    });
    await invalidateUserSidebarCache(redis, { logger, userId: user.id });
  
    return c.json({ agent, queueMessageId }, 202);
  });
  
  openApiRoute(app, "get", "/agents/:agentId", async (c) => {
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
  
    const agent = await getAgentForUser(db, {
      agentId: c.req.param("agentId"),
      ownerUserId: user.id,
    });
  
    if (agent === null) {
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
    await invalidateUserSidebarCache(redis, { logger, userId: user.id });
  
    return c.json({ agent });
  });
  
  openApiRoute(app, "get", "/agents/:agentId/memory", async (c) => {
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
  
    const date = c.req.query("date") ?? todayUtcDate();
    if (!memoryDatePattern.test(date)) {
      return c.json(
        {
          error: {
            code: "INVALID_MEMORY_DATE",
            message: "date must use yyyy-mm-dd format.",
          },
        },
        400,
      );
    }
  
    const agent = await getAgentForUser(db, {
      agentId: c.req.param("agentId"),
      ownerUserId: user.id,
    });
  
    if (agent === null) {
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
  
    const workspacePath = agent.workspace.workspacePath;
    if (workspacePath === undefined) {
      return c.json({
        date,
        files: [],
        workspaceReady: false,
      });
    }
  
    const dailyMemoryFiles = await listAgentDailyMemoryFiles({
      fallbackDate: date,
      workspacePath,
    });
    const files = await Promise.all([
      readAgentMemoryFile({
        workspacePath,
        scope: "long_term",
        label: "MEMORY.md",
        file: "MEMORY.md",
      }),
      ...dailyMemoryFiles.map((file) =>
        readAgentMemoryFile({
          workspacePath,
          scope: "daily",
          label: file,
          file: path.join("memory", file),
        })
      ),
    ]);
  
    return c.json({
      date,
      files,
      workspaceReady: true,
    });
  });
  
  openApiRoute(app, "patch", "/agents/:agentId", async (c) => {
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
      description?: unknown;
      name?: unknown;
      tags?: unknown;
      avatar?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" && body.description.trim().length > 0
        ? body.description.trim()
        : undefined;
    const avatar = body.avatar === undefined
      ? undefined
      : isDefaultAvatarPath(body.avatar)
      ? body.avatar
      : null;
    const hasTags = Object.hasOwn(body, "tags");
    const tags = hasTags ? normalizeAgentTags(body.tags) : { tags: [] };
  
    if (name.length === 0 || name.length > 120 || tags.error !== undefined || avatar === null) {
      return c.json(
        {
          error: {
            code: "INVALID_AGENT_REQUEST",
            message:
              "name is required, must be 120 characters or fewer, tags are limited to 6 items of 20 characters each, and avatar must be a default avatar.",
          },
        },
        400,
      );
    }
  
    const agent = await updateAgentProfileForUser(db, {
      agentId: c.req.param("agentId"),
      ownerUserId: user.id,
      name,
      description,
      ...(hasTags ? { tags: tags.tags } : {}),
      avatar,
    });
  
    if (agent === null) {
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
    await invalidateUserSidebarCache(redis, { logger, userId: user.id });
  
    return c.json({ agent });
  });
  
  openApiRoute(app, "patch", "/agents/:agentId/archive", async (c) => {
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
  
    const result = await archiveAgentForUser(db, {
      agentId: c.req.param("agentId"),
      ownerUserId: user.id,
    });
  
    if (result.status === "not-found") {
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
    await invalidateUserSidebarCache(redis, { logger, userId: user.id });
  
    return c.json({ agent: result.agent });
  });
  
  openApiRoute(app, "patch", "/agents/:agentId/restore", async (c) => {
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
  
    const result = await restoreAgentForUser(db, {
      agentId: c.req.param("agentId"),
      ownerUserId: user.id,
    });
  
    if (result.status === "not-found") {
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
    await invalidateUserSidebarCache(redis, { logger, userId: user.id });
  
    return c.json({ agent: result.agent });
  });
  
  openApiRoute(app, "delete", "/agents/:agentId", async (c) => {
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
  
    const result = await deleteArchivedAgentForUser(db, {
      agentId: c.req.param("agentId"),
      ownerUserId: user.id,
    });
  
    if (result.status === "not-found") {
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
  
    if (result.status === "not-archived") {
      return c.json(
        {
          error: {
            code: "AGENT_NOT_ARCHIVED",
            message: "Only archived agents can be permanently deleted.",
          },
        },
        400,
      );
    }
    await invalidateUserSidebarCache(redis, { logger, userId: user.id });
  
    return c.json({ ok: true });
  });

  return app;
}
