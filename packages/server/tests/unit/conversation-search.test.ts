import { describe, expect, it } from "vitest";

import {
  buildMessageSearchSnippet,
  scoreConversationSearchHit,
  scoreMessageSearchHit,
} from "../../src";

describe("conversation search helpers", () => {
  it("prefers title and agent name prefix matches for conversation relevance", () => {
    const titleScore = scoreConversationSearchHit({
      conversationDescription: "Planning work",
      conversationTitle: "onboarding-james-waterman",
      directAgentDescription: undefined,
      directAgentName: undefined,
      query: "on",
    });
    const descriptionScore = scoreConversationSearchHit({
      conversationDescription: "onboarding flow details",
      conversationTitle: "design",
      directAgentDescription: undefined,
      directAgentName: undefined,
      query: "on",
    });

    expect(titleScore.score).toBeGreaterThan(descriptionScore.score);
    expect(titleScore.matchedFields).toContain("title");
    expect(descriptionScore.matchedFields).toContain("description");
  });

  it("uses direct agent fields for DM conversation matches", () => {
    const match = scoreConversationSearchHit({
      conversationDescription: undefined,
      conversationTitle: "Bob",
      directAgentDescription: "Onboarding specialist",
      directAgentName: "Onyx",
      query: "on",
    });

    expect(match.score).toBeGreaterThan(0);
    expect(match.matchedFields).toEqual(
      expect.arrayContaining(["agentName", "agentDescription"]),
    );
  });

  it("prefers message content matches over sender and conversation labels", () => {
    const contentScore = scoreMessageSearchHit({
      content: "onboarding checklist attached",
      conversationLabel: "general",
      query: "on",
      senderLabel: "Alice",
    });
    const labelScore = scoreMessageSearchHit({
      content: "please review the update",
      conversationLabel: "onboarding",
      query: "on",
      senderLabel: "Alice",
    });

    expect(contentScore.score).toBeGreaterThan(labelScore.score);
    expect(contentScore.matchedFields).toContain("content");
    expect(labelScore.matchedFields).toContain("conversationTitle");
  });

  it("builds snippets around the first content hit", () => {
    expect(
      buildMessageSearchSnippet({
        content:
          "This is a longer onboarding message that explains the next steps for the new agent.",
        query: "onboarding",
      }),
    ).toContain("onboarding");
  });

  it("falls back to the leading content when the query only matches metadata", () => {
    expect(
      buildMessageSearchSnippet({
        content: "Short message body without the term.",
        query: "alice",
      }),
    ).toBe("Short message body without the term.");
  });
});
