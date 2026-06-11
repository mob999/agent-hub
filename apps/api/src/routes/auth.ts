import crypto from "node:crypto";

import { oauthAccounts, users } from "@agent-hub/db";
import { isDefaultAvatarPath, pickRandomDefaultAvatar } from "@agent-hub/core";
import { deleteCacheKeys, sessionCacheKey } from "@agent-hub/server";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import {
  buildDesktopCompleteHtml,
  buildDesktopOAuthCallbackHtml,
  buildDesktopOAuthCallbackUrl,
  buildGitHubAuthorizeUrl,
  buildGitHubOAuthErrorRedirect,
  getGitHubOAuthWebOrigin,
  getSafeAuthRedirectPath,
  getSafeWebOrigin,
  githubOAuthStateCookie,
  selectVerifiedGitHubEmail,
  sha256Hex,
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
const desktopOAuthStateTtlSeconds = 10 * 60;
const desktopLoginCodeTtlSeconds = 5 * 60; // 5 minutes — enough for mobile OAuth flow
const desktopOAuthStateKeyPrefix = "agenthub:auth:desktop-oauth:state";
const desktopLoginCodeKeyPrefix = "agenthub:auth:desktop-login-code";
const developmentUserEmail = "developer@tavro.local";
const developmentUserName = "developer";

const DesktopGitHubStartRequestSchema = z.object({
  redirectPath: z.string().optional(),
  webOrigin: z.string().optional(),
}).openapi("DesktopGitHubStartRequest");

const DesktopGitHubStartResponseSchema = z.object({
  authorizeUrl: z.string().url(),
}).openapi("DesktopGitHubStartResponse");

type OAuthReturnTarget = {
  redirectPath: string;
  webOrigin: string;
};

type DesktopLoginCodePayload = OAuthReturnTarget & {
  userId: string;
};

type GitHubAuthUser = {
  avatar: string | null;
  email: string;
  id: string;
  name: string | null;
};

type GitHubOAuthConfig = {
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
};

function getGitHubOAuthConfig(
  env: AppBindings["Variables"]["env"],
): GitHubOAuthConfig | null {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return null;
  }

  return {
    callbackUrl: env.GITHUB_OAUTH_CALLBACK_URL,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}

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

function desktopOAuthStateKey(state: string): string {
  return `${desktopOAuthStateKeyPrefix}:${sha256Hex(state)}`;
}

function desktopLoginCodeKey(code: string): string {
  return `${desktopLoginCodeKeyPrefix}:${sha256Hex(code)}`;
}

async function writeDesktopOAuthState(
  redis: AppBindings["Variables"]["redis"],
  input: { redirectPath: string; state: string; webOrigin: string },
): Promise<void> {
  await redis.set(
    desktopOAuthStateKey(input.state),
    JSON.stringify({
      redirectPath: input.redirectPath,
      webOrigin: input.webOrigin,
    } satisfies OAuthReturnTarget),
    { EX: desktopOAuthStateTtlSeconds },
  );
}

async function consumeDesktopOAuthState(
  redis: AppBindings["Variables"]["redis"],
  state: string,
): Promise<OAuthReturnTarget | null> {
  const key = desktopOAuthStateKey(state);
  const value = await redis.get(key);
  if (value === null) {
    return null;
  }

  await redis.del(key);

  try {
    const payload = JSON.parse(value) as {
      redirectPath?: unknown;
      webOrigin?: unknown;
    };

    if (typeof payload.webOrigin !== "string") {
      return null;
    }

    return {
      redirectPath: getSafeAuthRedirectPath(
        typeof payload.redirectPath === "string" ? payload.redirectPath : null,
      ),
      webOrigin: payload.webOrigin,
    };
  } catch {
    return null;
  }
}

async function writeDesktopLoginCode(
  redis: AppBindings["Variables"]["redis"],
  input: DesktopLoginCodePayload,
): Promise<string> {
  const code = crypto.randomBytes(32).toString("base64url");
  await redis.set(desktopLoginCodeKey(code), JSON.stringify(input), {
    EX: desktopLoginCodeTtlSeconds,
  });
  return code;
}

async function consumeDesktopLoginCode(
  redis: AppBindings["Variables"]["redis"],
  code: string,
): Promise<DesktopLoginCodePayload | null> {
  const key = desktopLoginCodeKey(code);
  const redisWithGetDel = redis as AppBindings["Variables"]["redis"] & {
    getDel?: (key: string) => Promise<string | null>;
  };
  const value = redisWithGetDel.getDel
    ? await redisWithGetDel.getDel(key)
    : await redis.get(key);

  if (!redisWithGetDel.getDel) {
    await redis.del(key);
  }

  if (value === null) {
    return null;
  }

  try {
    const payload = JSON.parse(value) as {
      redirectPath?: unknown;
      userId?: unknown;
      webOrigin?: unknown;
    };

    if (typeof payload.userId !== "string" || typeof payload.webOrigin !== "string") {
      return null;
    }

    return {
      redirectPath: getSafeAuthRedirectPath(
        typeof payload.redirectPath === "string" ? payload.redirectPath : null,
      ),
      userId: payload.userId,
      webOrigin: payload.webOrigin,
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

async function findOrCreateUserFromGitHub(input: {
  db: AppBindings["Variables"]["db"];
  githubEmails: GitHubEmail[];
  githubUser: GitHubUser;
}): Promise<
  | {
      error: "github_email_unavailable" | "github_user_create_failed";
      user?: never;
    }
  | {
      error?: never;
      user: GitHubAuthUser;
    }
> {
  const { db, githubEmails, githubUser } = input;
  const email = selectVerifiedGitHubEmail(githubEmails);
  if (!email) {
    return { error: "github_email_unavailable" };
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
      return { error: "github_user_create_failed" };
    }

    await db.insert(oauthAccounts).values({
      userId: user.id,
      provider: githubOAuthProvider,
      providerUserId,
    });
  }

  return { user };
}

async function findOrCreateDevelopmentUser(
  db: AppBindings["Variables"]["db"],
): Promise<GitHubAuthUser | null> {
  const [existingUser] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar: users.avatar,
    })
    .from(users)
    .where(eq(users.email, developmentUserEmail))
    .limit(1);

  if (existingUser) {
    return existingUser;
  }

  const [createdUser] = await db
    .insert(users)
    .values({
      email: developmentUserEmail,
      name: developmentUserName,
      avatar: pickRandomDefaultAvatar(),
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar: users.avatar,
    });

  return createdUser ?? null;
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

const desktopGithubStartRoute = createRoute({
  method: "post",
  path: "/desktop/github/start",
  tags: ["Auth"],
  summary: "Start desktop GitHub OAuth",
  description: "Create a desktop OAuth request and return a GitHub authorization URL.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: DesktopGitHubStartRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "GitHub OAuth authorization URL",
      content: {
        "application/json": {
          schema: DesktopGitHubStartResponseSchema,
        },
      },
    },
    503: {
      description: "Desktop OAuth state could not be created",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const desktopCompleteRoute = createRoute({
  method: "get",
  path: "/desktop/complete",
  tags: ["Auth"],
  summary: "Complete desktop login",
  description: "Consume a one-time desktop login code, set the auth cookie, and redirect to the web app.",
  responses: {
    302: {
      description: "Redirect to the web app",
    },
  },
});

const developmentLoginRoute = createRoute({
  method: "post",
  path: "/dev/login",
  tags: ["Auth"],
  summary: "Development login",
  description:
    "Create a local development session for the built-in developer user. This route is unavailable in production.",
  responses: {
    200: {
      description: "Development login succeeded",
      content: {
        "application/json": {
          schema: AuthUserResponseSchema,
        },
      },
    },
    404: {
      description: "Development login is not available",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Development user could not be created",
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

authRoutes.openapi(desktopGithubStartRoute, async (c) => {
  const env = c.get("env");
  const logger = c.get("logger");
  const redis = c.get("redis");
  const body = c.req.valid("json");
  const githubConfig = getGitHubOAuthConfig(env);
  if (!githubConfig) {
    return c.json(
      {
        error: {
          code: "GITHUB_OAUTH_UNCONFIGURED",
          message: "GitHub OAuth is not configured.",
        },
      },
      503,
    );
  }

  const state = crypto.randomBytes(32).toString("base64url");
  const redirectPath = getSafeAuthRedirectPath(body.redirectPath ?? null);
  const webOrigin = getSafeWebOrigin(
    body.webOrigin ?? null,
    env.AGENTHUB_PUBLIC_WEB_URL,
    [env.AGENTHUB_PUBLIC_ADMIN_URL],
  );

  try {
    await writeDesktopOAuthState(redis, { redirectPath, state, webOrigin });
  } catch (error) {
    logger.warn({ err: error }, "Desktop GitHub OAuth state write failed");
    return c.json(
      {
        error: {
          code: "DESKTOP_AUTH_UNAVAILABLE",
          message: "Desktop login could not be started.",
        },
      },
      503,
    );
  }

  return c.json(
    {
      authorizeUrl: buildGitHubAuthorizeUrl({
        clientId: githubConfig.clientId,
        callbackUrl: githubConfig.callbackUrl,
        state,
      }),
    },
    200,
  );
});

authRoutes.openapi(githubStartRoute, (c) => {
  const env = c.get("env");
  const githubConfig = getGitHubOAuthConfig(env);
  const state = crypto.randomBytes(32).toString("base64url");
  const redirectPath = getSafeAuthRedirectPath(c.req.query("redirect") ?? null);
  const webOrigin = getGitHubOAuthWebOrigin(
    c.req.query("web_origin") ?? null,
    env.AGENTHUB_PUBLIC_WEB_URL,
    [env.AGENTHUB_PUBLIC_ADMIN_URL],
  );

  if (!githubConfig) {
    return c.redirect(
      buildGitHubOAuthErrorRedirect(webOrigin, "github_oauth_unconfigured"),
      302,
    );
  }

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
      clientId: githubConfig.clientId,
      callbackUrl: githubConfig.callbackUrl,
      state,
    }),
    302,
  );
});

authRoutes.openapi(githubCallbackRoute, async (c) => {
  const db = c.get("db");
  const env = c.get("env");
  const redis = c.get("redis");
  const githubConfig = getGitHubOAuthConfig(env);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stateCookie = parseGitHubStateCookieValue(
    getCookie(c, githubOAuthStateCookie),
  );

  deleteCookie(c, githubOAuthStateCookie, {
    path: "/auth/github",
  });

  const webReturnTarget: OAuthReturnTarget | null =
    code && state && stateCookie?.state === state
      ? {
          redirectPath: stateCookie.redirectPath,
          webOrigin: getSafeWebOrigin(
            stateCookie.webOrigin,
            env.AGENTHUB_PUBLIC_WEB_URL,
            [env.AGENTHUB_PUBLIC_ADMIN_URL],
          ),
        }
      : null;
  const desktopReturnTarget =
    webReturnTarget === null && state
      ? await consumeDesktopOAuthState(redis, state).catch(() => null)
      : null;
  const returnTarget = webReturnTarget ?? desktopReturnTarget;
  const isDesktopFlow = desktopReturnTarget !== null;

  const desktopCallbackResponse = (input:
    | { code: string; error?: never }
    | { code?: never; error: string }
  ) => {
    // Chrome Custom Tabs cannot follow HTTP 302 redirects to custom URL
    // schemes (tavro://).  Return an HTML page with a "Return to Tavro"
    // button that the user can tap — a user gesture reliably fires the
    // Android intent for the custom scheme and opens the app.
    const html = buildDesktopOAuthCallbackHtml(input);
    return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
  };

  const errorResponse = (error: string) => {
    if (isDesktopFlow) {
      return desktopCallbackResponse({ error });
    }
    return c.redirect(
      buildGitHubOAuthErrorRedirect(
        getSafeWebOrigin(
          returnTarget?.webOrigin ?? null,
          env.AGENTHUB_PUBLIC_WEB_URL,
          [env.AGENTHUB_PUBLIC_ADMIN_URL],
        ),
        error,
      ),
      302,
    );
  };

  if (!code || !state || !returnTarget) {
    return errorResponse("github_invalid_state");
  }

  if (!githubConfig) {
    return errorResponse("github_oauth_unconfigured");
  }

  const accessToken = await exchangeGitHubCodeForToken({
    clientId: githubConfig.clientId,
    clientSecret: githubConfig.clientSecret,
    callbackUrl: githubConfig.callbackUrl,
    code,
  });

  if (!accessToken) {
    return errorResponse("github_token_exchange_failed");
  }

  const [githubUser, githubEmails] = await Promise.all([
    fetchGitHubJson<GitHubUser>("/user", accessToken),
    fetchGitHubJson<GitHubEmail[]>("/user/emails", accessToken),
  ]);

  if (!githubUser || !githubEmails) {
    return errorResponse("github_profile_unavailable");
  }

  const result = await findOrCreateUserFromGitHub({ db, githubEmails, githubUser });
  if (result.error) {
    return errorResponse(result.error);
  }

  if (isDesktopFlow) {
    const loginCode = await writeDesktopLoginCode(redis, {
      redirectPath: returnTarget.redirectPath,
      userId: result.user.id,
      webOrigin: returnTarget.webOrigin,
    }).catch(() => null);

    if (!loginCode) {
      return errorResponse("desktop_auth_failed");
    }

    return desktopCallbackResponse({ code: loginCode });
  }

  const { token } = await createSession(db, {
    userId: result.user.id,
    ttlDays: env.AUTH_SESSION_TTL_DAYS,
  });

  setCookie(c, env.AUTH_SESSION_COOKIE, token, sessionCookieOptions(env));

  return c.redirect(
    new URL(
      returnTarget.redirectPath,
      returnTarget.webOrigin,
    ).toString(),
    302,
  );
});

authRoutes.openapi(desktopCompleteRoute, async (c) => {
  const db = c.get("db");
  const env = c.get("env");
  const redis = c.get("redis");
  const code = c.req.query("code");
  const asHtml = c.req.query("redirect") === "html";
  const fallbackWebOrigin = getSafeWebOrigin(null, env.AGENTHUB_PUBLIC_WEB_URL, [
    env.AGENTHUB_PUBLIC_ADMIN_URL,
  ]);

  const ok = (targetUrl: string) => {
    if (asHtml) {
      const html = buildDesktopCompleteHtml(targetUrl);
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    }
    return c.redirect(targetUrl, 302);
  };

  const fail = (error: string, webOrigin = fallbackWebOrigin) => {
    const targetUrl = buildGitHubOAuthErrorRedirect(webOrigin, error);
    if (asHtml) {
      const html = buildDesktopCompleteHtml(targetUrl);
      return c.body(html, 200, { "Content-Type": "text/html; charset=utf-8" });
    }
    return c.redirect(targetUrl, 302);
  };

  if (!code) {
    return fail("desktop_auth_expired");
  }

  const payload = await consumeDesktopLoginCode(redis, code).catch(() => null);
  if (!payload) {
    return fail("desktop_auth_expired");
  }

  const session = await createSession(db, {
    userId: payload.userId,
    ttlDays: env.AUTH_SESSION_TTL_DAYS,
  }).catch(() => null);
  if (!session) {
    return fail(
      "desktop_auth_failed",
      getSafeWebOrigin(payload.webOrigin, env.AGENTHUB_PUBLIC_WEB_URL, [
        env.AGENTHUB_PUBLIC_ADMIN_URL,
      ]),
    );
  }

  setCookie(c, env.AUTH_SESSION_COOKIE, session.token, sessionCookieOptions(env));

  const targetUrl = new URL(
    payload.redirectPath,
    getSafeWebOrigin(payload.webOrigin, env.AGENTHUB_PUBLIC_WEB_URL, [
      env.AGENTHUB_PUBLIC_ADMIN_URL,
    ]),
  ).toString();

  return ok(targetUrl);
});

authRoutes.openapi(developmentLoginRoute, async (c) => {
  const db = c.get("db");
  const env = c.get("env");

  if (env.NODE_ENV === "production") {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Not found.",
        },
      },
      404,
    );
  }

  const user = await findOrCreateDevelopmentUser(db);
  if (!user) {
    return c.json(
      {
        error: {
          code: "DEVELOPMENT_USER_CREATE_FAILED",
          message: "Development user could not be created.",
        },
      },
      500,
    );
  }

  const { token } = await createSession(db, {
    userId: user.id,
    ttlDays: env.AUTH_SESSION_TTL_DAYS,
  });

  setCookie(c, env.AUTH_SESSION_COOKIE, token, sessionCookieOptions(env));

  return c.json({ user }, 200);
});

authRoutes.openapi(logoutRoute, async (c) => {
  const db = c.get("db");
  const env = c.get("env");
  const logger = c.get("logger");
  const redis = c.get("redis");
  const token = getCookie(c, env.AUTH_SESSION_COOKIE);

  if (token) {
    await revokeSession(db, token);
    await deleteCacheKeys(redis, [sessionCacheKey(token)], logger);
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
  const env = c.get("env");
  const logger = c.get("logger");
  const redis = c.get("redis");
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

  const token = getCookie(c, env.AUTH_SESSION_COOKIE);
  if (token) {
    await deleteCacheKeys(redis, [sessionCacheKey(token)], logger);
  }

  return c.json({ user: updatedUser }, 200);
});
