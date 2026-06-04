import crypto from "node:crypto";

import { oauthAccounts, users } from "@agent-hub/db";
import { isDefaultAvatarPath, pickRandomDefaultAvatar } from "@agent-hub/core";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import argon2 from "argon2";

import {
  buildGitHubAuthorizeUrl,
  buildGitHubOAuthErrorRedirect,
  getGitHubOAuthWebOrigin,
  getSafeAuthRedirectPath,
  getSafeWebOrigin,
  githubOAuthStateCookie,
  selectVerifiedGitHubEmail,
  type GitHubEmail,
  type GitHubTokenResponse,
  type GitHubUser,
} from "../auth/github-oauth.js";
import type { AppBindings } from "../auth/middleware.js";
import { requireAuth } from "../auth/middleware.js";
import { canVerifyPasswordLogin } from "../auth/password.js";
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

const githubOAuthProvider = "github";
const githubOAuthStateMaxAgeSeconds = 10 * 60;

function createGitHubStateCookieValue(input: {
  state: string;
  redirectPath: string;
  webOrigin: string;
}): string {
  const payload = Buffer.from(
    JSON.stringify({
      redirectPath: input.redirectPath,
      webOrigin: input.webOrigin,
    }),
  ).toString("base64url");
  return `${input.state}.${payload}`;
}

function parseGitHubStateCookieValue(value: string | undefined):
  | {
      state: string;
      redirectPath: string;
      webOrigin: string | null;
    }
  | null {
  if (!value) {
    return null;
  }

  const [state, encodedPayload] = value.split(".", 2);
  if (!state || !encodedPayload) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as {
      redirectPath?: unknown;
      webOrigin?: unknown;
    };

    return {
      state,
      redirectPath: getSafeAuthRedirectPath(
        typeof payload.redirectPath === "string" ? payload.redirectPath : null,
      ),
      webOrigin: typeof payload.webOrigin === "string" ? payload.webOrigin : null,
    };
  } catch {
    return null;
  }
}

async function exchangeGitHubCodeForToken(input: {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  code: string;
}): Promise<string | null> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.callbackUrl,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as GitHubTokenResponse;
  return body.access_token ?? null;
}

async function fetchGitHubJson<T>(path: string, accessToken: string): Promise<T | null> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "AgentHub",
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
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

authRoutes.get("/github/start", (c) => {
  const env = c.get("env");
  const state = crypto.randomBytes(32).toString("base64url");
  const redirectPath = getSafeAuthRedirectPath(c.req.query("redirect") ?? null);
  const webOrigin = getGitHubOAuthWebOrigin(
    c.req.query("web_origin") ?? null,
    env.AGENTHUB_PUBLIC_WEB_URL,
  );

  setCookie(
    c,
    githubOAuthStateCookie,
    createGitHubStateCookieValue({ state, redirectPath, webOrigin }),
    {
      httpOnly: true,
      secure: env.AUTH_COOKIE_SECURE,
      sameSite: "Lax",
      path: "/auth/github",
      maxAge: githubOAuthStateMaxAgeSeconds,
    },
  );

  return c.redirect(
    buildGitHubAuthorizeUrl({
      clientId: env.GITHUB_CLIENT_ID,
      callbackUrl: env.GITHUB_OAUTH_CALLBACK_URL,
      state,
    }),
    302,
  );
});

authRoutes.get("/github/callback", async (c) => {
  const db = c.get("db");
  const env = c.get("env");
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stateCookie = parseGitHubStateCookieValue(
    getCookie(c, githubOAuthStateCookie),
  );
  const errorRedirect = (error: string) =>
    c.redirect(
      buildGitHubOAuthErrorRedirect(
        getSafeWebOrigin(stateCookie?.webOrigin ?? null, env.AGENTHUB_PUBLIC_WEB_URL),
        error,
      ),
      302,
    );

  deleteCookie(c, githubOAuthStateCookie, {
    path: "/auth/github",
  });

  if (!code || !state || stateCookie?.state !== state) {
    return errorRedirect("github_invalid_state");
  }

  const accessToken = await exchangeGitHubCodeForToken({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: env.GITHUB_OAUTH_CALLBACK_URL,
    code,
  });

  if (!accessToken) {
    return errorRedirect("github_token_exchange_failed");
  }

  const [githubUser, githubEmails] = await Promise.all([
    fetchGitHubJson<GitHubUser>("/user", accessToken),
    fetchGitHubJson<GitHubEmail[]>("/user/emails", accessToken),
  ]);

  if (!githubUser || !githubEmails) {
    return errorRedirect("github_profile_unavailable");
  }

  const email = selectVerifiedGitHubEmail(githubEmails);
  if (!email) {
    return errorRedirect("github_email_unavailable");
  }

  const providerUserId = String(githubUser.id);
  const [linkedAccount] = await db
    .select({
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        avatar: users.avatar,
      },
    })
    .from(oauthAccounts)
    .innerJoin(users, eq(oauthAccounts.userId, users.id))
    .where(
      and(
        eq(oauthAccounts.provider, githubOAuthProvider),
        eq(oauthAccounts.providerUserId, providerUserId),
      ),
    )
    .limit(1);

  let user = linkedAccount?.user;

  if (!user) {
    const [existingUser] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatar: users.avatar,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    user =
      existingUser ??
      (
        await db
          .insert(users)
          .values({
            email,
            name: githubUser.name ?? githubUser.login,
            avatar: githubUser.avatar_url ?? pickRandomDefaultAvatar(),
          })
          .returning({
            id: users.id,
            email: users.email,
            name: users.name,
            avatar: users.avatar,
          })
      )[0];

    await db.insert(oauthAccounts).values({
      userId: user.id,
      provider: githubOAuthProvider,
      providerUserId,
    });
  }

  const { token } = await createSession(db, {
    userId: user.id,
    ttlDays: env.AUTH_SESSION_TTL_DAYS,
  });

  setCookie(c, env.AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
    maxAge: env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60,
  });

  return c.redirect(
    new URL(
      stateCookie.redirectPath,
      getSafeWebOrigin(stateCookie.webOrigin, env.AGENTHUB_PUBLIC_WEB_URL),
    ).toString(),
    302,
  );
});

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

  setCookie(c, env.AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
    maxAge: env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60,
  });

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

  if (!canVerifyPasswordLogin(user.passwordHash)) {
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

  setCookie(c, env.AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
    maxAge: env.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60,
  });

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

  deleteCookie(c, env.AUTH_SESSION_COOKIE, {
    path: "/",
  });

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
