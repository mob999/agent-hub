import type { ApiEnv } from "@agent-hub/config";
import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppBindings } from "../../src/auth/middleware.js";
import { authRoutes } from "../../src/routes/auth.js";

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
  AGENTHUB_PUBLIC_WEB_URL: "http://127.0.0.1:5173",
  AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD: 60000,
};

function createRedisMock() {
  const store = new Map<string, string>();
  return {
    store,
    del: async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      let deleted = 0;
      for (const key of keyList) {
        if (store.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    },
    get: async (key: string) => store.get(key) ?? null,
    getDel: async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
  };
}

function createDbMock() {
  const user = {
    id: "user-id",
    email: "user@example.com",
    name: "User",
    avatar: "/avatars/default-1.svg",
  };

  return {
    insert: () => ({
      values: () => ({
        returning: async () => [
          {
            id: "session-id",
            userId: user.id,
            tokenHash: "token-hash",
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
            revokedAt: null,
          },
        ],
      }),
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [{ user }],
          }),
        }),
      }),
    }),
  };
}

function createDevelopmentLoginDbMock() {
  const developerUser = {
    id: "developer-user-id",
    email: "developer@tavro.local",
    name: "developer",
    avatar: "/avatars/default-1.svg",
  };

  return {
    insert: () => ({
      values: () => ({
        returning: async () => [
          {
            id: "session-id",
            userId: developerUser.id,
            tokenHash: "token-hash",
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
            revokedAt: null,
          },
        ],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [developerUser],
        }),
      }),
    }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}

function createAuthTestApp(options: {
  db?: AppBindings["Variables"]["db"];
  env?: ApiEnv;
  redis?: AppBindings["Variables"]["redis"] & { store?: Map<string, string> };
} = {}) {
  const app = new OpenAPIHono<AppBindings>();
  const redis = options.redis ?? createRedisMock();
  app.use("*", async (c, next) => {
    c.set("env", options.env ?? testEnv);
    c.set("db", options.db ?? ({} as AppBindings["Variables"]["db"]));
    c.set("logger", { warn: () => undefined } as unknown as AppBindings["Variables"]["logger"]);
    c.set("redis", redis as unknown as AppBindings["Variables"]["redis"]);
    c.set("user", null);
    await next();
  });
  app.route("/auth", authRoutes);
  return { app, redis };
}

