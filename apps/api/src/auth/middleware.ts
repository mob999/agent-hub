import type { ApiEnv } from "@agent-hub/config";
import type { Db } from "@agent-hub/db";
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
    user: AuthUser | null;
  };
};

export const attachAuthUser: MiddlewareHandler<AppBindings> = async (c, next) => {
  const db = c.get("db");
  const env = c.get("env");
  const token = getCookie(c, env.AUTH_SESSION_COOKIE);

  if (!token) {
    c.set("user", null);
    await next();
    return;
  }

  const result = await getUserBySessionToken(db, token);

  if (!result) {
    c.set("user", null);
    await next();
    return;
  }

  c.set("user", {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    avatar: result.user.avatar,
  });

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
