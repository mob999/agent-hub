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
  invalidateConversationCache,
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

export function createArtifactsRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    isMissingFileError,
    publishRealtimeEvents,
    previewUnavailableResponse,
    deploymentResponse,
    getDeploymentRequestedPath,
  } = context.services;
  const invalidateArtifactConversation = (input: {
    conversationId: string;
    ownerUserId: string;
  }) => invalidateConversationCache(redis, { ...input, logger });

  app.use("/artifacts/*", requireAuth);
  openApiRoute(app, "get", "/artifacts/:artifactId", async (c) => {
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
  
    const details = await getConversationArtifactDetailsForUser(db, {
      artifactId: c.req.param("artifactId"),
      ownerUserId: user.id,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
    });
  
    if (details === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_NOT_FOUND",
            message: "Artifact was not found.",
          },
        },
        404,
      );
    }
  
    return c.json(details);
  });
  
  openApiRoute(app, "get", "/artifacts/:artifactId/content", async (c) => {
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
  
    const content = await getConversationArtifactContentForUser(db, {
      artifactId: c.req.param("artifactId"),
      ownerUserId: user.id,
      revisionId: c.req.query("revisionId"),
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
    }).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return null;
      }
  
      throw error;
    });
  
    if (content === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_NOT_FOUND",
            message: "Artifact content was not found.",
          },
        },
        404,
      );
    }
  
    return c.json(content);
  });
  
  openApiRoute(app, "get", "/artifacts/:artifactId/preview/*", async (c) => {
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
  
    const details = await getConversationArtifactDetailsForUser(db, {
      artifactId: c.req.param("artifactId"),
      ownerUserId: user.id,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
    });
  
    if (details === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_NOT_FOUND",
            message: "Artifact was not found.",
          },
        },
        404,
      );
    }
  
    const suffix = c.req.param("*") ?? "";
    const fileInfo = inferArtifactFileInfo({
      filename: details.artifact.filename,
    });
  
    if (!fileInfo.canPreview) {
      return previewUnavailableResponse({
        message: "This artifact type does not support inline preview.",
        status: 404,
      });
    }
  
    if (suffix.length > 0) {
      return previewUnavailableResponse({
        message:
          "This preview is a single uploaded file and does not include the requested asset path.",
        status: 404,
      });
    }
  
    const record = await getConversationArtifactForUser(db, {
      artifactId: details.artifact.id,
      ownerUserId: user.id,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
    });
  
    if (record === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_NOT_FOUND",
            message: "Artifact was not found.",
          },
        },
        404,
      );
    }
  
    const body = await readArtifactContent({
      storageKey: record.storageKey,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
    }).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return null;
      }
  
      throw error;
    });
  
    if (body === null) {
      return previewUnavailableResponse({
        message: "Artifact file was not found on disk.",
        status: 404,
      });
    }
    const arrayBuffer = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
  
    return new Response(arrayBuffer, {
      headers: {
        "cache-control": "no-store",
        "content-type": fileInfo.mimeType,
      },
      status: 200,
    });
  });
  
  openApiRoute(app, "get", "/deployments/:deploymentId", async (c) => {
    const user = c.get("user");
    const deploymentId = c.req.param("deploymentId");
  
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
  
    const redirectUrl = new URL(c.req.url);
    redirectUrl.pathname = `/deployments/${deploymentId}/`;
    return c.redirect(redirectUrl.toString(), 302);
  });
  
  openApiRoute(app, "get", "/deployments/:deploymentId/*", async (c) => {
    const user = c.get("user");
    const deploymentId = c.req.param("deploymentId");
  
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
  
    return deploymentResponse({
      deploymentId,
      ownerUserId: user.id,
      requestedPath: getDeploymentRequestedPath({
        deploymentId,
        requestUrl: c.req.url,
      }),
    });
  });
  
  openApiRoute(app, "get", "/artifacts/:artifactId/files", async (c) => {
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
  
    const files = await listConversationArtifactFilesForUser(db, {
      artifactId: c.req.param("artifactId"),
      ownerUserId: user.id,
    });
  
    if (files === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_NOT_FOUND",
            message: "Site artifact was not found.",
          },
        },
        404,
      );
    }
  
    return c.json({ files });
  });
  
  openApiRoute(app, "get", "/artifacts/:artifactId/files/content", async (c) => {
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
  
    const filePath = c.req.query("path");
    if (filePath === undefined || filePath.trim().length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_ARTIFACT_FILE_REQUEST",
            message: "path is required.",
          },
        },
        400,
      );
    }
  
    const result = await getConversationArtifactFileContentForUser(db, {
      artifactId: c.req.param("artifactId"),
      ownerUserId: user.id,
      path: filePath,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
    });
  
    if (result === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_FILE_NOT_FOUND",
            message: "Artifact file was not found.",
          },
        },
        404,
      );
    }
  
    return c.json(result);
  });
  
  openApiRoute(app, "get", "/artifacts/:artifactId/files/raw", async (c) => {
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
  
    const filePath = c.req.query("path");
    if (filePath === undefined || filePath.trim().length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_ARTIFACT_FILE_REQUEST",
            message: "path is required.",
          },
        },
        400,
      );
    }
  
    const result = await getConversationArtifactFileRawContentForUser(db, {
      artifactId: c.req.param("artifactId"),
      ownerUserId: user.id,
      path: filePath,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
    }).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return null;
      }
  
      throw error;
    });
  
    if (result === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_FILE_NOT_FOUND",
            message: "Artifact file was not found.",
          },
        },
        404,
      );
    }
  
    const filename = result.file.path.split("/").pop() ?? "file";
  
    return new Response(new Uint8Array(result.content), {
      headers: {
        "content-disposition": `inline; filename="${filename.replace(/"/g, "_")}"`,
        "content-type": result.file.mimeType,
      },
    });
  });
  
  openApiRoute(app, "post", "/artifacts/:artifactId/files/revisions", async (c) => {
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
      content?: unknown;
      path?: unknown;
      summary?: unknown;
    };
    const content = typeof body.content === "string" ? body.content : undefined;
    const filePath = typeof body.path === "string" ? body.path : undefined;
    const summary = typeof body.summary === "string" && body.summary.trim().length > 0
      ? body.summary.trim()
      : undefined;
  
    if (
      content === undefined ||
      filePath === undefined ||
      Buffer.byteLength(content, "utf8") > 1024 * 1024
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_ARTIFACT_FILE_REVISION",
            message: "path and content are required; content must be 1MB or smaller.",
          },
        },
        400,
      );
    }
  
    const revision = await createConversationArtifactFileRevision(db, {
      artifactId: c.req.param("artifactId"),
      content,
      editorUserId: user.id,
      ownerUserId: user.id,
      path: filePath,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
      summary,
    });
  
    if (revision === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_FILE_NOT_FOUND",
            message: "Artifact file was not found.",
          },
        },
        404,
      );
    }
    await invalidateArtifactConversation({
      conversationId: revision.conversationId,
      ownerUserId: user.id,
    });
  
    return c.json({ revision }, 201);
  });
  
  openApiRoute(app, "post", "/artifacts/:artifactId/revisions", async (c) => {
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
      content?: unknown;
      summary?: unknown;
    };
    const content = typeof body.content === "string" ? body.content : undefined;
    const summary = typeof body.summary === "string" && body.summary.trim().length > 0
      ? body.summary.trim()
      : undefined;
  
    if (content === undefined || Buffer.byteLength(content, "utf8") > 1024 * 1024) {
      return c.json(
        {
          error: {
            code: "INVALID_ARTIFACT_REVISION",
            message: "content is required and must be 1MB or smaller.",
          },
        },
        400,
      );
    }
  
    const revision = await createConversationArtifactRevision(db, {
      artifactId: c.req.param("artifactId"),
      content,
      editorUserId: user.id,
      ownerUserId: user.id,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
      summary,
    });
  
    if (revision === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_NOT_FOUND",
            message: "Artifact was not found.",
          },
        },
        404,
      );
    }
    await invalidateArtifactConversation({
      conversationId: revision.conversationId,
      ownerUserId: user.id,
    });
  
    return c.json({ revision }, 201);
  });
  
  for (const actionType of ["apply", "preview", "publish"] as const) {
    openApiRoute(app, "post", `/artifacts/:artifactId/actions/${actionType}`, async (c) => {
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
        revisionId?: unknown;
      };
      if (actionType === "publish") {
        const artifactRecord = await getConversationArtifactForUser(db, {
          artifactId: c.req.param("artifactId"),
          ownerUserId: user.id,
          publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
          publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
        });
  
        if (artifactRecord?.artifact.kind === "site") {
          const publishResult = await publishSiteArtifactForUser(db, {
            artifactId: artifactRecord.artifact.id,
            ownerUserId: user.id,
            publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
            storageRoot: env.AGENTHUB_STORAGE_ROOT,
            userId: user.id,
          });
  
          if (publishResult === null) {
            return c.json(
              {
                error: {
                  code: "ARTIFACT_NOT_FOUND",
                  message: "Site artifact was not found.",
                },
              },
              404,
            );
          }
  
          await publishRealtimeEvents([
            createRealtimeEvent({
              action: publishResult.action,
              artifactId: publishResult.action.artifactId,
              conversationId: artifactRecord.artifact.conversationId,
              ownerUserId: user.id,
              type: "artifact.action.updated",
            }),
            ...(publishResult.deployment === undefined
              ? []
              : [
                  createRealtimeEvent({
                    conversationId: publishResult.deployment.conversationId,
                    ownerUserId: user.id,
                    type: "conversation.updated" as const,
                  }),
                ]),
          ]);
          await invalidateArtifactConversation({
            conversationId: artifactRecord.artifact.conversationId,
            ownerUserId: user.id,
          });
  
          return c.json(
            {
              action: publishResult.action,
              deployment: publishResult.deployment,
            },
            202,
          );
        }
      }
  
      const result = await createConversationArtifactAction(db, {
        artifactId: c.req.param("artifactId"),
        ownerUserId: user.id,
        revisionId: typeof body.revisionId === "string" ? body.revisionId : undefined,
        type: actionType,
      });
  
      if (result === null) {
        return c.json(
          {
            error: {
              code: "ARTIFACT_NOT_FOUND",
              message: "Artifact or revision was not found.",
            },
          },
          404,
        );
      }
  
      await enqueueArtifactActionJob(redis, result.job);
      const artifactRecord = await getConversationArtifactForUser(db, {
        artifactId: result.action.artifactId,
        ownerUserId: user.id,
      });
  
      if (artifactRecord !== null) {
        await publishRealtimeEvents([
          createRealtimeEvent({
            action: result.action,
            artifactId: result.action.artifactId,
            conversationId: artifactRecord.artifact.conversationId,
            ownerUserId: user.id,
            type: "artifact.action.updated",
          }),
        ]);
        await invalidateArtifactConversation({
          conversationId: artifactRecord.artifact.conversationId,
          ownerUserId: user.id,
        });
      }
  
      return c.json({ action: result.action }, 202);
    });
  }
  
  openApiRoute(app, "get", "/artifacts/:artifactId/download", async (c) => {
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
  
    const record = await getConversationArtifactForUser(db, {
      artifactId: c.req.param("artifactId"),
      ownerUserId: user.id,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
    });
  
    if (record === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_NOT_FOUND",
            message: "Artifact was not found.",
          },
        },
        404,
      );
    }
  
    if (record.artifact.kind === "site") {
      const zip = await getSiteArtifactZipForUser(db, {
        artifactId: record.artifact.id,
        ownerUserId: user.id,
        storageRoot: env.AGENTHUB_STORAGE_ROOT,
      });
  
      if (zip === null) {
        return c.json(
          {
            error: {
              code: "ARTIFACT_NOT_FOUND",
              message: "Artifact was not found.",
            },
          },
          404,
        );
      }
  
      return new Response(new Uint8Array(zip.content), {
        headers: {
          "content-disposition": `attachment; filename="${zip.filename.replace(/"/g, "_")}"`,
          "content-type": "application/zip",
        },
      });
    }
  
    const content = await readArtifactContent({
      storageKey: record.storageKey,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
    }).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return null;
      }
  
      throw error;
    });
  
    if (content === null) {
      return c.json(
        {
          error: {
            code: "ARTIFACT_FILE_NOT_FOUND",
            message: "Artifact file was not found on disk.",
          },
        },
        404,
      );
    }
  
    return new Response(new Uint8Array(content), {
      headers: {
        "content-disposition":
          `attachment; filename="${record.artifact.filename.replace(/"/g, "_")}"`,
        "content-length": String(content.byteLength),
        "content-type": inferArtifactFileInfo({
          filename: record.artifact.filename,
        }).mimeType,
      },
    });
  });

  return app;
}
