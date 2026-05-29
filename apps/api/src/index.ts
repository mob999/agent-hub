import { randomUUID } from "node:crypto";

import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { loadApiEnv } from "@agent-hub/config";
import { createDb } from "@agent-hub/db";
import type {
  AgentHubListTasksToolResult,
  AgentHubMcpToolName,
  Conversation,
  ConversationMessage,
  RealtimeEvent,
  RunEvent,
  ConversationTask,
  RuntimeKind,
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
  createAgentHubRedisClient,
  createLogger,
  buildAgentIdentityInstructions,
  buildAgentGroupsPrompt,
  createRunRecord,
  buildConversationRunPrompt,
  createConversationArtifactAction,
  createConversationArtifactRevision,
  createGroupConversation,
  createUserMessageAndRun,
  createUserMessageAndRuns,
  createRealtimeEvent,
  enqueueAgentProvisioningJob,
  enqueueArtifactActionJob,
  enqueueRunJob,
  ensureDefaultGroupConversation,
  ensureDirectConversation,
  getAgentForUser,
  getConversationForUser,
  getConversationArtifactForUser,
  getConversationArtifactContentForUser,
  getConversationArtifactDetailsForUser,
  getReadyDaemonRuntime,
  getRunnableAgentForUser,
  listConversationMessagesForUser,
  listConversationArtifactsForUser,
  listConversationTasksForUser,
  listConversationsForUser,
  getRunEventsForUser,
  getRunForUser,
  listAgentsForUser,
  listActiveAgentGroupContexts,
  listDaemonDevicesWithRuntimes,
  listRunsForUser,
  listRunningRunIdsByDaemonDevice,
  groupConversationKeyFromTitle,
  normalizeGroupConversationTitle,
  publishRealtimeEvent,
  readArtifactContent,
  restoreAgentForUser,
  restoreGroupConversationForUser,
  resolveTextMentionedAgentIds,
  subscribeRealtimeEvents,
  toAgentRun,
  updateConversationOrchestrator,
  updateAgentProfileForUser,
  updateGroupConversation,
  type RunnableAgent,
  type RunQueueJob,
} from "@agent-hub/server";
import { cors } from "hono/cors";

import {
  attachAuthUser,
  requireAuth,
  type AppBindings,
} from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { AuthUserResponseSchema } from "./schemas/auth.js";
import { ErrorResponseSchema, HealthResponseSchema } from "./schemas/common.js";

const env = loadApiEnv();
const db = createDb(env.DATABASE_URL);
const redis = createAgentHubRedisClient(env.REDIS_URL);
const realtimeSubscriber = createAgentHubRedisClient(env.REDIS_URL);
const logger = createLogger({ bindings: { service: "api" } });
const runtimeKinds = new Set<RuntimeKind>([
  "claude-code",
  "codex",
  "opencode",
  "custom",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT";
}

type SseClient = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: ReturnType<typeof setInterval> | null;
  id: string;
};

const sseEncoder = new TextEncoder();
const sseClientsByUserId = new Map<string, Set<SseClient>>();