describe("auth routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not expose legacy email registration or login", async () => {
    const { app } = createAuthTestApp();

    const registerResponse = await app.request("/auth/register", {
      method: "POST",
    });
    const loginResponse = await app.request("/auth/login", {
      method: "POST",
    });

    expect(registerResponse.status).toBe(404);
    expect(loginResponse.status).toBe(404);
  });

  it("starts GitHub OAuth by setting a state cookie and redirecting to GitHub", async () => {
    const { app } = createAuthTestApp();
    const response = await app.request(
      "/auth/github/start?redirect=/runs&web_origin=http://localhost:5173",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain(
      "agent_hub_github_oauth_state=",
    );

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(location.searchParams.get("client_id")).toBe("github-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/github/callback",
    );
    expect(location.searchParams.get("scope")).toBe("read:user user:email");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("uses the welcome page as the default GitHub OAuth return path", async () => {
    const { app } = createAuthTestApp();
    const response = await app.request(
      "/auth/github/start?web_origin=http://localhost:5173",
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookieValue = setCookie
      .split(";")[0]
      ?.replace("agent_hub_github_oauth_state=", "");
    const encodedPayload = cookieValue?.split(".")[1] ?? "";
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      redirectPath?: unknown;
    };

    expect(payload.redirectPath).toBe("/welcome");
  });

  it("redirects GitHub OAuth start to an error when OAuth is not configured", async () => {
    const { app } = createAuthTestApp({
      env: {
        ...testEnv,
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: undefined,
      },
    });
    const response = await app.request(
      "/auth/github/start?web_origin=http://localhost:5173",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:5173/login?error=github_oauth_unconfigured",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("creates a development session outside production", async () => {
    const { app } = createAuthTestApp({
      db: createDevelopmentLoginDbMock() as unknown as AppBindings["Variables"]["db"],
    });

    const response = await app.request("/auth/dev/login", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("agent_hub_session=");
    expect(await response.json()).toEqual({
      user: {
        id: "developer-user-id",
        email: "developer@tavro.local",
        name: "developer",
        avatar: "/avatars/default-1.svg",
      },
    });
  });

  it("does not allow development login in production", async () => {
    const { app } = createAuthTestApp({
      env: {
        ...testEnv,
        NODE_ENV: "production",
      },
    });

    const response = await app.request("/auth/dev/login", {
      method: "POST",
    });

    expect(response.status).toBe(404);
  });

  it("redirects invalid GitHub callbacks back to login with an error", async () => {
    const { app } = createAuthTestApp();
    const response = await app.request(
      "/auth/github/callback?code=bad-code&state=bad-state",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:5173/login?error=github_invalid_state",
    );
  });

  it("starts desktop GitHub OAuth by storing Redis state and returning an authorize URL", async () => {
    const { app, redis } = createAuthTestApp();
    const response = await app.request("/auth/desktop/github/start", {
      body: JSON.stringify({
        redirectPath: "/runs",
        webOrigin: "http://localhost:5173",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { authorizeUrl: string };
    const url = new URL(body.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("github-client-id");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(redis.store?.size).toBe(1);
  });

  it("completes desktop GitHub OAuth with a one-time code and sets a session cookie", async () => {
    const redis = createRedisMock();
    const { app } = createAuthTestApp({
      db: createDbMock() as unknown as AppBindings["Variables"]["db"],
      redis: redis as unknown as AppBindings["Variables"]["redis"] & { store: Map<string, string> },
    });
    const fetchMock = vi.fn(async (url: string | URL) => {
      const value = url.toString();
      if (value === "https://github.com/login/oauth/access_token") {
        return jsonResponse({ access_token: "github-access-token" });
      }
      if (value === "https://api.github.com/user") {
        return jsonResponse({
          avatar_url: "/avatars/default-1.svg",
          id: 123,
          login: "user",
          name: "User",
        });
      }
      if (value === "https://api.github.com/user/emails") {
        return jsonResponse([
          {
            email: "user@example.com",
            primary: true,
            verified: true,
          },
        ]);
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const startResponse = await app.request("/auth/desktop/github/start", {
      body: JSON.stringify({
        redirectPath: "/welcome",
        webOrigin: "http://localhost:5173",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const startBody = await startResponse.json() as { authorizeUrl: string };
    const state = new URL(startBody.authorizeUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackResponse = await app.request(
      `/auth/github/callback?code=github-code&state=${state}`,
    );

    expect(callbackResponse.status).toBe(302);
    const callbackUrl = new URL(callbackResponse.headers.get("location") ?? "");
    expect(callbackUrl.protocol).toBe("tavro:");
    expect(callbackUrl.hostname).toBe("auth");
    expect(callbackUrl.pathname).toBe("/callback");
    const loginCode = callbackUrl.searchParams.get("code");
    expect(loginCode).toBeTruthy();

    const completeResponse = await app.request(
      `/auth/desktop/complete?code=${loginCode}`,
    );

    expect(completeResponse.status).toBe(302);
    expect(completeResponse.headers.get("set-cookie")).toContain("agent_hub_session=");
    expect(completeResponse.headers.get("location")).toBe("http://localhost:5173/welcome");

    const replayResponse = await app.request(
      `/auth/desktop/complete?code=${loginCode}`,
    );
    expect(replayResponse.status).toBe(302);
    expect(replayResponse.headers.get("location")).toBe(
      "http://127.0.0.1:5173/login?error=desktop_auth_expired",
    );
  });
});
