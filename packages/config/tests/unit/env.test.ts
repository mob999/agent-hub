import { describe, expect, it } from "vitest";

import { loadDaemonEnv } from "../../src/env";

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
