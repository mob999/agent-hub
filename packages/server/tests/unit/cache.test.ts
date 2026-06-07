import { describe, expect, it, vi } from "vitest";

import type { AgentHubRedisClient } from "../../src";
import {
  cachedJson,
  deleteCacheByPatterns,
  invalidateCachesForRealtimeEvents,
} from "../../src";

describe("Redis cache helpers", () => {
  it("returns cached JSON without calling the loader", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })),
      set: vi.fn(),
    };
    const loader = vi.fn();

    const result = await cachedJson(
      redis as unknown as AgentHubRedisClient,
      { key: "cache:key", ttlSeconds: 30 },
      loader,
    );

    expect(result).toEqual({ ok: true });
    expect(loader).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("loads and caches JSON on cache miss", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
    };
    const loader = vi.fn().mockResolvedValue({ ok: true });

    const result = await cachedJson(
      redis as unknown as AgentHubRedisClient,
      { key: "cache:key", ttlSeconds: 30 },
      loader,
    );

    expect(result).toEqual({ ok: true });
    expect(redis.set).toHaveBeenCalledWith(
      "cache:key",
      JSON.stringify({ ok: true }),
      { EX: 30 },
    );
  });

  it("does not cache loader errors or null values", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    };

    await expect(
      cachedJson(
        redis as unknown as AgentHubRedisClient,
        { key: "cache:key", ttlSeconds: 30 },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");
    expect(redis.set).not.toHaveBeenCalled();

    const result = await cachedJson(
      redis as unknown as AgentHubRedisClient,
      { key: "cache:key", ttlSeconds: 30 },
      async () => null,
    );

    expect(result).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("falls back to the loader when Redis get fails", async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error("redis down")),
      set: vi.fn().mockResolvedValue("OK"),
    };
    const logger = {
      warn: vi.fn(),
    };

    const result = await cachedJson(
      redis as unknown as AgentHubRedisClient,
      { key: "cache:key", logger: logger as never, ttlSeconds: 30 },
      async () => ({ ok: true }),
    );

    expect(result).toEqual({ ok: true });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("deletes matching keys via scan", async () => {
    const scanIterator = vi.fn(async function* () {
      yield ["cache:a", "cache:b"];
      yield "cache:c";
    });

    const redis = {
      del: vi.fn().mockResolvedValue(1),
      scanIterator,
    };

    await deleteCacheByPatterns(
      redis as unknown as AgentHubRedisClient,
      ["cache:*"],
    );

    expect(redis.del).toHaveBeenCalledWith(["cache:a", "cache:b", "cache:c"]);
  });

  it("invalidates each realtime conversation once", async () => {
    const scanIterator = vi.fn(async function* () {
      yield ["cache:a"];
    });

    const redis = {
      del: vi.fn().mockResolvedValue(1),
      scanIterator,
    };

    await invalidateCachesForRealtimeEvents(
      redis as unknown as AgentHubRedisClient,
      [
        {
          conversationId: "conversation-1",
          createdAt: new Date().toISOString(),
          eventId: "event-1",
          ownerUserId: "user-1",
          type: "conversation.updated",
        },
        {
          conversationId: "conversation-1",
          createdAt: new Date().toISOString(),
          eventId: "event-2",
          ownerUserId: "user-1",
          type: "conversation.updated",
        },
      ],
    );

    expect(redis.scanIterator).toHaveBeenCalledTimes(3);
  });
});
