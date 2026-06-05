import crypto from "node:crypto";

import { oauthAccounts, users } from "@agent-hub/db";
import { isDefaultAvatarPath, pickRandomDefaultAvatar } from "@agent-hub/core";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

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
import { createSession, revokeSession } from "../auth/session.js";
import { AuthUserResponseSchema } from "../schemas/auth.js";
import { ErrorResponseSchema, OkResponseSchema } from "../schemas/common.js";

const githubOAuthProvider = "github";
const githubOAuthStateMaxAgeSeconds = 10 * 60;

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

async function fetchGitHubJson<T>(
  path: string,
  accessToken: string,
): Promise<T | null> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Tavro",
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
}

const githubStartRoute = createRoute({
  method: "get",
  path: "/github/start",
  tags: ["Auth"],
  summary: "Start GitHub OAuth",
  description: "Redirect to GitHub to start the OAuth login flow.",
  responses: {
    302: {
      description: "Redirect to GitHub OAuth authorization",
    },
  },
});

const githubCallbackRoute = createRoute({
  method: "get",
  path: "/github/callback",
  tags: ["Auth"],
  summary: "GitHub OAuth callback",
  description: "Complete GitHub OAuth login and redirect back to the web app.",
  responses: {
    302: {
      description: "Redirect back to the web app",
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

authRoutes.openapi(githubStartRoute, (c) => {
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

authRoutes.openapi(githubCallbackRoute, async (c) => {
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

    if (!user) {
      return errorRedirect("github_user_create_failed");
    }

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

  setCookie(c, env.AUTH_SESSION_COOKIE, token, sessionCookieOptions(env));

  return c.redirect(
    new URL(
      stateCookie.redirectPath,
      getSafeWebOrigin(stateCookie.webOrigin, env.AGENTHUB_PUBLIC_WEB_URL),
    ).toString(),
    302,
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
