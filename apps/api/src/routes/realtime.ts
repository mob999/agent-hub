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

type SseClient = ApiRouteContext["services"]["sseClientsByUserId"] extends Map<string, Set<infer Client>>
  ? Client
  : never;

export function createRealtimeRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    sseClientsByUserId,
    sseFrame,
    unregisterSseClient,
  } = context.services;

  app.use("/events", requireAuth);
  openApiRoute(app, "get", "/events", async (c) => {
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
  
    const client: SseClient = {
      controller: undefined as unknown as ReadableStreamDefaultController<Uint8Array>,
      heartbeat: null,
      id: randomUUID(),
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        client.controller = controller;
        const clients = sseClientsByUserId.get(user.id) ?? new Set<SseClient>();
        clients.add(client);
        sseClientsByUserId.set(user.id, clients);
        controller.enqueue(
          sseFrame("connected", {
            connectedAt: new Date().toISOString(),
            clientId: client.id,
          }),
        );
        client.heartbeat = setInterval(() => {
          try {
            controller.enqueue(
              sseFrame("heartbeat", {
                sentAt: new Date().toISOString(),
              }),
            );
          } catch (error) {
            logger.warn({ err: error, clientId: client.id }, "SSE heartbeat failed");
            unregisterSseClient(user.id, client);
          }
        }, 25000);
      },
      cancel() {
        unregisterSseClient(user.id, client);
      },
    });
  
    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
    });
  });

  return app;
}
