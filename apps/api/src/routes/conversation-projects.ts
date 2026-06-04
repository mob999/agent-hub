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

export function createConversationProjectRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    listProjectFileTree,
    listProjectChangedFiles,
    readProjectFileAtCommit,
    commitProjectBaseFile,
    projectChangeStatuses,
    resolveProjectFilePath,
  } = context.services;

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
  
    try {
      return c.json({
        files: await listProjectChangedFiles({
          baseCommit: result.change.baseCommit,
          headCommit: result.change.headCommit,
          worktreePath: result.change.worktreePath,
        }),
      });
    } catch (error) {
      return c.json(
        {
          error: {
            code: "PROJECT_CHANGE_FILES_UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        500,
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
    const result = await getProjectChangeWithDiffForConversation(db, {
      changeId: c.req.param("changeId"),
      conversationId: c.req.param("conversationId"),
      ownerUserId: user.id,
    });
  
    if (requestedPath === undefined || result === null) {
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
      const files = await listProjectChangedFiles({
        baseCommit: result.change.baseCommit,
        headCommit: result.change.headCommit,
        worktreePath: result.change.worktreePath,
      });
      const file = files.find((entry) => entry.path === requestedPath || entry.oldPath === requestedPath);
  
      if (file === undefined) {
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
  
      if (file.binary) {
        return c.json({
          binary: true,
          file,
          newContent: "",
          oldContent: "",
        });
      }
  
      const oldContent = file.status === "added"
        ? ""
        : await readProjectFileAtCommit({
            commit: result.change.baseCommit,
            filePath: file.oldPath ?? file.path,
            worktreePath: result.change.worktreePath,
          });
      const newContent = file.status === "deleted"
        ? ""
        : await readProjectFileAtCommit({
            commit: result.change.headCommit,
            filePath: file.path,
            worktreePath: result.change.worktreePath,
          });
  
      return c.json({
        binary: false,
        file,
        newContent,
        oldContent,
      });
    } catch (error) {
      return c.json(
        {
          error: {
            code: "PROJECT_CHANGE_FILE_UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        500,
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
      return c.json({
        files: await listProjectFileTree({ baseRepoPath: project.baseRepoPath }),
      });
    } catch (error) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILES_UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        500,
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
      const filePath = resolveProjectFilePath(project.baseRepoPath, requestedPath);
      const fileInfo = inferArtifactFileInfo({ filename: requestedPath });
      const content = await readFile(filePath);
  
      return new Response(content, {
        headers: {
          "content-type": fileInfo.mimeType,
        },
      });
    } catch (error) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILE_NOT_FOUND",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        404,
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
      const filePath = resolveProjectFilePath(project.baseRepoPath, requestedPath);
      const content = await readFile(filePath, "utf8");
      return c.json({ content, path: requestedPath });
    } catch (error) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILE_NOT_FOUND",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        404,
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
      const filePath = resolveProjectFilePath(project.baseRepoPath, requestedPath);
      const fileStat = await stat(filePath);
  
      if (!fileStat.isFile()) {
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
  
      await writeFile(filePath, content, "utf8");
      const baseHead = await commitProjectBaseFile({
        baseRepoPath: project.baseRepoPath,
        relativePath: requestedPath,
      });
  
      await markProjectBaseHead(db, {
        baseHead,
        conversationId: project.conversationId,
      });
  
      return c.json({ baseHead, content, path: requestedPath });
    } catch (error) {
      return c.json(
        {
          error: {
            code: "PROJECT_FILE_SAVE_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        500,
      );
    }
  });

  return app;
}
