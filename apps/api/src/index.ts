import { randomUUID } from "node:crypto";

import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { loadApiEnv } from "@agent-hub/config";
import { createDb } from "@agent-hub/db";
import type { RuntimeKind } from "@agent-hub/core";
import {
  appendRunEvent,
  createAgentProvisioningRecords,
  createAgentHubRedisClient,
  createLogger,
  createRunRecord,
  enqueueAgentProvisioningJob,
  enqueueRunJob,
  getAgentForUser,
  getReadyDaemonRuntime,
  getRunnableAgentForUser,
  getRunEventsForUser,
  getRunForUser,
  listAgentsForUser,
  listDaemonDevicesWithRuntimes,
  listRunningRunIdsByDaemonDevice,
  toAgentRun,
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

await redis.connect();

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return typeof value === "string" && runtimeKinds.has(value as RuntimeKind);
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

app.use("/runs", requireAuth);
app.use("/runs/*", requireAuth);
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
