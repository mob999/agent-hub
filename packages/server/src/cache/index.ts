import crypto from "node:crypto";

import type { RealtimeEvent } from "@agent-hub/core";

import type { AgentHubLogger } from "../logger/index.js";
import type { AgentHubRedisClient } from "../queue/index.js";

export const cacheKeyPrefix = "agenthub:cache:v1";

export const cacheTtlSeconds = {
  conversationDetail: 10,
  session: 60,
  sidebar: 30,
} as const;

type CacheLogger = Pick<AgentHubLogger, "debug" | "warn">;

export function sessionCacheKey(token: string): string {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return `${cacheKeyPrefix}:session:${tokenHash}`;
}

export function userAgentsCacheKey(input: {
  status: string;
  userId: string;
}): string {
  return `${cacheKeyPrefix}:user:${input.userId}:agents:${input.status}`;
}

export function userConversationsCacheKey(input: {
  status: string;
  userId: string;
}): string {
  return `${cacheKeyPrefix}:user:${input.userId}:conversations:${input.status}`;
}

export function conversationMessagesCacheKey(input: {
  before?: string;
  conversationId: string;
  limit: number;
}): string {
  return [
    `${cacheKeyPrefix}:conversation:${input.conversationId}:messages`,
    `limit=${input.limit}`,
    `before=${input.before ?? "none"}`,
  ].join(":");
}

export function conversationTasksCacheKey(conversationId: string): string {
  return `${cacheKeyPrefix}:conversation:${conversationId}:tasks`;
}

export function conversationArtifactsCacheKey(conversationId: string): string {
  return `${cacheKeyPrefix}:conversation:${conversationId}:artifacts`;
}

export function conversationDeploymentsCacheKey(conversationId: string): string {
  return `${cacheKeyPrefix}:conversation:${conversationId}:deployments`;
}

export function userWelcomeCacheKey(userId: string): string {
  return `${cacheKeyPrefix}:user:${userId}:welcome`;
}

export function userWelcomeCachePatterns(userId: string): string[] {
  return [userWelcomeCacheKey(userId)];
}

export function userSidebarCachePatterns(userId: string): string[] {
  return [
    `${cacheKeyPrefix}:user:${userId}:agents:*`,
    `${cacheKeyPrefix}:user:${userId}:conversations:*`,
    ...userWelcomeCachePatterns(userId),
  ];
}

export function userConversationListCachePatterns(userId: string): string[] {
  return [
    `${cacheKeyPrefix}:user:${userId}:conversations:*`,
    ...userWelcomeCachePatterns(userId),
  ];
}

export function conversationDetailCachePatterns(conversationId: string): string[] {
  return [`${cacheKeyPrefix}:conversation:${conversationId}:*`];
}

export async function cachedJson<T>(
  redis: AgentHubRedisClient,
  options: {
    key: string;
    logger?: CacheLogger;
    ttlSeconds: number;
  },
  loader: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await redis.get(options.key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (error) {
    options.logger?.warn(
      { err: error, cacheKey: options.key },
      "Redis cache read failed; falling back to loader",
    );
  }

  const value = await loader();

  if (value === null) {
    return value;
  }

  try {
    await redis.set(options.key, JSON.stringify(value), {
      EX: options.ttlSeconds,
    });
  } catch (error) {
    options.logger?.warn(
      { err: error, cacheKey: options.key },
      "Redis cache write failed",
    );
  }

  return value;
}

export async function deleteCacheKeys(
  redis: AgentHubRedisClient,
  keys: string[],
  logger?: CacheLogger,
): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  try {
    await redis.del(keys);
  } catch (error) {
    logger?.warn({ err: error, cacheKeys: keys }, "Redis cache delete failed");
  }
}

export async function deleteCacheByPatterns(
  redis: AgentHubRedisClient,
  patterns: string[],
  logger?: CacheLogger,
): Promise<void> {
  for (const pattern of patterns) {
    try {
      const keys: string[] = [];
      for await (const key of redis.scanIterator({
        COUNT: 100,
        MATCH: pattern,
      })) {
        if (Array.isArray(key)) {
          keys.push(...key.map(String));
        } else {
          keys.push(String(key));
        }

        if (keys.length >= 100) {
          await redis.del(keys.splice(0, keys.length));
        }
      }

      if (keys.length > 0) {
        await redis.del(keys);
      }
    } catch (error) {
      logger?.warn({ err: error, pattern }, "Redis cache pattern delete failed");
    }
  }
}

export async function invalidateUserSidebarCache(
  redis: AgentHubRedisClient,
  input: { logger?: CacheLogger; userId: string },
): Promise<void> {
  await deleteCacheByPatterns(redis, userSidebarCachePatterns(input.userId), input.logger);
}

export async function invalidateUserConversationListCache(
  redis: AgentHubRedisClient,
  input: { logger?: CacheLogger; userId: string },
): Promise<void> {
  await deleteCacheByPatterns(
    redis,
    userConversationListCachePatterns(input.userId),
    input.logger,
  );
}

export async function invalidateUserWelcomeCache(
  redis: AgentHubRedisClient,
  input: { logger?: CacheLogger; userId: string },
): Promise<void> {
  await deleteCacheByPatterns(redis, userWelcomeCachePatterns(input.userId), input.logger);
}

export async function invalidateConversationCache(
  redis: AgentHubRedisClient,
  input: {
    conversationId: string;
    logger?: CacheLogger;
    ownerUserId?: string;
  },
): Promise<void> {
  await deleteCacheByPatterns(
    redis,
    [
      ...conversationDetailCachePatterns(input.conversationId),
      ...(input.ownerUserId === undefined
        ? []
        : userConversationListCachePatterns(input.ownerUserId)),
    ],
    input.logger,
  );
}

export async function invalidateCachesForRealtimeEvents(
  redis: AgentHubRedisClient,
  events: RealtimeEvent[],
  logger?: CacheLogger,
): Promise<void> {
  const seen = new Set<string>();
  const invalidations = events.flatMap((event) => {
    if (!("conversationId" in event) || event.conversationId === undefined) {
      return [];
    }

    const key = `${event.ownerUserId}:${event.conversationId}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);

    return [
      invalidateConversationCache(redis, {
        conversationId: event.conversationId,
        logger,
        ownerUserId: event.ownerUserId,
      }),
    ];
  });

  await Promise.all(invalidations);
}
