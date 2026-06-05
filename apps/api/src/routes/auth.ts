import { users } from "@agent-hub/db";
import { isDefaultAvatarPath, pickRandomDefaultAvatar } from "@agent-hub/core";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import argon2 from "argon2";

import type { AppBindings } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { createSession, revokeSession } from "../auth/session.js";
import {
  AuthUserResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
} from "../schemas/auth.js";
import { ErrorResponseSchema, OkResponseSchema } from "../schemas/common.js";

const invalidCredentialsResponse = {
  error: {
    code: "INVALID_CREDENTIALS",
    message: "Invalid email or password.",
  },
} as const;

function sessionCookieOptions(env: AppBindings["Variables"]["env"]) {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SECURE ? "None" : "Lax",
    path: "/",
    maxAge: env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60,
  } as const;
}

function clearSessionCookieOptions(env: AppBindings["Variables"]["env"]) {
  return {
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SECURE ? "None" : "Lax",
    path: "/",
  } as const;
}

const registerRoute = createRoute({
  method: "post",
  path: "/register",
  tags: ["Auth"],
  summary: "Register",
  description: "Create a user account and start a cookie session.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RegisterRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "User registered and logged in",
      content: {
        "application/json": {
          schema: AuthUserResponseSchema,
        },
      },
    },
    409: {
      description: "Email already exists",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Auth"],
  summary: "Login",
  description: "Verify credentials and start a cookie session.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: LoginRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Login succeeded",
      content: {
        "application/json": {
          schema: AuthUserResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid credentials",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Auth"],
  summary: "Logout",
  description: "Revoke current session and clear cookie.",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Logout succeeded",
      content: {
        "application/json": {
          schema: OkResponseSchema,
        },
      },
    },
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Auth"],
  summary: "Get current user",
  description: "Return the authenticated user.",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Current user",
      content: {
        "application/json": {
          schema: AuthUserResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication required",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const updateMeRoute = createRoute({
  method: "patch",
  path: "/me",
  tags: ["Auth"],
  summary: "Update current user",
  description: "Update current user settings.",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Updated user",
      content: {
        "application/json": {
          schema: AuthUserResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid user settings",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication required",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: "User not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export const authRoutes = new OpenAPIHono<AppBindings>();

authRoutes.openapi(registerRoute, async (c) => {
  const db = c.get("db");
  const env = c.get("env");
  const body = c.req.valid("json");
  const email = body.email.toLowerCase();

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    return c.json(
      {
        error: {
          code: "EMAIL_ALREADY_EXISTS",
          message: "Email already exists.",
        },
      },
      409,
    );
  }

  const passwordHash = await argon2.hash(body.password);
  const [user] = await db
    .insert(users)
    .values({
      email,
      name: body.name ?? null,
      avatar: pickRandomDefaultAvatar(),
      passwordHash,
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar: users.avatar,
    });

  const { token } = await createSession(db, {
    userId: user.id,
    ttlDays: env.AUTH_SESSION_TTL_DAYS,
  });

  setCookie(c, env.AUTH_SESSION_COOKIE, token, sessionCookieOptions(env));

  return c.json({ user }, 201);
});

authRoutes.openapi(loginRoute, async (c) => {
  const db = c.get("db");
  const env = c.get("env");
  const body = c.req.valid("json");
  const email = body.email.toLowerCase();

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar: users.avatar,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    return c.json(invalidCredentialsResponse, 401);
  }

  const validPassword = await argon2.verify(user.passwordHash, body.password);
  if (!validPassword) {
    return c.json(invalidCredentialsResponse, 401);
  }

  const { token } = await createSession(db, {
    userId: user.id,
    ttlDays: env.AUTH_SESSION_TTL_DAYS,
  });

  setCookie(c, env.AUTH_SESSION_COOKIE, token, sessionCookieOptions(env));

  return c.json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    },
    200,
  );
});

authRoutes.openapi(logoutRoute, async (c) => {
  const db = c.get("db");
  const env = c.get("env");
  const token = getCookie(c, env.AUTH_SESSION_COOKIE);

  if (token) {
    await revokeSession(db, token);
  }

  deleteCookie(c, env.AUTH_SESSION_COOKIE, clearSessionCookieOptions(env));

  return c.json({ ok: true }, 200);
});

authRoutes.use("/me", requireAuth);
authRoutes.openapi(meRoute, async (c) => {
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

  return c.json(
    {
      user,
    },
    200,
  );
});

authRoutes.openapi(updateMeRoute, async (c) => {
  const db = c.get("db");
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

  const body = (await c.req.json().catch(() => ({}))) as {
    avatar?: unknown;
  };
  const avatar = isDefaultAvatarPath(body.avatar) ? body.avatar : null;

  if (avatar === null) {
    return c.json(
      {
        error: {
          code: "INVALID_USER_SETTINGS",
          message: "avatar must be a default avatar path.",
        },
      },
      400,
    );
  }

  const [updatedUser] = await db
    .update(users)
    .set({
      avatar,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar: users.avatar,
    });

  if (updatedUser === undefined) {
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

  return c.json({ user: updatedUser }, 200);
});
