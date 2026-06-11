import type { ApiEnv } from "@agent-hub/config";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings, AuthUser } from "../../src/auth/middleware.js";
import type { ApiRouteContext } from "../../src/context.js";
import { createAdminRoutes } from "../../src/routes/admin.js";

const serverMocks = vi.hoisted(() => ({
  getAdminPrincipalByEmail: vi.fn(),
  getManagedUserDetail: vi.fn(),
  listManagedUsers: vi.fn(),
}));

vi.mock("@agent-hub/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@agent-hub/server")>();
  return {
    ...original,
    getAdminPrincipalByEmail: serverMocks.getAdminPrincipalByEmail,
    getManagedUserDetail: serverMocks.getManagedUserDetail,
    listManagedUsers: serverMocks.listManagedUsers,
  };
});

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
  AGENTHUB_ADMIN_EMAILS: "admin@example.com",
  GITHUB_CLIENT_ID: "github-client-id",
  GITHUB_CLIENT_SECRET: "github-client-secret",
  GITHUB_OAUTH_CALLBACK_URL: "http://localhost:3000/auth/github/callback",
  AGENTHUB_DEFAULT_WORKSPACE_PATH: "/tmp/agent-hub",
  AGENTHUB_STORAGE_DRIVER: "local",
  AGENTHUB_STORAGE_ROOT: "/tmp/agent-hub/storage",
  AGENTHUB_PUBLIC_API_URL: "http://localhost:3000",
  AGENTHUB_PUBLIC_WEB_URL: "http://localhost:5173",
  AGENTHUB_PUBLIC_ADMIN_URL: "http://localhost:5174",
  AGENTHUB_GRAFANA_URL: "http://localhost:3003",
  AGENTHUB_GRAFANA_ADMIN_DASHBOARD_PATH: "/d/tavro-admin-logs/tavro-ai-admin-logs",
  AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD: 60000,
};

const adminUser: AuthUser = {
  avatar: null,
  email: "admin@example.com",
  id: "user-admin",
  name: "Admin",
};

function createAdminTestApp(user: AuthUser | null) {
  const app = new OpenAPIHono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("admin", null);
    c.set("db", {} as ApiRouteContext["db"]);
    c.set("env", testEnv);
    c.set("logger", { warn: vi.fn() } as unknown as ApiRouteContext["logger"]);
    c.set("redis", {} as ApiRouteContext["redis"]);
    c.set("user", user);
    await next();
  });
  app.route("/", createAdminRoutes({
    db: {} as ApiRouteContext["db"],
    env: testEnv,
    logger: { warn: vi.fn() } as unknown as ApiRouteContext["logger"],
    realtimeSubscriber: {} as ApiRouteContext["realtimeSubscriber"],
    redis: {} as ApiRouteContext["redis"],
    repositoryRoot: "/repo",
    services: {} as ApiRouteContext["services"],
  }));
  return app;
}

describe("admin routes", () => {
  beforeEach(() => {
    serverMocks.getAdminPrincipalByEmail.mockReset();
    serverMocks.getManagedUserDetail.mockReset();
    serverMocks.listManagedUsers.mockReset();
  });

  it("requires authentication", async () => {
    const app = createAdminTestApp(null);

    const response = await app.request("/admin/me");

    expect(response.status).toBe(401);
  });

  it("requires an admin principal", async () => {
    serverMocks.getAdminPrincipalByEmail.mockResolvedValue(null);
    const app = createAdminTestApp(adminUser);

    const response = await app.request("/admin/me");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_REQUIRED" },
    });
  });

  it("returns the current admin principal", async () => {
    serverMocks.getAdminPrincipalByEmail.mockResolvedValue({
      email: "admin@example.com",
      id: "00000000-0000-0000-0000-000000000001",
      role: "admin",
    });
    const app = createAdminTestApp(adminUser);

    const response = await app.request("/admin/me");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      admin: {
        email: "admin@example.com",
        role: "admin",
      },
      user: {
        email: "admin@example.com",
      },
    });
  });

  it("does not expose Loki or Grafana credentials in observability config", async () => {
    serverMocks.getAdminPrincipalByEmail.mockResolvedValue({
      email: "admin@example.com",
      id: "00000000-0000-0000-0000-000000000001",
      role: "admin",
    });
    const app = createAdminTestApp(adminUser);

    const response = await app.request("/admin/observability/config");
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      defaultDashboardPath: "/d/tavro-admin-logs/tavro-ai-admin-logs",
      grafanaUrl: "http://localhost:3003",
    });
    expect(JSON.stringify(body)).not.toContain("LOKI");
    expect(JSON.stringify(body)).not.toContain("PASSWORD");
  });
});
