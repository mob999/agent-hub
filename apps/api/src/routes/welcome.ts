import {
  cacheTtlSeconds,
  cachedJson,
  completeWelcomeOnboardingForUser,
  getWelcomeSummaryForUser,
  invalidateUserWelcomeCache,
  userWelcomeCacheKey,
} from "@agent-hub/server";
import { OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth, type AppBindings } from "../auth/middleware.js";
import type { ApiRouteContext } from "../context.js";
import { openApiRoute } from "./openapi.js";

export function createWelcomeRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env, logger, redis } = context;

  app.use("/welcome", requireAuth);
  app.use("/welcome/*", requireAuth);

  openApiRoute(app, "get", "/welcome", async (c) => {
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

    const welcome = await cachedJson(
      redis,
      {
        key: userWelcomeCacheKey(user.id),
        logger,
        ttlSeconds: cacheTtlSeconds.sidebar,
      },
      () => getWelcomeSummaryForUser(db, {
        ownerUserId: user.id,
        publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
        publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
      }),
    );

    if (welcome === null) {
      return c.json(
        {
          error: {
            code: "USER_NOT_FOUND",
            message: "User was not found.",
          },
        },
        404,
      );
    }

    return c.json({ welcome });
  });

  openApiRoute(app, "post", "/welcome/onboarding/complete", async (c) => {
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

    await invalidateUserWelcomeCache(redis, { logger, userId: user.id });

    const result = await completeWelcomeOnboardingForUser(db, {
      ownerUserId: user.id,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      publicWebBaseUrl: env.AGENTHUB_PUBLIC_WEB_URL,
    });

    if (result.status === "not-found") {
      return c.json(
        {
          error: {
            code: "USER_NOT_FOUND",
            message: "User was not found.",
          },
        },
        404,
      );
    }

    if (result.status === "not-ready") {
      return c.json(
        {
          error: {
            code: "WELCOME_ONBOARDING_NOT_READY",
            message: "Welcome onboarding prerequisites are not complete.",
          },
          welcome: result.welcome,
        },
        400,
      );
    }

    await invalidateUserWelcomeCache(redis, { logger, userId: user.id });

    return c.json({ welcome: result.welcome });
  });

  return app;
}
