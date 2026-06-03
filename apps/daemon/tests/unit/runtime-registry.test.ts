import { describe, expect, it, vi } from "vitest";

import { CodexAdapter, ClaudeCodeAdapter, createRuntimeAdapters, getRuntimeAdapter } from "../../src/runtime";

describe("runtime registry", () => {
  it("creates both codex and claude adapters from daemon env", () => {
    const adapters = createRuntimeAdapters({
      CODEX_EXECUTABLE_PATH: "codex-bin",
      CLAUDE_CODE_EXECUTABLE_PATH: "claude-cc-deepseek",
    });

    expect(adapters.codex).toBeInstanceOf(CodexAdapter);
    expect(adapters["claude-code"]).toBeInstanceOf(ClaudeCodeAdapter);
  });

  it("returns the adapter that matches runtime kind", () => {
    const codex = { runtimeKind: "codex" } as CodexAdapter;
    const claude = { runtimeKind: "claude-code" } as ClaudeCodeAdapter;

    expect(getRuntimeAdapter({
      adapters: {
        codex,
        "claude-code": claude,
      },
      runtimeKind: "claude-code",
    })).toBe(claude);
  });

  it("throws when the assigned runtime is not registered", () => {
    expect(() =>
      getRuntimeAdapter({
        adapters: {
          codex: { runtimeKind: "codex" } as CodexAdapter,
        },
        runtimeKind: "claude-code",
      })
    ).toThrow("No daemon runtime adapter is registered for claude-code.");
  });
});
