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

export function createSearchRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    parseSearchSort,
    parseSearchTimeFilter,
    parseSenderType,
    uuidPattern,
  } = context.services;

  app.use("/search", requireAuth);
  openApiRoute(app, "get", "/search", async (c) => {
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
  
    const query = c.req.query("query")?.trim() ?? "";
    const channelId = c.req.query("channelId");
    const senderAgentId = c.req.query("senderAgentId");
    const senderType = parseSenderType(c.req.query("senderType"));
    const sort = parseSearchSort(c.req.query("sort"));
    const timeFilter = parseSearchTimeFilter(c.req.query("timeFilter"));
    const limitRaw = c.req.query("limit");
    const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
  
    if (
      query.length === 0 ||
      query.length > 200 ||
      (channelId !== undefined && !uuidPattern.test(channelId)) ||
      (senderAgentId !== undefined && !uuidPattern.test(senderAgentId)) ||
      senderType === null ||
      sort === null ||
      timeFilter === null ||
      (limit !== undefined && (!Number.isFinite(limit) || limit <= 0))
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_SEARCH_REQUEST",
            message:
              "query (1-200) is required; optional channelId/senderAgentId must be UUID; senderType/sort/timeFilter must be valid.",
          },
        },
        400,
      );
    }
  
    return c.json(
      await searchConversationsForUser(db, {
        ownerUserId: user.id,
        query,
        channelId,
        senderAgentId,
        senderType: senderType ?? undefined,
        sort: sort ?? undefined,
        timeFilter: timeFilter ?? undefined,
        limit,
      }),
    );
  });

  return app;
}
