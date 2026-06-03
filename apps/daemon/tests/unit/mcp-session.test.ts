import type { RunEvent } from "@agent-hub/core/protocol";
import type { AgentRunInput } from "@agent-hub/core/runtime";
import { describe, expect, it, vi } from "vitest";

import {
  createAgentHubMcpSession,
  type AgentHubMcpRelayLike,
} from "../../src/runtime";

function createRunInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    run: {
      id: "run_1",
      agentId: "agent_1",
      daemonDeviceId: "device_1",
      status: "running",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    },
    prompt: "hello runtime",
    workspacePath: "/tmp/agent-workspace",
    runtime: {
      runtimeKind: "codex",
      capabilities: [],
      updatedAt: "2026-05-21T00:00:00.000Z",
    },
    ...overrides,
  };
}

function createMcpRelayMock() {
  const sessions: Array<Parameters<AgentHubMcpRelayLike["createSession"]>[0]> = [];
  const handles: Array<ReturnType<AgentHubMcpRelayLike["createSession"]>> = [];
  const relay: AgentHubMcpRelayLike = {
    createSession: (input) => {
      const handle = {
        enabledTools: input.enabledTools,
        relayUrl: "http://127.0.0.1:4173",
        token: `session_${sessions.length + 1}`,
        close: vi.fn(),
      };

      sessions.push(input);
      handles.push(handle);

      return handle;
    },
  };

  return { handles, relay, sessions };
}

describe("createAgentHubMcpSession", () => {
  it("prefers the server-backed tool RPC when it is available", async () => {
    const { relay, sessions } = createMcpRelayMock();
    const events: RunEvent[] = [];
    const session = createAgentHubMcpSession({
      eventSink: { push: (event) => events.push(event) },
      relay,
      runInput: createRunInput({
        agentHubMcpTools: ["send_message"],
        callAgentHubMcpTool: async () => ({
          accepted: true,
          conversationId: "conversation_1",
          messageId: "message_1",
        }),
      }),
    });

    const result = await sessions[0].onToolCall({
      runId: "run_1",
      toolCallId: "tool_1",
      name: "send_message",
      input: { content: "hello" },
      createdAt: "2026-05-21T00:00:00.000Z",
    });

    expect(session?.enabledTools).toEqual(["send_message"]);
    expect(result).toEqual({
      accepted: true,
      conversationId: "conversation_1",
      messageId: "message_1",
    });
    expect(events).toEqual([]);
  });

  it("falls back to local tool events and current run goals", async () => {
    const { relay, sessions } = createMcpRelayMock();
    const events: RunEvent[] = [];

    createAgentHubMcpSession({
      eventSink: { push: (event) => events.push(event) },
      relay,
      runInput: createRunInput({
        agentHubMcpTools: ["list_goals"],
        agentHubMcpGoals: [
          {
            id: "goal_1",
            ownerUserId: "user_1",
            conversationId: "conversation_1",
            orchestratorAgentId: "agent_1",
            initialRunId: "run_1",
            title: "Build site",
            status: "active",
            tasks: [],
            createdAt: "2026-05-21T00:00:00.000Z",
            updatedAt: "2026-05-21T00:00:00.000Z",
          },
        ],
      }),
    });

    const result = await sessions[0].onToolCall({
      runId: "run_1",
      toolCallId: "tool_2",
      name: "list_goals",
      input: { status: "active" },
      createdAt: "2026-05-21T00:00:00.000Z",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "agenthub.tool.call",
        name: "list_goals",
      }),
    ]);
    expect(result).toMatchObject({
      accepted: true,
      goals: [
        {
          id: "goal_1",
          title: "Build site",
        },
      ],
    });
  });
});
