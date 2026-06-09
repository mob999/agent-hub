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

export function createConversationProjectRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db } = context;
  const {
    projectChangeStatuses,
    requestDaemonProjectRpc,
  } = context.services;

  function daemonProjectError(input: {
    defaultCode: string;
    defaultStatus: 404 | 500;
    error: unknown;
  }): { code: string; message: string; status: 404 | 500 | 503 } {
    const errorRecord = typeof input.error === "object" && input.error !== null
      ? input.error as { code?: unknown; status?: unknown }
      : {};
    const code = typeof errorRecord.code === "string"
      ? errorRecord.code
      : input.defaultCode;
    const status = errorRecord.status === 503 ? 503 : input.defaultStatus;

    return {
      code,
      message: input.error instanceof Error ? input.error.message : String(input.error),
      status,
    };
  }

  app.use("/conversations/*", requireAuth);

  openApiRoute(app, "get", "/conversations/:conversationId/project/changes", async (c) => {
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
  
    const status = c.req.query("status");
    if (status !== undefined && !projectChangeStatuses.has(status)) {
      return c.json(
        {
          error: {
            code: "INVALID_PROJECT_CHANGE_STATUS",
            message: "Project change status filter is invalid.",
          },
        },
        400,
      );
    }
  
    const changes = await listProjectChangesForConversation(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
      status: status as "open" | "merged" | "rejected" | "failed" | undefined,
    });
  
    if (changes === null) {
      return c.json(
        {
          error: {
            code: "PROJECT_NOT_FOUND",
            message: "Project conversation was not found.",
          },
        },
        404,
      );
    }
  
    return c.json({ changes });
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/project/changes/:changeId", async (c) => {
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
  
    const result = await getProjectChangeWithDiffForConversation(db, {
      changeId: c.req.param("changeId"),
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (result === null) {
      return c.json(
        {
          error: {
            code: "PROJECT_CHANGE_NOT_FOUND",
            message: "Project change was not found.",
          },
        },
        404,
      );
    }
  
    return c.json(result);
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/project/changes/:changeId/files", async (c) => {
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
  
    const [result, project] = await Promise.all([
      getProjectChangeWithDiffForConversation(db, {
        changeId: c.req.param("changeId"),
        conversationId: c.req.param("conversationId"),
        ownerUserId: user.id,
      }),
      getProjectForConversation(db, {
        conversationId: c.req.param("conversationId"),
        ownerUserId: user.id,
      }),
    ]);
  
    if (result === null || project === null || project.cloneStatus !== "ready") {
      return c.json(
        {
          error: {
            code: "PROJECT_CHANGE_NOT_FOUND",
            message: "Project change was not found.",
          },
        },
        404,
      );
    }
  
    try {
      const daemonResult = await requestDaemonProjectRpc({
        daemonDeviceId: project.daemonDeviceId,
        operation: {
          type: "project.change.files.list",
          baseCommit: result.change.baseCommit,
          headCommit: result.change.headCommit,
          worktreePath: result.change.worktreePath,
        },
      });

      if (daemonResult.type !== "project.change.files.list") {
        throw new Error("Unexpected daemon project response.");
      }

      return c.json({
        files: daemonResult.files,
      });
    } catch (error) {
      const routeError = daemonProjectError({
        defaultCode: "PROJECT_CHANGE_FILES_UNAVAILABLE",
        defaultStatus: 500,
        error,
      });
      return c.json(
        {
          error: {
            code: routeError.code,
            message: routeError.message,
          },
        },
        routeError.status,
      );
    }
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/project/changes/:changeId/files/content", async (c) => {
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
  
    const requestedPath = c.req.query("path");
    const [result, project] = await Promise.all([
      getProjectChangeWithDiffForConversation(db, {
        changeId: c.req.param("changeId"),
        conversationId: c.req.param("conversationId"),
        ownerUserId: user.id,
      }),
      getProjectForConversation(db, {
        conversationId: c.req.param("conversationId"),
        ownerUserId: user.id,
      }),
    ]);
  
    if (requestedPath === undefined || result === null || project === null || project.cloneStatus !== "ready") {
      return c.json(
        {
          error: {
            code: "PROJECT_CHANGE_FILE_NOT_FOUND",
            message: "Project change file was not found.",
          },
        },
        404,
      );
    }
  
    try {
      const daemonResult = await requestDaemonProjectRpc({
        daemonDeviceId: project.daemonDeviceId,
        operation: {
          type: "project.change.file.read",
          baseCommit: result.change.baseCommit,
          headCommit: result.change.headCommit,
          path: requestedPath,
          worktreePath: result.change.worktreePath,
        },
      });
  
      if (daemonResult.type !== "project.change.file.read") {
        throw new Error("Unexpected daemon project response.");
      }
  
      return c.json({
        binary: daemonResult.binary,
        file: daemonResult.file,
        newContent: daemonResult.newContent,
        oldContent: daemonResult.oldContent,
      });
    } catch (error) {
      const routeError = daemonProjectError({
        defaultCode: "PROJECT_CHANGE_FILE_UNAVAILABLE",
        defaultStatus: 500,
        error,
      });
      return c.json(
        {
          error: {
            code: routeError.code,
            message: routeError.message,
          },
        },
        routeError.status,
      );
    }
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/project/files", async (c) => {
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
  
    const project = await getProjectForConversation(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (project === null || project.cloneStatus !== "ready" || project.baseRepoPath === undefined) {
      return c.json(
        {
          error: {
            code: "PROJECT_NOT_READY",
            message: "Project repository is not ready.",
          },
        },
        404,
      );
    }
  
    try {
      const daemonResult = await requestDaemonProjectRpc({
        daemonDeviceId: project.daemonDeviceId,
        operation: {
          type: "project.files.list",
          baseRepoPath: project.baseRepoPath,
        },
      });

      if (daemonResult.type !== "project.files.list") {
        throw new Error("Unexpected daemon project response.");
      }

      return c.json({
        files: daemonResult.files,
      });
    } catch (error) {
      const routeError = daemonProjectError({
        defaultCode: "PROJECT_FILES_UNAVAILABLE",
        defaultStatus: 500,
        error,
      });
      return c.json(
        {
          error: {
            code: routeError.code,
            message: routeError.message,
          },
        },
        routeError.status,
      );
    }
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/project/files/raw", async (c) => {
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
  
    const requestedPath = c.req.query("path");
    const project = await getProjectForConversation(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (
      requestedPath === undefined ||
      project === null ||
      project.cloneStatus !== "ready" ||
      project.baseRepoPath === undefined
    ) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILE_NOT_FOUND",
            message: "Project file was not found.",
          },
        },
        404,
      );
    }
  
    try {
      const fileInfo = inferArtifactFileInfo({ filename: requestedPath });
      const daemonResult = await requestDaemonProjectRpc({
        daemonDeviceId: project.daemonDeviceId,
        operation: {
          type: "project.file.read",
          baseRepoPath: project.baseRepoPath,
          path: requestedPath,
        },
      });

      if (daemonResult.type !== "project.file.read") {
        throw new Error("Unexpected daemon project response.");
      }

      const content = Buffer.from(daemonResult.contentBase64, "base64");
  
      return new Response(content, {
        headers: {
          "content-type": fileInfo.mimeType,
        },
      });
    } catch (error) {
      const routeError = daemonProjectError({
        defaultCode: "PROJECT_FILE_NOT_FOUND",
        defaultStatus: 404,
        error,
      });
      return c.json(
        {
          error: {
            code: routeError.code,
            message: routeError.message,
          },
        },
        routeError.status,
      );
    }
  });
  
  openApiRoute(app, "get", "/conversations/:conversationId/project/files/content", async (c) => {
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
  
    const requestedPath = c.req.query("path");
    const project = await getProjectForConversation(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (
      requestedPath === undefined ||
      project === null ||
      project.cloneStatus !== "ready" ||
      project.baseRepoPath === undefined
    ) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILE_NOT_FOUND",
            message: "Project file was not found.",
          },
        },
        404,
      );
    }
  
    try {
      const daemonResult = await requestDaemonProjectRpc({
        daemonDeviceId: project.daemonDeviceId,
        operation: {
          type: "project.file.read",
          baseRepoPath: project.baseRepoPath,
          path: requestedPath,
        },
      });

      if (daemonResult.type !== "project.file.read") {
        throw new Error("Unexpected daemon project response.");
      }

      const content = Buffer.from(daemonResult.contentBase64, "base64").toString("utf8");
      return c.json({ content, path: requestedPath });
    } catch (error) {
      const routeError = daemonProjectError({
        defaultCode: "PROJECT_FILE_NOT_FOUND",
        defaultStatus: 404,
        error,
      });
      return c.json(
        {
          error: {
            code: routeError.code,
            message: routeError.message,
          },
        },
        routeError.status,
      );
    }
  });
  
  openApiRoute(app, "put", "/conversations/:conversationId/project/files/content", async (c) => {
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
  
    const body = await c.req.json<{ content?: unknown; path?: unknown }>().catch(() => null);
    const requestedPath = typeof body?.path === "string" ? body.path : undefined;
    const content = typeof body?.content === "string" ? body.content : undefined;
    const project = await getProjectForConversation(db, {
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (
      requestedPath === undefined ||
      content === undefined ||
      project === null ||
      project.cloneStatus !== "ready" ||
      project.baseRepoPath === undefined
    ) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILE_NOT_FOUND",
            message: "Project file was not found.",
          },
        },
        404,
      );
    }
  
    const fileInfo = inferArtifactFileInfo({ filename: requestedPath });
    if (!fileInfo.canEdit) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILE_NOT_EDITABLE",
            message: "Project file cannot be edited as text.",
          },
        },
        400,
      );
    }
  
    try {
      const daemonResult = await requestDaemonProjectRpc({
        daemonDeviceId: project.daemonDeviceId,
        operation: {
          type: "project.file.write",
          baseRepoPath: project.baseRepoPath,
          content,
          path: requestedPath,
        },
      });

      if (daemonResult.type !== "project.file.write") {
        throw new Error("Unexpected daemon project response.");
      }
      const baseHead = daemonResult.baseHead;
  
      await markProjectBaseHead(db, {
        baseHead,
        conversationId: project.conversationId,
      });
  
      return c.json({ baseHead, content, path: requestedPath });
    } catch (error) {
      const routeError = daemonProjectError({
        defaultCode: "PROJECT_FILE_SAVE_FAILED",
        defaultStatus: 500,
        error,
      });
      return c.json(
        {
          error: {
            code: routeError.code,
            message: routeError.message,
          },
        },
        routeError.status,
      );
    }
  });

  return app;
}
