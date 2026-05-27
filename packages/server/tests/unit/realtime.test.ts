import { describe, expect, it, vi } from "vitest";

import type { AgentHubRedisClient } from "../../src";
import {
  createRealtimeEvent,
  publishRealtimeEvent,
  realtimeChannel,
  subscribeRealtimeEvents,
} from "../../src";

describe("realtime pub/sub", () => {
  it("creates realtime events with ids and timestamps", () => {
    const event = createRealtimeEvent({
      conversationId: "conversation-1",
      ownerUserId: "user-1",
      type: "conversation.updated",
    });

    expect(event.type).toBe("conversation.updated");
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.createdAt).toEqual(expect.any(String));
  });

  it("publishes events to the shared realtime channel", async () => {
    const redis = {
      publish: vi.fn().mockResolvedValue(1),
    };
    const event = createRealtimeEvent({
      conversationId: "conversation-1",
      ownerUserId: "user-1",
      type: "conversation.updated",
    });

    await publishRealtimeEvent(redis as unknown as AgentHubRedisClient, event);

    expect(redis.publish).toHaveBeenCalledWith(
      realtimeChannel,
      JSON.stringify(event),
    );
  });

  it("subscribes and parses realtime events", async () => {
    const event = createRealtimeEvent({
      conversationId: "conversation-1",
      ownerUserId: "user-1",
      type: "conversation.updated",
    });
    const redis = {
      subscribe: vi.fn(async (_channel: string, handler: (message: string) => void) => {
        handler(JSON.stringify(event));
      }),
    };
    const onEvent = vi.fn();

    await subscribeRealtimeEvents(
      redis as unknown as AgentHubRedisClient,
      onEvent,
    );

    expect(redis.subscribe).toHaveBeenCalledWith(
      realtimeChannel,
      expect.any(Function),
    );
    expect(onEvent).toHaveBeenCalledWith(event);
  });
});
