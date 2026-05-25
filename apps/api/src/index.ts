import { randomUUID } from "node:crypto";

import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { DaemonServerMessage } from "@agent-hub/core";
import { loadApiEnv } from "@agent-hub/config";
import { createDb } from "@agent-hub/db";
import {
  createAgentHubRedisClient,
  daemonAssignmentChannel,
  enqueueRunJob,
  type RunQueueJob,
} from "@agent-hub/server";
import { cors } from "hono/cors";

import {
  attachAuthUser,
  requireAuth,
  type AppBindings,
} from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { DaemonGateway } from "./daemon/gateway.js";
import {
  appendRunEvent,
  createRunRecord,
  getRunEventsForUser,
  getRunForUser,
  listDaemonDevices,
  toAgentRun,
  upsertDaemonDevice,
} from "./runs/repository.js";
import { AuthUserResponseSchema } from "./schemas/auth.js";
import { ErrorResponseSchema, HealthResponseSchema } from "./schemas/common.js";

const env = loadApiEnv();
const db = createDb(env.DATABASE_URL);
const redis = createAgentHubRedisClient(env.REDIS_URL);
const redisSubscriber = redis.duplicate();
const daemonGateway = new DaemonGateway({
  daemonToken: env.AGENTHUB_DAEMON_TOKEN,
  onDaemonConnected: async (deviceId) => {
    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "online",
    });
  },
  onDaemonDisconnected: async (deviceId) => {
    await upsertDaemonDevice(db, {
      id: deviceId,
      status: "offline",
    });
  },
  onRunEvent: async (event) => {
    await appendRunEvent(db, event);
  },
});

await redis.connect();
await redisSubscriber.connect();
await redisSubscriber.subscribe(daemonAssignmentChannel, (payload) => {
  const message = JSON.parse(payload) as DaemonServerMessage;

  if (!daemonGateway.assign(message) && message.type === "run.assigned") {
    void appendRunEvent(db, {
      type: "run.completed",
      runId: message.run.id,
      status: "failed",
      error: `Daemon ${message.daemonDeviceId} is not connected.`,
      createdAt: new Date().toISOString(),
    });
  }
});

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
  const devices = await listDaemonDevices(c.get("db"));
  const onlineDevices = new Map(
    daemonGateway
      .listDevices()
      .map((device) => [device.deviceId, device] as const),
  );

  return c.json({
    devices: devices.map((device) => ({
      id: device.id,
      status: onlineDevices.get(device.id)?.status ?? device.status,
      lastSeenAt:
        onlineDevices.get(device.id)?.lastSeenAt ??
        device.lastSeenAt?.toISOString() ??
        null,
      runningRunIds: onlineDevices.get(device.id)?.runningRunIds ?? [],
    })),
  });
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
  const agentId = body.agentId ?? env.AGENTHUB_DEFAULT_AGENT_ID;
  const daemonDeviceId =
    body.daemonDeviceId ?? env.AGENTHUB_DEFAULT_DAEMON_DEVICE_ID;
  const workspacePath = body.workspacePath ?? env.AGENTHUB_DEFAULT_WORKSPACE_PATH;

  if (
    typeof prompt !== "string" ||
    prompt.length === 0 ||
    agentId === undefined ||
    daemonDeviceId === undefined ||
    workspacePath === undefined
  ) {
    return c.json(
      {
        error: {
          code: "INVALID_RUN_REQUEST",
          message:
            "prompt is required; agentId, daemonDeviceId, and workspacePath must be provided or configured as defaults.",
        },
      },
      400,
    );
  }

  const now = new Date().toISOString();
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
    runtime: {
      runtimeKind: "codex",
      capabilities: [],
      updatedAt: now,
    },
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

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  () => {
    console.log(`API server listening on http://localhost:${env.PORT}`);
  },
);

server.on("upgrade", (request, socket, head) => {
  if (!daemonGateway.handleUpgrade(request, socket, head)) {
    socket.destroy();
  }
});
