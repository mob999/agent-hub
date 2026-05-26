import type {
  AgentHubCreateTaskToolInput,
  AgentHubCreateTaskToolResult,
  AgentHubMcpToolCall,
  AgentHubSendMessageToolInput,
} from "../../../src/protocol";
import { describe, expect, it } from "vitest";

describe("AgentHub MCP protocol", () => {
  it("expresses send_message with mentions and task ids", () => {
    const input: AgentHubSendMessageToolInput = {
      content: "Deploying this to @Codex",
      mentions: [
        {
          type: "agent",
          agentId: "00000000-0000-4000-8000-000000000001",
          label: "Codex",
        },
      ],
      taskIds: ["00000000-0000-4000-8000-000000000002"],
    };

    expect(input.mentions?.[0]?.label).toBe("Codex");
    expect(input.taskIds).toHaveLength(1);
  });

  it("expresses create_task tool calls and results", () => {
    const input: AgentHubCreateTaskToolInput = {
      title: "Write tests",
      description: "Cover the orchestrator dispatch path.",
      assigneeAgentId: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
    };
    const call: AgentHubMcpToolCall = {
      runId: "00000000-0000-4000-8000-000000000003",
      toolCallId: "tool_1",
      name: "create_task",
      input,
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    const result: AgentHubCreateTaskToolResult = {
      accepted: true,
      task: {
        id: input.taskId,
        title: input.title,
        assigneeAgentId: input.assigneeAgentId,
      },
    };

    expect(call.name).toBe("create_task");
    expect(result.task.id).toBe(input.taskId);
  });
});
