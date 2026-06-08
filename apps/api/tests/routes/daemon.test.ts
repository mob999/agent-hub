import type { ApiEnv } from "@agent-hub/config";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import type { AppBindings, AuthUser } from "../../src/auth/middleware.js";
import type { ApiContext } from "../../src/context.js";
import { createDaemonRoutes } from "../../src/routes/daemon.js";
import { createApiServices } from "../../src/services/api-services.js";

const testEnv: ApiEnv = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  DATABASE_POOL_MAX: 3,
  REDIS_URL: "redis://localhost:6379",
  AUTH_SESSION_COOKIE: "agent_hub_session",
  AUTH_SESSION_TTL_DAYS: 30,
  AUTH_COOKIE_SECURE: false,
  AGENTHUB_DAEMON_TOKEN: "dev-daemon-token",
  AGENTHUB_DAEMON_GATEWAY_URL: "http://localhost:3001",
  GITHUB_CLIENT_ID: "github-client-id",
  GITHUB_CLIENT_SECRET: "github-client-secret",
  GITHUB_OAUTH_CALLBACK_URL: "http://localhost:3000/auth/github/callback",
  AGENTHUB_DEFAULT_WORKSPACE_PATH: "/tmp/agent-hub",
  AGENTHUB_STORAGE_DRIVER: "local",
  AGENTHUB_STORAGE_ROOT: "/tmp/agent-hub/storage",
  AGENTHUB_PUBLIC_API_URL: "http://localhost:3000",
  AGENTHUB_PUBLIC_WEB_URL: "http://localhost:5173",
  AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD: 60000,
};

const testUser: AuthUser = {
  avatar: null,
  email: "user@example.com",
  id: "user-id",
  name: "User",
};

function createDbMock() {
  const devices = new Map<string, {
    createdAt: Date;
    deletedAt: Date | null;
    id: string;
    lastSeenAt: Date | null;
    name: string;
    ownerUserId: string | null;
    registrationShell: string | null;
    status: string;
    updatedAt: Date;
  }>();
  let insertCount = 0;

  return {
    db: {
      insert: () => ({
        values: (value: {
          id: string;
          name: string;
          ownerUserId: string;
          registrationShell: "powershell" | "sh";
          status: string;
          createdAt: Date;
          updatedAt: Date;
        }) => ({
          returning: async () => {
            insertCount += 1;
            const device = {
              ...value,
              deletedAt: null,
              lastSeenAt: null,
            };
            devices.set(value.id, device);
            return [device];
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => Array.from(devices.values()).slice(0, 1),
          }),
        }),
      }),
    } as unknown as ApiContext["db"],
    get insertCount() {
      return insertCount;
    },
  };
}

function createDaemonTestApp(user: AuthUser | null) {
  const dbMock = createDbMock();
  const baseContext: ApiContext = {
    db: dbMock.db,
    env: testEnv,
    logger: { warn: () => undefined } as unknown as ApiContext["logger"],
    realtimeSubscriber: {} as ApiContext["realtimeSubscriber"],
    redis: {} as ApiContext["redis"],
    repositoryRoot: "/repo",
  };
  const app = new OpenAPIHono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("db", baseContext.db);
    c.set("env", baseContext.env);
    c.set("logger", baseContext.logger);
    c.set("redis", baseContext.redis);
    c.set("user", user);
    await next();
  });
  app.route("/", createDaemonRoutes({
    ...baseContext,
    services: createApiServices(baseContext),
  }));

  return { app, dbMock };
}

describe("daemon routes", () => {
  it("requires auth for desktop bootstrap", async () => {
    const { app } = createDaemonTestApp(null);

    const response = await app.request("/daemon/desktop/bootstrap", {
      method: "POST",
    });

    expect(response.status).toBe(401);
  });

  it("bootstraps a desktop daemon device with a structured token", async () => {
    const { app, dbMock } = createDaemonTestApp(testUser);

    const first = await app.request("/daemon/desktop/bootstrap", {
      body: JSON.stringify({
        deviceId: "desktop-test",
        name: "Tavro Desktop",
        platform: "windows",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const replay = await app.request("/daemon/desktop/bootstrap", {
      body: JSON.stringify({
        deviceId: "desktop-test",
        name: "Tavro Desktop",
        platform: "windows",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    expect(first.status).toBe(200);
    const body = await first.json() as {
      command?: string;
      deviceId: string;
      gatewayUrl: string;
      token: string;
    };
    expect(body.command).toBeUndefined();
    expect(body.deviceId).toBe("desktop-test");
    expect(body.gatewayUrl).toBe("http://localhost:3001");
    expect(body.token).toBe("dev-daemon-token");
    expect(replay.status).toBe(200);
    expect(dbMock.insertCount).toBe(1);
  });
});
