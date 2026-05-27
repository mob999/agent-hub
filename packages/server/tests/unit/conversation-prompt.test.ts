import { describe, expect, it } from "vitest";

import {
  buildAgentGroupsPrompt,
  buildAssignedTaskPrompt,
  buildConversationRunPrompt,
  resolveTextMentionedAgentIds,
  type ConversationMessage,
} from "../../src";

function createMessage(
  overrides: Partial<ConversationMessage>,
): ConversationMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    senderType: "user",
    content: "hello",
    status: "completed",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("conversation prompt builder", () => {
  it("returns the current message when there is no history", () => {
    expect(
      buildConversationRunPrompt({
        currentUserMessage: "Ship this change.",
        messages: [],
      }),
    ).toBe("Ship this change.");
  });

  it("includes prior conversation messages before the current request", () => {
    const prompt = buildConversationRunPrompt({
      currentUserMessage: "Now add tests.",
      messages: [
        createMessage({ senderType: "user", content: "Build the page." }),
        createMessage({
          senderType: "agent",
          senderAgentId: "00000000-0000-4000-8000-000000000003",
          content: "The page is implemented.",
        }),
        createMessage({ senderType: "agent", content: "   " }),
      ],
      agentNamesById: {
        "00000000-0000-4000-8000-000000000003": "dudu",
      },
    });

    expect(prompt).toBe([
      "<conversation_history>",
      "User:\nBuild the page.",
      "",
      "dudu:\nThe page is implemented.",
      "</conversation_history>",
      "",
      "<user_request>",
      "Now add tests.",
      "</user_request>",
    ].join("\n"));
  });

  it("includes the assigned task id for MCP task completion tools", () => {
    const prompt = buildAssignedTaskPrompt({
      conversationTitle: "Research",
      taskId: "00000000-0000-4000-8000-000000000010",
      taskTitle: "Write the report",
      taskDescription: "Summarize the findings.",
      dispatchMessage: "@dudu please write this report.",
    });

    expect(prompt).toContain("Task ID: 00000000-0000-4000-8000-000000000010");
    expect(prompt).toContain(
      "Use the exact Task ID above when calling AgentHub MCP upload_artifact and complete_task.",
    );
  });

  it("describes the active groups an agent can message", () => {
    const prompt = buildAgentGroupsPrompt([
      {
        agents: [{ id: "agent-all", name: "coco" }],
        conversationId: "00000000-0000-4000-8000-000000000020",
        groupName: "all",
        title: "all",
      },
      {
        agents: [
          { id: "agent-design-1", name: "dudu" },
          { id: "agent-design-2", name: "jojo" },
        ],
        conversationId: "00000000-0000-4000-8000-000000000021",
        groupName: "Design",
        title: "Design",
      },
    ]);

    expect(prompt).toContain("- #all (groupName: all, conversationId:");
    expect(prompt).toContain("agents: @coco");
    expect(prompt).toContain("- #Design (groupName: Design, conversationId:");
    expect(prompt).toContain("agents: @dudu, @jojo");
    expect(prompt).toContain("send_message_to_group");
    expect(prompt).toContain("send_message_to_user");
  });

  it("resolves text mentions by longest agent name first", () => {
    const mentionedAgentIds = resolveTextMentionedAgentIds(
      "@jojo please pair with @Coco Team. @missing is ignored. @jojo again.",
      [
        { id: "agent-jo", name: "jo" },
        { id: "agent-jojo", name: "jojo" },
        { id: "agent-coco-team", name: "Coco Team" },
      ],
    );

    expect(mentionedAgentIds).toEqual(["agent-jojo", "agent-coco-team"]);
  });

  it("does not return the sender when resolving text mentions", () => {
    expect(
      resolveTextMentionedAgentIds(
        "@dudu please continue",
        [{ id: "agent-dudu", name: "dudu" }],
        { excludeAgentId: "agent-dudu" },
      ),
    ).toEqual([]);
  });
});

