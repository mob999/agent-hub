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

export function createDaemonRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, redis, logger } = context;
  const {
    parseDaemonCommandPlatform,
    normalizeDaemonDeviceName,
    daemonDeviceCommandResponse,
    buildDaemonCommand,
    daemonDeviceIdPattern,
  } = context.services;

  app.use("/daemon/devices", requireAuth);
  app.use("/daemon/devices/*", requireAuth);
  openApiRoute(app, "get", "/daemon/devices", async (c) => {
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

    const devices = await listDaemonDevicesWithRuntimes(c.get("db"), {
      ownerUserId: user.id,
    });
    const runningRunIdsByDevice = await listRunningRunIdsByDaemonDevice(c.get("db"));

    return c.json({
      devices: devices.map((device) => ({
        id: device.id,
        ownerUserId: device.ownerUserId ?? undefined,
        name: device.name,
        status: device.status,
        registrationShell: device.registrationShell ?? undefined,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        createdAt: device.createdAt.toISOString(),
        updatedAt: device.updatedAt.toISOString(),
        deletedAt: device.deletedAt?.toISOString(),
        runningRunIds: runningRunIdsByDevice.get(device.id) ?? [],
        runtimes: device.runtimes,
      })),
    });
  });

  openApiRoute(app, "post", "/daemon/devices", async (c) => {
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
      platform?: unknown;
    };
    const name = normalizeDaemonDeviceName(body.name);

    if (name === null) {
      return c.json(
        {
          error: {
            code: "INVALID_DAEMON_DEVICE_NAME",
            message: "Device name must be 1-80 characters.",
          },
        },
        400,
      );
    }

    const platform = parseDaemonCommandPlatform(
      typeof body.platform === "string" ? body.platform : undefined,
    );
    const shell = platform === "windows" ? "powershell" : "sh";
    const device = await createDaemonDeviceForUser(c.get("db"), {
      id: `device-${randomUUID().slice(0, 8)}`,
      name,
      ownerUserId: user.id,
      registrationShell: shell,
    });

    return c.json(daemonDeviceCommandResponse({ device, platform }), 201);
  });

  openApiRoute(app, "patch", "/daemon/devices/:deviceId", async (c) => {
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

    const deviceId = c.req.param("deviceId");
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const name = normalizeDaemonDeviceName(body.name);

    if (name === null) {
      return c.json(
        {
          error: {
            code: "INVALID_DAEMON_DEVICE_NAME",
            message: "Device name must be 1-80 characters.",
          },
        },
        400,
      );
    }

    const device = await updateDaemonDeviceForUser(c.get("db"), {
      deviceId,
      name,
      ownerUserId: user.id,
    });

    if (device === null) {
      return c.json(
        {
          error: {
            code: "DAEMON_DEVICE_NOT_FOUND",
            message: "Daemon device was not found.",
          },
        },
        404,
      );
    }

    return c.json({
      device: {
        id: device.id,
        ownerUserId: device.ownerUserId ?? undefined,
        name: device.name,
        status: device.status,
        registrationShell: device.registrationShell ?? undefined,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        createdAt: device.createdAt.toISOString(),
        updatedAt: device.updatedAt.toISOString(),
        deletedAt: device.deletedAt?.toISOString(),
      },
    });
  });

  openApiRoute(app, "delete", "/daemon/devices/:deviceId", async (c) => {
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

    const device = await softDeleteDaemonDeviceForUser(c.get("db"), {
      deviceId: c.req.param("deviceId"),
      ownerUserId: user.id,
    });

    if (device === null) {
      return c.json(
        {
          error: {
            code: "DAEMON_DEVICE_NOT_FOUND",
            message: "Daemon device was not found.",
          },
        },
        404,
      );
    }

    return c.json({ deleted: true });
  });

  openApiRoute(app, "post", "/daemon/devices/:deviceId/reconnect-command", async (c) => {
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
      platform?: unknown;
    };
    const platform = parseDaemonCommandPlatform(
      typeof body.platform === "string" ? body.platform : undefined,
    );
    const device = await getDaemonDeviceForUser(c.get("db"), {
      deviceId: c.req.param("deviceId"),
      ownerUserId: user.id,
    });

    if (device === null) {
      return c.json(
        {
          error: {
            code: "DAEMON_DEVICE_NOT_FOUND",
            message: "Daemon device was not found.",
          },
        },
        404,
      );
    }

    return c.json(daemonDeviceCommandResponse({ device, platform }));
  });

  app.use("/daemon/registration-command", requireAuth);
  openApiRoute(app, "post", "/daemon/registration-command", async (c) => {
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

    const platform = parseDaemonCommandPlatform(c.req.query("platform"));
    const requestedDeviceId = c.req.query("deviceId")?.trim();

    if (
      requestedDeviceId !== undefined &&
      !daemonDeviceIdPattern.test(requestedDeviceId)
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_DAEMON_DEVICE_ID",
            message: "Device id contains unsupported characters.",
          },
        },
        400,
      );
    }

    const deviceId = requestedDeviceId ?? `device-${randomUUID().slice(0, 8)}`;
    const shell = platform === "windows" ? "powershell" : "sh";
    const device = requestedDeviceId === undefined
      ? await createDaemonDeviceForUser(c.get("db"), {
          id: deviceId,
          name: deviceId,
          ownerUserId: user.id,
          registrationShell: shell,
        })
      : await getDaemonDeviceForUser(c.get("db"), {
          deviceId,
          ownerUserId: user.id,
        }) ?? await createDaemonDeviceForUser(c.get("db"), {
          id: deviceId,
          name: deviceId,
          ownerUserId: user.id,
          registrationShell: shell,
        });
    const gatewayUrl = env.AGENTHUB_DAEMON_GATEWAY_URL;

    return c.json({
      command: buildDaemonCommand({
        deviceId,
        gatewayUrl,
        platform,
      }),
      device: {
        id: device.id,
        ownerUserId: device.ownerUserId ?? undefined,
        name: device.name,
        status: device.status,
        registrationShell: device.registrationShell ?? undefined,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        createdAt: device.createdAt.toISOString(),
        updatedAt: device.updatedAt.toISOString(),
        deletedAt: device.deletedAt?.toISOString(),
      },
      deviceId,
      gatewayUrl,
      shell,
    });
  });

  return app;
}