function sseFrame(event: string, data: unknown): Uint8Array {
  return sseEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function unregisterSseClient(ownerUserId: string, client: SseClient): void {
  if (client.heartbeat !== null) {
    clearInterval(client.heartbeat);
    client.heartbeat = null;
  }

  const clients = sseClientsByUserId.get(ownerUserId);
  clients?.delete(client);

  if (clients !== undefined && clients.size === 0) {
    sseClientsByUserId.delete(ownerUserId);
  }
}

function deliverRealtimeEvent(event: RealtimeEvent): void {
  const clients = sseClientsByUserId.get(event.ownerUserId);

  if (clients === undefined) {
    return;
  }

  for (const client of [...clients]) {
    try {
      client.controller.enqueue(sseFrame(event.type, event));
    } catch (error) {
      logger.warn(
        { err: error, eventId: event.eventId, ownerUserId: event.ownerUserId },
        "Failed to deliver SSE event",
      );
      unregisterSseClient(event.ownerUserId, client);
    }
  }
}

async function publishRealtimeEvents(events: RealtimeEvent[]): Promise<void> {
  await Promise.all(
    events.map(async (event) => {
      try {
        await publishRealtimeEvent(redis, event);
      } catch (error) {
        logger.warn(
          { err: error, eventId: event.eventId, type: event.type },
          "Failed to publish realtime event",
        );
      }
    }),
  );
}

function queuedRunEventForJob(job: RunQueueJob): RunEvent {
  return {
    type: "run.queued",
    runId: job.run.id,
    agentId: job.run.agentId,
    daemonDeviceId: job.run.daemonDeviceId,
    createdAt: job.run.createdAt,
  };
}

function realtimeEventsForCreatedRuns(input: {
  conversation: Conversation;
  jobs: RunQueueJob[];
  messages: ConversationMessage[];
  ownerUserId: string;
}): RealtimeEvent[] {
  return [
    createRealtimeEvent({
      conversation: input.conversation,
      conversationId: input.conversation.id,
      ownerUserId: input.ownerUserId,
      type: "conversation.updated",
    }),
    ...input.messages.map((message) =>
      createRealtimeEvent({
        conversationId: message.conversationId,
        message,
        ownerUserId: input.ownerUserId,
        type: "conversation.message.created" as const,
      }),
    ),
    ...input.jobs.flatMap((job) => {
      const queuedEvent = queuedRunEventForJob(job);

      return [
        createRealtimeEvent({
          conversationId: input.conversation.id,
          ownerUserId: input.ownerUserId,
          run: job.run,
          type: "run.updated" as const,
        }),
        createRealtimeEvent({
          conversationId: input.conversation.id,
          event: queuedEvent,
          ownerUserId: input.ownerUserId,
          runId: job.run.id,
          type: "run.event.created" as const,
        }),
      ];
    }),
  ];
}

await redis.connect();
await realtimeSubscriber.connect();
await subscribeRealtimeEvents(realtimeSubscriber, (event) => {
  deliverRealtimeEvent(event);
});

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return typeof value === "string" && runtimeKinds.has(value as RuntimeKind);
}

function isValidAgentIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 20 &&
    value.every((agentId) =>
      typeof agentId === "string" && uuidPattern.test(agentId)
    ) &&
    new Set(value).size === value.length
  );
}

function parseOptionalAgentId(value: unknown): string | undefined {
  return typeof value === "string" && uuidPattern.test(value)
    ? value
    : undefined;
}

function parseRecordStatusFilter(
  value: unknown,
): "active" | "archived" | "all" | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  return value === "active" || value === "archived" || value === "all"
    ? value
    : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function previewUnavailableResponse(input: {
  message: string;
  previewUrl?: string;
  status?: number;
}): Response {
  const status = input.status ?? 502;
  const previewLine = input.previewUrl === undefined
    ? ""
    : `<p class="url">${escapeHtml(input.previewUrl)}</p>`;

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview unavailable</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #ffffff;
        color: #161616;
        font-family: IBM Plex Sans, Inter, system-ui, sans-serif;
      }
      main {
        max-width: 36rem;
        padding: 1rem;
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 1rem;
        line-height: 1.4;
      }
      p {
        margin: 0;
        color: #525252;
        line-height: 1.5;
      }
      .url {
        margin-top: 0.75rem;
        overflow-wrap: anywhere;
        font-family: IBM Plex Mono, ui-monospace, monospace;
        font-size: 0.875rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Preview unavailable</h1>
      <p>${escapeHtml(input.message)}</p>
      ${previewLine}
    </main>
  </body>
</html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
      status,
    },
  );
}

function groupChatMcpToolsForAgent(input: {
  agentId: string;
  orchestratorAgentId?: string;
}): AgentHubMcpToolName[] {
  return input.orchestratorAgentId === input.agentId
    ? [...agentHubAllMcpTools]
    : [...agentHubNonOrchestratorMcpTools];
}

function toMcpTaskList(
  tasks: ConversationTask[],
): AgentHubListTasksToolResult["tasks"] {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    assigneeAgentId: task.assigneeAgentId,
    assigneeRunId: task.assigneeRunId,
    description: task.description,
    status: task.status,
    workflowId: task.workflowId,
    dependsOnTaskIds: task.dependsOnTaskIds,
    blockedReason: task.blockedReason,
    resultArtifactIds: task.resultArtifactIds,
    summary: task.summary,
  }));
}

