import { describe, expect, it } from "vitest";

import {
  buildConversationRunPrompt,
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
});

