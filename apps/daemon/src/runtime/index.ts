export * from "./codex";
export * from "./claude";
export * from "./jsonl";
export * from "./common";
export * from "./mcp";

import type { RuntimeKind } from "@agent-hub/core";
import type { AgentAdapter } from "@agent-hub/core/runtime";

import { ClaudeCodeAdapter } from "./claude";
import { CodexAdapter } from "./codex";
import type { AgentHubMcpRelayLike, AgentHubMcpServerCommand } from "./mcp";

export interface RuntimeAdapterRegistryOptions {
  dailyMemoryRefreshIntervalMs?: number;
  dailyMemoryRefreshTranscriptMaxBytes?: number;
  CODEX_EXECUTABLE_PATH?: string;
  CLAUDE_CODE_EXECUTABLE_PATH?: string;
  mcpRelay?: AgentHubMcpRelayLike;
  mcpServerCommand?: AgentHubMcpServerCommand;
}

export function createRuntimeAdapters(
  options: RuntimeAdapterRegistryOptions = {},
) {
  return {
    codex: new CodexAdapter({
      dailyMemoryRefreshIntervalMs: options.dailyMemoryRefreshIntervalMs,
      dailyMemoryRefreshTranscriptMaxBytes:
        options.dailyMemoryRefreshTranscriptMaxBytes,
      executablePath: options.CODEX_EXECUTABLE_PATH,
      mcpRelay: options.mcpRelay,
      mcpServerCommand: options.mcpServerCommand,
    }),
    "claude-code": new ClaudeCodeAdapter({
      executablePath: options.CLAUDE_CODE_EXECUTABLE_PATH,
      mcpRelay: options.mcpRelay,
      mcpServerCommand: options.mcpServerCommand,
    }),
  };
}

export function getRuntimeAdapter(input: {
  adapters: Partial<Record<RuntimeKind, AgentAdapter>>;
  runtimeKind: RuntimeKind;
}): AgentAdapter {
  const adapter = input.adapters[input.runtimeKind];

  if (adapter === undefined) {
    throw new Error(
      `No daemon runtime adapter is registered for ${input.runtimeKind}.`,
    );
  }

  return adapter;
}
