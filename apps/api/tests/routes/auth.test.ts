import type { ApiEnv } from "@agent-hub/config";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

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
  GITHUB_OAUTH_CALLBACK_URL: "http://127.0.0.1:3000/auth/github/callback",
  AGENTHUB_DEFAULT_WORKSPACE_PATH: "/tmp/agent-hub",
  AGENTHUB_STORAGE_ROOT: "/tmp/agent-hub/storage",
  AGENTHUB_PUBLIC_API_URL: "http://localhost:3000",
  AGENTHUB_PUBLIC_WEB_URL: "http://127.0.0.1:5173",
  AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD: 60000,
};

function createAuthTestApp() {
  const app = new OpenAPIHono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("env", testEnv);
    c.set("db", {} as AppBindings["Variables"]["db"]);
    c.set("user", null);
    await next();
  });
  app.route("/auth", authRoutes);
  return app;
}

describe("auth routes", () => {
  it("does not expose legacy email registration or login", async () => {
    const app = createAuthTestApp();

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
    const app = createAuthTestApp();
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
      "http://127.0.0.1:3000/auth/github/callback",
    );
    expect(location.searchParams.get("scope")).toBe("read:user user:email");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("redirects invalid GitHub callbacks back to login with an error", async () => {
    const app = createAuthTestApp();
    const response = await app.request(
      "/auth/github/callback?code=bad-code&state=bad-state",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:5173/login?error=github_invalid_state",
    );
  });
});
