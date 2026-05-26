import type {
  Conversation,
  CreateGroupConversationRequest,
  CreateGroupConversationResponse,
  ConversationMessage,
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
      agentIds: [
        "00000000-0000-4000-8000-000000000003",
        "00000000-0000-4000-8000-000000000004",
      ],
    };
    const response: CreateGroupConversationResponse = {
      conversation: {
        id: "00000000-0000-4000-8000-000000000001",
        ownerUserId: "00000000-0000-4000-8000-000000000002",
        type: "group",
        key: "design",
        title: "Design",
        agentIds: request.agentIds,
        status: "active",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      },
    };

    expect(response.conversation.type).toBe("group");
    expect(response.conversation.key).toBe("design");
    expect(response.conversation.agentIds).toEqual(request.agentIds);
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