async function buildAgentGroupsPromptForAgent(input: {
  agentId: string;
  ownerUserId: string;
}): Promise<string> {
  return buildAgentGroupsPrompt(
    await listActiveAgentGroupContexts(db, {
      agentId: input.agentId,
      ownerUserId: input.ownerUserId,
    }),
  );
}

function buildGroupChatAgentInstructions(input: {
  agentIdentityInstructions: string;
  conversationTitle: string;
  isOrchestrator?: boolean;
}): string {
  return [
    input.agentIdentityInstructions,
    `You are participating in the AgentHub group chat #${input.conversationTitle}.`,
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group, even in Chat mode."
      : undefined,
    "Visible group replies must be sent with the AgentHub MCP tool send_message.",
    "For ordinary replies or progress updates, do not include @AgentName. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run.",
    "Do not answer a group chat by writing normal assistant text.",
  ].filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n\n");
}

function buildGroupChatRunPrompt(input: {
  agentGroupsPrompt?: string;
  agentNamesById?: Record<string, string>;
  agentName: string;
  conversationTitle: string;
  currentUserMessage: string;
  isOrchestrator?: boolean;
  messages: Awaited<ReturnType<typeof listConversationMessagesForUser>>;
}): string {
  const conversationPrompt = buildConversationRunPrompt({
    agentNamesById: input.agentNamesById,
    currentUserMessage: input.currentUserMessage,
    messages: input.messages ?? [],
  });

  return [
    "<agenthub_group_chat_protocol>",
    `You are ${input.agentName} in #${input.conversationTitle}.`,
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group, even in Chat mode."
      : undefined,
    input.isOrchestrator === true
      ? "You may coordinate other agents by sending visible messages with @AgentName, but only reply when useful."
      : undefined,
    "Decide whether you should reply to the user's latest message.",
    "If you should reply, call the MCP tool send_message with { content: string }.",
    "For ordinary replies, do not include @AgentName. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run.",
    "If the user explicitly asks you to reply, you should normally call send_message.",
    "If you should not reply, do not call send_message.",
    "Never use normal assistant text as the visible group reply. Normal assistant text is ignored by AgentHub group chat.",
    "</agenthub_group_chat_protocol>",
    "",
    input.agentGroupsPrompt,
    input.agentGroupsPrompt === undefined ? undefined : "",
    conversationPrompt,
  ].filter((line): line is string => line !== undefined).join("\n");
}

function buildGroupTaskOrchestratorInstructions(input: {
  agentIdentityInstructions: string;
  conversationTitle: string;
}): string {
  return [
    input.agentIdentityInstructions,
    `You are the configured Orchestrator for AgentHub group #${input.conversationTitle}.`,
    "In Task mode, first plan the task graph for group agents.",
    "Use create_task with { title, description, assigneeAgentId, dependsOnTaskIds? } to declare tasks. Tasks without dependencies are dispatched immediately. Tasks with dependencies wait until upstream tasks succeed.",
    "When a checkpoint run starts after a task completes, review the task graph, then use approve_task to launch ready downstream tasks, create_task for follow-up or recovery tasks, cancel_task for obsolete tasks, and complete_workflow only when the workflow is done.",
    "Use list_tasks, list_artifacts, and read_artifact to inspect workflow state and group workspace artifacts.",
    "Use send_message only for progress updates, decisions, or final user-facing notes.",
    "Do not assign a task to yourself unless you are intentionally doing part of the work.",
  ].filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n\n");
}

