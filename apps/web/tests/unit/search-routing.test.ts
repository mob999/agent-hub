import { describe, expect, it } from "vitest";

import {
  chatConversationIdFromPath,
  getSearchRouteState,
  searchRoutePath,
  updateSearchRouteUrl,
} from "../../src/lib/search-route";

describe("search route helpers", () => {
  it("treats /chat/search as the dedicated search route", () => {
    expect(chatConversationIdFromPath("/chat/search")).toBeNull();
    expect(getSearchRouteState("/chat/search?q=on")).toMatchObject({
      isSearchRoute: true,
      query: "on",
    });
  });

  it("builds search routes with encoded filters", () => {
    expect(
      searchRoutePath({
        channelId: "conversation-1",
        query: "on board",
        sender: "user",
        sort: "recent",
        time: "7d",
      }),
    ).toBe(
      "/chat/search?q=on+board&sort=recent&channelId=conversation-1&sender=user&time=7d",
    );
  });

  it("preserves the pathname while updating search params", () => {
    expect(
      updateSearchRouteUrl("/chat/search?q=on", {
        query: "agent",
        sender: "agent-1",
      }),
    ).toBe("/chat/search?q=agent&sender=agent-1");
  });
});
