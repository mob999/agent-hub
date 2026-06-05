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

export function createRunsRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    publishRealtimeEvents,
    buildAgentGroupsPromptForAgent,
  } = context.services;

  app.use("/runs", requireAuth);
  app.use("/runs/*", requireAuth);
  openApiRoute(app, "get", "/runs", async (c) => {
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
  
    const limitParam = c.req.query("limit");
    const parsedLimit =
      limitParam === undefined ? undefined : Number.parseInt(limitParam, 10);
    const limit =
      parsedLimit === undefined || Number.isNaN(parsedLimit)
        ? 50
        : Math.min(Math.max(parsedLimit, 1), 100);
    const runs = await listRunsForUser(db, {
      ownerUserId: user.id,
      limit,
    });
  
    return c.json({ runs });
  });
  
  openApiRoute(app, "post", "/runs", async (c) => {
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
      agentId?: string;
      daemonDeviceId?: string;
      prompt?: string;
      workspacePath?: string;
    };
    const prompt = body.prompt;
  
    if (
      typeof prompt !== "string" ||
      prompt.length === 0
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_RUN_REQUEST",
            message:
              "prompt is required.",
          },
        },
        400,
      );
    }
  
    const now = new Date().toISOString();
    let agentId = body.agentId;
    let daemonDeviceId = body.daemonDeviceId;
    let workspacePath = body.workspacePath;
    let agentInstructions: string | undefined;
    let agentHubMcpTools: AgentHubMcpToolName[] | undefined;
    let runPrompt = prompt;
    let runtime: RunQueueJob["runtime"] = {
      runtimeKind: "codex",
      capabilities: [],
      updatedAt: now,
    };
  
    if (typeof agentId === "string" && agentId.length > 0) {
      const runnableAgent = await getRunnableAgentForUser(db, {
        agentId,
        ownerUserId: user.id,
      });
  
      if (runnableAgent === null) {
        const existingAgent = await getAgentForUser(db, {
          agentId,
          ownerUserId: user.id,
        });
  
        return c.json(
          {
            error: {
              code: existingAgent === null ? "AGENT_NOT_FOUND" : "AGENT_NOT_READY",
              message: existingAgent === null
                ? "Agent was not found."
                : "Agent is not ready to run yet.",
            },
          },
          existingAgent === null ? 404 : 400,
        );
      }
  
      daemonDeviceId = runnableAgent.daemonDeviceId;
      workspacePath = runnableAgent.workspacePath;
      agentInstructions = buildAgentIdentityInstructions({
        agentDescription: runnableAgent.agent.description,
        agentName: runnableAgent.agent.name,
        scenario: "manual run",
      });
      agentHubMcpTools = [...agentHubNonOrchestratorMcpTools];
      runPrompt = [
        await buildAgentGroupsPromptForAgent({
          agentId: runnableAgent.agent.id,
          ownerUserId: user.id,
        }),
        prompt,
      ].join("\n\n");
      runtime = runnableAgent.runtime;
    } else {
      agentId = env.AGENTHUB_DEFAULT_AGENT_ID;
      daemonDeviceId = daemonDeviceId ?? env.AGENTHUB_DEFAULT_DAEMON_DEVICE_ID;
      workspacePath = workspacePath ?? env.AGENTHUB_DEFAULT_WORKSPACE_PATH;
    }
  
    if (
      agentId === undefined ||
      daemonDeviceId === undefined ||
      workspacePath === undefined
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_RUN_REQUEST",
            message:
              "agentId, daemonDeviceId, and workspacePath must come from a ready agent or be configured as defaults.",
          },
        },
        400,
      );
    }
  
    const job: RunQueueJob = {
      daemonDeviceId,
      prompt: runPrompt,
      agentInstructions,
      agentHubMcpTools,
      workspacePath,
      run: {
        id: randomUUID(),
        agentId,
        daemonDeviceId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      },
      runtime,
    };
  
    await createRunRecord(db, {
      ownerUserId: user.id,
      job,
    });
    const appendResult = await appendRunEvent(db, {
      type: "run.queued",
      runId: job.run.id,
      agentId: job.run.agentId,
      daemonDeviceId: job.run.daemonDeviceId,
      createdAt: now,
    });
    const queueMessageId = await enqueueRunJob(redis, job);
    await Promise.all(
      appendResult.memoryAppendJobs.map((memoryJob) =>
        enqueueMemoryAppendJob(redis, memoryJob)
      ),
    );
    await publishRealtimeEvents(appendResult.realtimeEvents);
  
    return c.json(
      {
        run: job.run,
        queueMessageId,
      },
      202,
    );
  });
  
  openApiRoute(app, "get", "/runs/:runId", async (c) => {
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
  
    const run = await getRunForUser(db, {
      runId: c.req.param("runId"),
      ownerUserId: user.id,
    });
  
    if (run === null) {
      return c.json(
        {
          error: {
            code: "RUN_NOT_FOUND",
            message: "Run was not found.",
          },
        },
        404,
      );
    }
  
    return c.json({
      run: toAgentRun(run),
      job: {
        prompt: run.prompt,
        workspacePath: run.workspacePath,
        runtime: run.runtime,
      },
    });
  });
  
  openApiRoute(app, "get", "/runs/:runId/events", async (c) => {
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
  
    const events = await getRunEventsForUser(db, {
      runId: c.req.param("runId"),
      ownerUserId: user.id,
    });
  
    if (events === null) {
      return c.json(
        {
          error: {
            code: "RUN_NOT_FOUND",
            message: "Run was not found.",
          },
        },
        404,
      );
    }
  
    return c.json({
      events,
    });
  });

  return app;
}
