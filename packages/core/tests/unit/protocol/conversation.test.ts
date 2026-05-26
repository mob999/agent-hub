import type {
  Conversation,
  ConversationArtifact,
  CreateGroupConversationRequest,
  CreateGroupConversationResponse,
  ConversationMessage,
  UpdateGroupConversationRequest,
  UpdateGroupConversationResponse,
  ConversationTask,
} from "../../../src/protocol";
import { describe, expect, it } from "vitest";

describe("conversation protocol", () => {
  it("expresses built-in group conversations", () => {
    const conversation: Conversation = {
      id: "00000000-0000-4000-8000-000000000001",
      ownerUserId: "00000000-0000-4000-8000-000000000002",
      type: "group",
      key: "all",
      title: "all",
      status: "active",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
    };

    expect(conversation.key).toBe("all");
    expect(conversation.type).toBe("group");
  });

  it("expresses custom group conversations with agent members", () => {
    const request: CreateGroupConversationRequest = {
      title: "Design",
      description: "Design work",
      agentIds: [
        "00000000-0000-4000-8000-000000000003",
        "00000000-0000-4000-8000-000000000004",
      ],
      orchestratorAgentId: "00000000-0000-4000-8000-000000000003",
    };
    const response: CreateGroupConversationResponse = {
      conversation: {
        id: "00000000-0000-4000-8000-000000000001",
        ownerUserId: "00000000-0000-4000-8000-000000000002",
        type: "group",
        key: "design",
        title: "Design",
        description: request.description,
        agentIds: request.agentIds,
        orchestratorAgentId: request.orchestratorAgentId,
        status: "active",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      },
    };

    expect(response.conversation.type).toBe("group");
    expect(response.conversation.key).toBe("design");
    expect(response.conversation.description).toBe("Design work");
    expect(response.conversation.agentIds).toEqual(request.agentIds);
    expect(response.conversation.orchestratorAgentId).toBe(request.orchestratorAgentId);
  });

  it("expresses custom group conversation updates", () => {
    const request: UpdateGroupConversationRequest = {
      title: "Design Review",
      description: "Review design work",
      agentIds: ["00000000-0000-4000-8000-000000000004"],
      orchestratorAgentId: "00000000-0000-4000-8000-000000000004",
    };
    const response: UpdateGroupConversationResponse = {
      conversation: {
        id: "00000000-0000-4000-8000-000000000001",
        ownerUserId: "00000000-0000-4000-8000-000000000002",
        type: "group",
        key: "design review",
        title: request.title,
        description: request.description,
        agentIds: request.agentIds,
        orchestratorAgentId: request.orchestratorAgentId,
        status: "active",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:01.000Z",
      },
    };

    expect(response.conversation.title).toBe("Design Review");
    expect(response.conversation.agentIds).toEqual(request.agentIds);
  });

  it("expresses conversation tasks", () => {
    const artifact: ConversationArtifact = {
      id: "00000000-0000-4000-8000-000000000020",
      ownerUserId: "00000000-0000-4000-8000-000000000011",
      conversationId: "00000000-0000-4000-8000-000000000012",
      taskId: "00000000-0000-4000-8000-000000000010",
      runId: "00000000-0000-4000-8000-000000000016",
      creatorAgentId: "00000000-0000-4000-8000-000000000015",
      kind: "report",
      title: "Implementation report",
      filename: "implementation-report.md",
      mimeType: "text/markdown",
      sizeBytes: 2048,
      downloadUrl:
        "http://localhost:3000/artifacts/00000000-0000-4000-8000-000000000020/download",
      createdAt: "2026-05-26T00:00:01.000Z",
      updatedAt: "2026-05-26T00:00:01.000Z",
    };
    const task: ConversationTask = {
      id: "00000000-0000-4000-8000-000000000010",
      ownerUserId: "00000000-0000-4000-8000-000000000011",
      conversationId: "00000000-0000-4000-8000-000000000012",
      creatorRunId: "00000000-0000-4000-8000-000000000013",
      orchestratorAgentId: "00000000-0000-4000-8000-000000000014",
      assigneeAgentId: "00000000-0000-4000-8000-000000000015",
      assigneeRunId: "00000000-0000-4000-8000-000000000016",
      dispatchMessageId: "00000000-0000-4000-8000-000000000017",
      title: "Build the page",
      description: "Implement the task.",
      status: "succeeded",
      summary: "Built the page and uploaded a report.",
      resultArtifactIds: [artifact.id],
      artifacts: [artifact],
      completedAt: "2026-05-26T00:00:02.000Z",
      finalizerRunId: "00000000-0000-4000-8000-000000000021",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:01.000Z",
    };

    expect(task.status).toBe("succeeded");
    expect(task.assigneeRunId).toBeDefined();
    expect(task.artifacts?.[0]?.downloadUrl).toContain("/download");
  });

  it("expresses streaming agent messages linked to runs", () => {
    const message: ConversationMessage = {
      id: "00000000-0000-4000-8000-000000000003",
      conversationId: "00000000-0000-4000-8000-000000000001",
      senderType: "agent",
      senderAgentId: "00000000-0000-4000-8000-000000000004",
      runId: "00000000-0000-4000-8000-000000000005",
      content: "hello",
      status: "streaming",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:01.000Z",
    };

    expect(message.status).toBe("streaming");
    expect(message.runId).toBe("00000000-0000-4000-8000-000000000005");
  });
});
