import type { ApiEnv } from "@agent-hub/config";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../../src/auth/middleware.js";
import { attachAuthUser } from "../../src/auth/middleware.js";
import { getUserBySessionToken } from "../../src/auth/session.js";

vi.mock("../../src/auth/session.js", () => ({
  getUserBySessionToken: vi.fn(),
}));

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
  AGENTHUB_STORAGE_ROOT: "/tmp/agent-hub/storage",
  AGENTHUB_PUBLIC_API_URL: "http://localhost:3000",
  AGENTHUB_PUBLIC_WEB_URL: "http://127.0.0.1:5173",
  AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD: 60000,
};

function createTestApp(redis: Partial<AppBindings["Variables"]["redis"]>) {
  const app = new OpenAPIHono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("env", testEnv);
    c.set("db", {} as AppBindings["Variables"]["db"]);
    c.set("logger", { warn: vi.fn() } as unknown as AppBindings["Variables"]["logger"]);
    c.set("redis", redis as AppBindings["Variables"]["redis"]);
    await next();
  });
  app.use("*", attachAuthUser);
  app.get("/me", (c) => c.json({ user: c.get("user") }));
  return app;
}

describe("auth middleware session cache", () => {
  beforeEach(() => {
    vi.mocked(getUserBySessionToken).mockReset();
  });

  it("uses cached session users without querying the database", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        user: {
          avatar: null,
          email: "user@example.com",
          id: "user-1",
          name: "Ada",
        },
      })),
      set: vi.fn(),
    };
    const app = createTestApp(redis);

    const response = await app.request("/me", {
      headers: {
        cookie: "agent_hub_session=session-token",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        avatar: null,
        email: "user@example.com",
        id: "user-1",
        name: "Ada",
      },
    });
    expect(getUserBySessionToken).not.toHaveBeenCalled();
  });

  it("caches database session lookups with the remaining session ttl", async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    vi.mocked(getUserBySessionToken).mockResolvedValue({
      session: {
        expiresAt,
      },
      user: {
        avatar: "/avatars/default-1.svg",
        email: "user@example.com",
        id: "user-1",
        name: "Ada",
      },
    } as Awaited<ReturnType<typeof getUserBySessionToken>>);
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
    };
    const app = createTestApp(redis);

    const response = await app.request("/me", {
      headers: {
        cookie: "agent_hub_session=session-token",
      },
    });

    expect(response.status).toBe(200);
    expect(getUserBySessionToken).toHaveBeenCalledWith(
      expect.anything(),
      "session-token",
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^agenthub:cache:v1:session:/),
      expect.any(String),
      { EX: 60 },
    );
  });
});
