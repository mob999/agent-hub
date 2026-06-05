import type { ApiEnv } from "@agent-hub/config";
import type { Db } from "@agent-hub/db";
import {
  cacheTtlSeconds,
  deleteCacheKeys,
  type AgentHubLogger,
  type AgentHubRedisClient,
  sessionCacheKey,
} from "@agent-hub/server";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { getUserBySessionToken } from "./session.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
};

export type AppBindings = {
  Variables: {
    db: Db;
    env: ApiEnv;
    logger: AgentHubLogger;
    redis: AgentHubRedisClient;
    user: AuthUser | null;
  };
};

type CachedSessionUser = {
  expiresAt: string;
  user: AuthUser;
};

export const attachAuthUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  const db = c.get("db");
  const env = c.get("env");
  const logger = c.get("logger");
  const redis = c.get("redis");
  const token = getCookie(c, env.AUTH_SESSION_COOKIE);

  if (!token) {
    c.set("user", null);
    await next();
    return;
  }

  const cacheKey = sessionCacheKey(token);
  let result: CachedSessionUser | null = null;

  try {
    const cached = await redis.get(cacheKey);
    result = cached === null ? null : JSON.parse(cached) as CachedSessionUser;
  } catch (error) {
    logger.warn(
      { err: error, cacheKey },
      "Redis session cache read failed; falling back to database",
    );
  }

  if (result === null) {
    const sessionResult = await getUserBySessionToken(db, token);
    if (sessionResult) {
      result = {
        expiresAt: sessionResult.session.expiresAt.toISOString(),
        user: {
          id: sessionResult.user.id,
          email: sessionResult.user.email,
          name: sessionResult.user.name,
          avatar: sessionResult.user.avatar,
        },
      };

      const remainingTtlSeconds = Math.max(
        0,
        Math.floor((sessionResult.session.expiresAt.getTime() - Date.now()) / 1000),
      );
      const ttlSeconds = Math.min(cacheTtlSeconds.session, remainingTtlSeconds);

      if (ttlSeconds > 0) {
        try {
          await redis.set(cacheKey, JSON.stringify(result), { EX: ttlSeconds });
        } catch (error) {
          logger.warn({ err: error, cacheKey }, "Redis session cache write failed");
        }
      } else {
        await deleteCacheKeys(redis, [cacheKey], logger);
      }
    }
  }

  if (!result) {
    c.set("user", null);
    await next();
    return;
  }

  c.set("user", result.user);

  await next();
};

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = c.get("user");

  if (!user) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required.",
        },
      },
      401,
    );
  }

  await next();
};
