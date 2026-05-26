import { randomUUID } from "node:crypto";

import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { loadApiEnv } from "@agent-hub/config";
import { createDb } from "@agent-hub/db";
import type { AgentHubMcpToolName, RuntimeKind } from "@agent-hub/core";
import {
  agentHubAllMcpTools,
  agentHubNonOrchestratorMcpTools,
} from "@agent-hub/core";
import {
  appendRunEvent,
  createAgentProvisioningRecords,
  createAgentHubRedisClient,
  createLogger,
  createRunRecord,
  buildConversationRunPrompt,
  createConversationArtifactAction,
  createConversationArtifactRevision,
  createGroupConversation,
  createUserMessageAndRun,
  createUserMessageAndRuns,
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
  listDaemonDevicesWithRuntimes,
  listRunsForUser,
  listRunningRunIdsByDaemonDevice,
  groupConversationKeyFromTitle,
  normalizeGroupConversationTitle,
  readArtifactContent,
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
const logger = createLogger({ bindings: { service: "api" } });
const runtimeKinds = new Set<RuntimeKind>([
  "claude-code",
  "codex",
  "opencode",
  "custom",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

await redis.connect();

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return typeof value === "string" && runtimeKinds.has(value as RuntimeKind);
}

function buildAgentInstructions(description: string | undefined): string | undefined {
  const trimmedDescription = description?.trim();

  if (trimmedDescription === undefined || trimmedDescription.length === 0) {
    return undefined;
  }

  return [
    "AgentHub agent profile:",
    "Follow this agent profile when responding.",
    "",
    trimmedDescription,
  ].join("\n");
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

function parseMentionedAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const agentIds = value.flatMap((mention) => {
    if (
      typeof mention !== "object" ||
      mention === null ||
      Array.isArray(mention)
    ) {
      return [];
    }

    const record = mention as Record<string, unknown>;

    return record.type === "agent" &&
      typeof record.agentId === "string" &&
      uuidPattern.test(record.agentId)
      ? [record.agentId]
      : [];
  });

  return [...new Set(agentIds)];
}

function parseOptionalAgentId(value: unknown): string | undefined {
  return typeof value === "string" && uuidPattern.test(value)
    ? value
    : undefined;
}

function groupChatMcpToolsForAgent(input: {
  agentId: string;
  orchestratorAgentId?: string;
}): AgentHubMcpToolName[] {
  return input.orchestratorAgentId === input.agentId
    ? [...agentHubAllMcpTools]
    : [...agentHubNonOrchestratorMcpTools];
}

function buildGroupChatAgentInstructions(input: {
  agentInstructions?: string;
  conversationTitle: string;
}): string {
  return [
    input.agentInstructions,
    `You are participating in the AgentHub group chat #${input.conversationTitle}.`,
    "Visible group replies must be sent with the AgentHub MCP tool send_message.",
    "Do not answer a group chat by writing normal assistant text.",
  ].filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n\n");
}

function buildGroupChatRunPrompt(input: {
  agentNamesById?: Record<string, string>;
  agentName: string;
  conversationTitle: string;
  currentUserMessage: string;
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
    "Decide whether you should reply to the user's latest message.",
    "If you should reply, call the MCP tool send_message with { content: string }.",
    "If the user explicitly asks you to reply, you should normally call send_message.",
    "If you should not reply, do not call send_message.",
    "Never use normal assistant text as the visible group reply. Normal assistant text is ignored by AgentHub group chat.",
    "</agenthub_group_chat_protocol>",
    "",
    conversationPrompt,
  ].join("\n");
}

function buildGroupTaskOrchestratorInstructions(input: {
  agentInstructions?: string;
  conversationTitle: string;
}): string {
  return [
    input.agentInstructions,
    `You are the configured Orchestrator for AgentHub group #${input.conversationTitle}.`,
    "In Task mode, break the user's request into concrete tasks for group agents.",
    "For each task, call create_task with { title, description, assigneeAgentId }.",
    "After creating tasks, call send_message with a visible dispatch message that @mentions each assignee and includes the created taskIds.",
    "Do not assign a task to yourself unless you are intentionally doing part of the work.",
  ].filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n\n");
}

function buildGroupTaskOrchestratorPrompt(input: {
  agentNamesById?: Record<string, string>;
  agentName: string;
  agents: RunnableAgent[];
  conversationTitle: string;
  currentUserMessage: string;
  messages: Awaited<ReturnType<typeof listConversationMessagesForUser>>;
}): string {
  const conversationPrompt = buildConversationRunPrompt({
    agentNamesById: input.agentNamesById,
    currentUserMessage: input.currentUserMessage,
    messages: input.messages ?? [],
  });
  const roster = input.agents.map((agent) =>
    `- ${agent.agent.name}: ${agent.agent.id}${
      agent.agent.description ? ` (${agent.agent.description})` : ""
    }`,
  );

  return [
    "<agenthub_group_task_protocol>",
    `You are ${input.agentName}, the Orchestrator in #${input.conversationTitle}.`,
    "Available group agents:",
    ...roster,
    "",
    "Create tasks only for agents listed above.",
    "create_task requires assigneeAgentId and returns a task id.",
    "After creating tasks, call send_message with content, mentions, and taskIds so AgentHub can dispatch the assigned agents.",
    "Normal assistant text is not visible in group task mode.",
    "</agenthub_group_task_protocol>",
    "",
    conversationPrompt,
  ].join("\n");
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

  return c.json({
    agents: await listAgentsForUser(db, { ownerUserId: user.id }),
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
    daemonDeviceId?: unknown;
    runtimeKind?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" && body.description.trim().length > 0
      ? body.description.trim()
      : undefined;

  if (
    name.length === 0 ||
    name.length > 120 ||
    typeof body.daemonDeviceId !== "string" ||
    body.daemonDeviceId.length === 0 ||
    !isRuntimeKind(body.runtimeKind)
  ) {
    return c.json(
      {
        error: {
          code: "INVALID_AGENT_REQUEST",
          message:
            "name, daemonDeviceId, and a supported runtimeKind are required.",
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
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" && body.description.trim().length > 0
      ? body.description.trim()
      : undefined;

  if (name.length === 0 || name.length > 120) {
    return c.json(
      {
        error: {
          code: "INVALID_AGENT_REQUEST",
          message: "name is required and must be 120 characters or fewer.",
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

  return c.json({
    conversations: await listConversationsForUser(db, { ownerUserId: user.id }),
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
    mentions?: unknown;
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

  const requestedAgentId =
    typeof body.agentId === "string" && body.agentId.length > 0
      ? body.agentId
      : undefined;
  const mentionedAgentIds = parseMentionedAgentIds(body.mentions);
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

  const agentNamesById = Object.fromEntries(
    (await listAgentsForUser(db, { ownerUserId: user.id })).map((agent) => [
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

    const job: RunQueueJob = {
      conversationId: conversation.id,
      daemonDeviceId: runAgent.daemonDeviceId,
      prompt: buildConversationRunPrompt({
        agentNamesById,
        currentUserMessage: content,
        messages: priorMessages,
      }),
      agentInstructions: buildAgentInstructions(runAgent.agent.description),
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

    const job: RunQueueJob = {
      conversationId: conversation.id,
      daemonDeviceId: orchestrator.daemonDeviceId,
      prompt: buildGroupTaskOrchestratorPrompt({
        agentNamesById,
        agentName: orchestrator.agent.name,
        agents: readyGroupAgents,
        conversationTitle: conversation.title,
        currentUserMessage: content,
        messages: priorMessages,
      }),
      agentInstructions: buildGroupTaskOrchestratorInstructions({
        agentInstructions: buildAgentInstructions(orchestrator.agent.description),
        conversationTitle: conversation.title,
      }),
      agentHubMcpTools: [...agentHubAllMcpTools],
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

  const jobs = runAgents.map((runAgent): RunQueueJob => ({
    conversationId: conversation.id,
    daemonDeviceId: runAgent.daemonDeviceId,
    prompt: buildGroupChatRunPrompt({
      agentNamesById,
      agentName: runAgent.agent.name,
      conversationTitle: conversation.title,
      currentUserMessage: content,
      messages: priorMessages,
    }),
    agentInstructions: buildGroupChatAgentInstructions({
      agentInstructions: buildAgentInstructions(runAgent.agent.description),
      conversationTitle: conversation.title,
    }),
    agentHubMcpTools: groupChatMcpToolsForAgent({
      agentId: runAgent.agent.id,
      orchestratorAgentId: conversation.orchestratorAgentId,
    }),
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
  }));
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

  const previewAction = details.actions.find(
    (action) =>
      action.type === "preview" &&
      action.status === "succeeded" &&
      typeof action.result?.previewUrl === "string",
  );
  const previewUrl =
    typeof previewAction?.result?.previewUrl === "string"
      ? previewAction.result.previewUrl
      : typeof details.artifact.metadata?.previewUrl === "string"
        ? details.artifact.metadata.previewUrl
        : undefined;

  if (previewUrl === undefined) {
    return c.json(
      {
        error: {
          code: "PREVIEW_NOT_READY",
          message: "Preview is not ready.",
        },
      },
      404,
    );
  }

  const targetUrl = new URL(previewUrl);
  const suffix = c.req.param("*") ?? "";
  if (suffix.length > 0) {
    targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, "")}/${suffix}`;
  }
  targetUrl.search = new URL(c.req.url).search;

  const response = await fetch(targetUrl);
  const body = await response.arrayBuffer();
  const headers = new Headers();
  for (const headerName of [
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
  ]) {
    const value = response.headers.get(headerName);

    if (value !== null) {
      headers.set(headerName, value);
    }
  }

  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
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
  });

  return new Response(new Uint8Array(content), {
    headers: {
      "content-disposition":
        `attachment; filename="${record.artifact.filename.replace(/"/g, "_")}"`,
      "content-length": String(content.byteLength),
      "content-type": record.mimeType ?? "application/octet-stream",
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
    agentInstructions = buildAgentInstructions(runnableAgent.agent.description);
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
    prompt,
    agentInstructions,
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
  await appendRunEvent(db, {
    type: "run.queued",
    runId: job.run.id,
    agentId: job.run.agentId,
    daemonDeviceId: job.run.daemonDeviceId,
    createdAt: now,
  });
  const queueMessageId = await enqueueRunJob(redis, job);

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