function buildGroupTaskOrchestratorPrompt(input: {
  agentGroupsPrompt?: string;
  agentNamesById?: Record<string, string>;
  agentName: string;
  agents: RunnableAgent[];
  conversationTitle: string;
  currentUserMessage: string;
  messages: Awaited<ReturnType<typeof listConversationMessagesForUser>>;
  orchestratorAgentId?: string;
}): string {
  const conversationPrompt = buildConversationRunPrompt({
    agentNamesById: input.agentNamesById,
    currentUserMessage: input.currentUserMessage,
    messages: input.messages ?? [],
  });
  const roster = input.agents.map((agent) => {
    const description = agent.agent.description?.trim();
    const role = agent.agent.id === input.orchestratorAgentId
      ? " [Orchestrator]"
      : "";

    return `- @${agent.agent.name}${role}: ${agent.agent.id}; ${
      description === undefined || description.length === 0
        ? "No description provided."
        : description
    }`;
  });

  return [
    "<agenthub_group_task_protocol>",
    `You are ${input.agentName}, the Orchestrator in #${input.conversationTitle}.`,
    "Available group agents:",
    ...roster,
    "",
    "Create tasks only for agents listed above.",
    "create_task requires assigneeAgentId and may include dependsOnTaskIds for serial work. Tasks without dependencies start immediately; dependent tasks wait until their dependencies succeed.",
    "Ready downstream tasks do not start automatically. In checkpoint runs, call approve_task({ taskId }) after you review and decide to continue.",
    "Use list_artifacts/read_artifact when later tasks need reports or files uploaded by earlier tasks.",
    "Do not use send_message to dispatch tasks. Use send_message only for progress updates, decisions, or final notes.",
    "Call complete_workflow only after there are no waiting, ready, assigned, or running tasks.",
    "Normal assistant text is not visible in group task mode.",
    "</agenthub_group_task_protocol>",
    "",
    input.agentGroupsPrompt,
    input.agentGroupsPrompt === undefined ? undefined : "",
    conversationPrompt,
  ].filter((line): line is string => line !== undefined).join("\n");
}

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  responses: {
    200: {
      description: "API is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

const debugProtectedRoute = createRoute({
  method: "get",
  path: "/debug/protected",
  tags: ["Debug"],
  summary: "Protected debug endpoint",
  description:
    "Temporary endpoint for testing cookie authentication. Remove or restrict before production.",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Authenticated user",
      content: {
        "application/json": {
          schema: AuthUserResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication required",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export const app = new OpenAPIHono<AppBindings>();

// 1) env/db injection
app.use("*", async (c, next) => {
  c.set("env", env);
  c.set("db", db);
  return next();
});

// 2) CORS
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  }),
);

// 3) attach current user if cookie session is valid
app.use("*", attachAuthUser);

app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: env.AUTH_SESSION_COOKIE,
});

// 4) OpenAPI + Swagger UI
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "AgentHub API",
    version: "0.1.0",
    description: "AgentHub backend API",
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: "Local development server",
    },
  ],
});

app.get(
  "/docs",
  swaggerUI({
    url: "/openapi.json",
  }),
);

// 5) health
app.openapi(healthRoute, (c) => {
  return c.json({ ok: true }, 200);
});

app.use("/events", requireAuth);
app.get("/events", async (c) => {
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

app.use("/daemon/devices", requireAuth);
app.get("/daemon/devices", async (c) => {
  const devices = await listDaemonDevicesWithRuntimes(c.get("db"));
  const runningRunIdsByDevice = await listRunningRunIdsByDaemonDevice(c.get("db"));

  return c.json({
    devices: devices.map((device) => ({
      id: device.id,
      status: device.status,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      runningRunIds: runningRunIdsByDevice.get(device.id) ?? [],
      runtimes: device.runtimes,
    })),
  });
});

app.use("/agents", requireAuth);
app.use("/agents/*", requireAuth);
app.get("/agents", async (c) => {
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
    agents: await listAgentsForUser(db, {
      ownerUserId: user.id,
      status,
    }),
  });
});

