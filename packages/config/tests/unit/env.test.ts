import { describe, expect, it } from "vitest";

import { loadApiEnv, loadDaemonEnv } from "../../src/env";

const baseApiEnv = {
  DATABASE_URL: "postgres://agent_hub:agent_hub@localhost:5432/agent_hub",
  REDIS_URL: "redis://localhost:6379",
  AGENTHUB_DAEMON_TOKEN: "daemon-token",
  AGENTHUB_DEFAULT_WORKSPACE_PATH: "/tmp/agent-hub",
  AGENTHUB_STORAGE_ROOT: "/tmp/agent-hub/storage",
};

describe("loadApiEnv", () => {
  it("allows GitHub OAuth config to be omitted outside production", () => {
    const env = loadApiEnv({
      ...baseApiEnv,
      NODE_ENV: "development",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
    });

    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.GITHUB_CLIENT_SECRET).toBeUndefined();
    expect(env.GITHUB_OAUTH_CALLBACK_URL).toBe(
      "http://localhost:3000/auth/github/callback",
    );
    expect(env.AGENTHUB_ADMIN_EMAILS).toBe("");
    expect(env.AGENTHUB_PUBLIC_ADMIN_URL).toBe("http://localhost:5174");
    expect(env.AGENTHUB_GRAFANA_URL).toBe("http://localhost:3003");
  });

  it("requires GitHub OAuth config in production", () => {
    expect(() =>
      loadApiEnv({
        ...baseApiEnv,
        NODE_ENV: "production",
      }),
    ).toThrow(/GITHUB_CLIENT_ID is required in production/);
  });
});

describe("loadDaemonEnv", () => {
  it("accepts CLAUDE_CODE_EXECUTABLE_PATH", () => {
    const env = loadDaemonEnv({
      AGENTHUB_DAEMON_GATEWAY_URL: "http://localhost:3000",
      AGENTHUB_DAEMON_TOKEN: "token",
      AGENTHUB_DEVICE_ID: "device_1",
      AGENTHUB_WORKSPACE_ROOT: "/tmp/agenthub",
      CODEX_EXECUTABLE_PATH: "codex",
      CLAUDE_CODE_EXECUTABLE_PATH: "claude-cc-deepseek",
    });

    expect(env.CODEX_EXECUTABLE_PATH).toBe("codex");
    expect(env.CLAUDE_CODE_EXECUTABLE_PATH).toBe("claude-cc-deepseek");
  });
});