app.post("/agents", async (c) => {
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

  if (
    name.length === 0 ||
    name.length > 120 ||
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
            "name, avatar, daemonDeviceId, and a supported runtimeKind are required.",
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

  return c.json({ agent, queueMessageId }, 202);
});

app.get("/agents/:agentId", async (c) => {
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

  return c.json({ agent });
});

app.patch("/agents/:agentId", async (c) => {
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

  if (name.length === 0 || name.length > 120 || avatar === null) {
    return c.json(
      {
        error: {
          code: "INVALID_AGENT_REQUEST",
          message:
            "name is required, must be 120 characters or fewer, and avatar must be a default avatar.",
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

  return c.json({ agent });
});

app.patch("/agents/:agentId/archive", async (c) => {
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

  return c.json({ agent: result.agent });
});

app.patch("/agents/:agentId/restore", async (c) => {
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

  return c.json({ agent: result.agent });
});

app.use("/conversations", requireAuth);
app.use("/conversations/*", requireAuth);
app.get("/conversations", async (c) => {
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
    conversations: await listConversationsForUser(db, {
      ownerUserId: user.id,
      status,
    }),
  });
});

app.post("/conversations/default-group", async (c) => {
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

  return c.json({ conversation }, 200);
});

app.post("/conversations/groups", async (c) => {
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

  return c.json({ conversation: result.conversation }, 201);
});

app.patch("/conversations/groups/:conversationId", async (c) => {
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

  return c.json({ conversation: result.conversation });
});

app.patch("/conversations/groups/:conversationId/archive", async (c) => {
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

  return c.json({ conversation: result.conversation });
});

app.patch("/conversations/groups/:conversationId/restore", async (c) => {
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

  return c.json({ conversation: result.conversation });
});

app.patch("/conversations/:conversationId/orchestrator", async (c) => {
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

  return c.json({ conversation: result.conversation });
});

app.post("/conversations/direct", async (c) => {
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

  return c.json({ conversation }, 200);
});

app.get("/conversations/:conversationId/messages", async (c) => {
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

  const messages = await listConversationMessagesForUser(db, {
    conversationId: c.req.param("conversationId"),
    ownerUserId: user.id,
    limit,
    before,
    publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
    publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
  });

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

app.get("/conversations/:conversationId/tasks", async (c) => {
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

  const tasks = await listConversationTasksForUser(db, {
    conversationId: c.req.param("conversationId"),
    ownerUserId: user.id,
    publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
    publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
  });

  if (tasks === null) {
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

  return c.json({ tasks });
});

app.get("/conversations/:conversationId/artifacts", async (c) => {
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

  const artifacts = await listConversationArtifactsForUser(db, {
    conversationId: c.req.param("conversationId"),
    ownerUserId: user.id,
    publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
    publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
  });

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

app.post("/conversations/:conversationId/messages", async (c) => {
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
    content?: unknown;
    mode?: unknown;
  };
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const mode = body.mode === undefined || body.mode === "chat"
    ? "chat"
    : body.mode === "task"
      ? "task"
      : undefined;

  if (content.length === 0 || mode === undefined) {
    return c.json(
      {
        error: {
          code: "INVALID_MESSAGE_REQUEST",
          message: "content is required and mode must be chat or task.",
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
    typeof body.agentId === "string" && body.agentId.length > 0
      ? body.agentId
      : undefined;
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

  const currentConversationTasks =
    conversation.type === "group"
      ? await listConversationTasksForUser(db, {
          conversationId: conversation.id,
          ownerUserId: user.id,
          publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
          publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
        })
      : [];

  if (currentConversationTasks === null) {
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

  const agentHubMcpTasks = toMcpTaskList(currentConversationTasks);

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
    const job: RunQueueJob = {
      conversationId: conversation.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      prompt: [
        agentGroupsPrompt,
        buildConversationRunPrompt({
          agentNamesById,
          currentUserMessage: content,
          messages: priorMessages,
        }),
      ].join("\n\n"),
      agentInstructions: buildAgentIdentityInstructions({
        agentDescription: runAgent.agent.description,
        agentName: runAgent.agent.name,
        scenario: "direct chat",
      }),
      agentHubMcpTools: [...agentHubNonOrchestratorMcpTools],
      agentHubMcpTasks,
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
    };
    const result = await createUserMessageAndRun(db, {
      ownerUserId: user.id,
      conversationId: conversation.id,
      job,
      userMessageContent: content,
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
    const assistant = result.messages.assistant;
    await publishRealtimeEvents(
      realtimeEventsForCreatedRuns({
        conversation: result.conversation,
        jobs: [job],
        messages: [
          result.messages.user,
          ...(assistant === undefined ? [] : [assistant]),
        ],
        ownerUserId: user.id,
      }),
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
      ownerUserId: user.id,
    });
    const job: RunQueueJob = {
      conversationId: conversation.id,
      daemonDeviceId: orchestrator.daemonDeviceId,
      prompt: buildGroupTaskOrchestratorPrompt({
        agentNamesById,
        agentName: orchestrator.agent.name,
        agents: readyGroupAgents,
        agentGroupsPrompt,
        conversationTitle: conversation.title,
        currentUserMessage: content,
        messages: priorMessages,
        orchestratorAgentId: conversation.orchestratorAgentId,
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
      }),
      agentHubMcpTools: [...agentHubAllMcpTools],
      agentHubMcpTasks,
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
    };
    const result = await createUserMessageAndRuns(db, {
      ownerUserId: user.id,
      conversationId: conversation.id,
      jobs: [job],
      userMessageContent: content,
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
    await publishRealtimeEvents(
      realtimeEventsForCreatedRuns({
        conversation: result.conversation,
        jobs: [job],
        messages: [
          result.messages.user,
          ...result.messages.assistants,
        ],
        ownerUserId: user.id,
      }),
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

  const jobs = await Promise.all(
    runAgents.map(async (runAgent): Promise<RunQueueJob> => {
      const isOrchestrator = conversation.orchestratorAgentId === runAgent.agent.id;

      return {
        conversationId: conversation.id,
        daemonDeviceId: runAgent.daemonDeviceId,
        prompt: buildGroupChatRunPrompt({
          agentGroupsPrompt: await buildAgentGroupsPromptForAgent({
            agentId: runAgent.agent.id,
            ownerUserId: user.id,
          }),
          agentNamesById,
          agentName: runAgent.agent.name,
          conversationTitle: conversation.title,
          currentUserMessage: content,
          isOrchestrator,
          messages: priorMessages,
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
        }),
        agentHubMcpTools: groupChatMcpToolsForAgent({
          agentId: runAgent.agent.id,
          orchestratorAgentId: conversation.orchestratorAgentId,
        }),
        agentHubMcpTasks,
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
      };
    }),
  );
  const result = await createUserMessageAndRuns(db, {
    ownerUserId: user.id,
    conversationId: conversation.id,
    jobs,
    userMessageContent: content,
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
  await publishRealtimeEvents(
    realtimeEventsForCreatedRuns({
      conversation: result.conversation,
      jobs,
      messages: [
        result.messages.user,
        ...result.messages.assistants,
      ],
      ownerUserId: user.id,
    }),
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

app.use("/artifacts/*", requireAuth);
app.get("/artifacts/:artifactId", async (c) => {
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

app.get("/artifacts/:artifactId/content", async (c) => {
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

app.get("/artifacts/:artifactId/preview/*", async (c) => {
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

app.post("/artifacts/:artifactId/revisions", async (c) => {
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

  return c.json({ revision }, 201);
});

for (const actionType of ["apply", "preview", "publish"] as const) {
  app.post(`/artifacts/:artifactId/actions/${actionType}`, async (c) => {
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
    }

    return c.json({ action: result.action }, 202);
  });
}

app.get("/artifacts/:artifactId/download", async (c) => {
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

app.use("/runs", requireAuth);
app.use("/runs/*", requireAuth);
app.get("/runs", async (c) => {
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

app.post("/runs", async (c) => {
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
  await publishRealtimeEvents(appendResult.realtimeEvents);

  return c.json(
    {
      run: job.run,
      queueMessageId,
    },
    202,
  );
});

app.get("/runs/:runId", async (c) => {
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

app.get("/runs/:runId/events", async (c) => {
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

// 6) auth routes
app.route("/auth", authRoutes);

// 7) debug protected route
app.use("/debug/protected", requireAuth);
app.openapi(debugProtectedRoute, (c) => {
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

  return c.json(
    {
      user,
    },
    200,
  );
});

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  () => {
    logger.info(
      { port: env.PORT, url: `http://localhost:${env.PORT}` },
      "API server listening",
    );
  },
);
