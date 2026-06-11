import {
  getManagedUserDetail,
  listManagedUsers,
  type AdminManagedUser,
} from "@agent-hub/server";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { requireAdmin } from "../auth/admin-middleware.js";
import type { AppBindings } from "../auth/middleware.js";
import type { ApiRouteContext } from "../context.js";
import { ErrorResponseSchema } from "../schemas/common.js";

const AdminUserSchema = z
  .object({
    avatar: z.string().nullable(),
    createdAt: z.string(),
    email: z.string().email(),
    id: z.string().uuid(),
    name: z.string().nullable(),
    oauthProviderCount: z.number().int().nonnegative(),
    sessionCount: z.number().int().nonnegative(),
    updatedAt: z.string(),
    welcomeOnboardingCompletedAt: z.string().nullable(),
  })
  .openapi("AdminUser");

const AdminUserDetailSchema = AdminUserSchema.extend({
  lastSessionCreatedAt: z.string().nullable(),
  oauthProviders: z.array(z.string()),
}).openapi("AdminUserDetail");

const AdminMeResponseSchema = z
  .object({
    admin: z.object({
      email: z.string().email(),
      id: z.string().uuid(),
      role: z.literal("admin"),
    }),
    user: z.object({
      avatar: z.string().nullable(),
      email: z.string().email(),
      id: z.string(),
      name: z.string().nullable(),
    }),
  })
  .openapi("AdminMeResponse");

const AdminUsersResponseSchema = z
  .object({
    total: z.number().int().nonnegative(),
    users: z.array(AdminUserSchema),
  })
  .openapi("AdminUsersResponse");

const AdminUserDetailResponseSchema = z
  .object({
    user: AdminUserDetailSchema,
  })
  .openapi("AdminUserDetailResponse");

const AdminObservabilityConfigSchema = z
  .object({
    allowedVariables: z.array(z.enum(["service", "level", "query"])),
    defaultDashboardPath: z.string(),
    grafanaUrl: z.string().url(),
  })
  .openapi("AdminObservabilityConfig");

function numberQuery(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listParams(c: { req: { query: (name: string) => string | undefined } }) {
  const page = Math.max(1, numberQuery(c.req.query("page"), 1));
  const perPage = Math.min(Math.max(1, numberQuery(c.req.query("perPage"), 25)), 100);
  const search = c.req.query("search")?.trim();

  return {
    limit: perPage,
    offset: (page - 1) * perPage,
    search: search === undefined || search.length === 0 ? undefined : search,
  };
}

const adminMeRoute = createRoute({
  method: "get",
  path: "/admin/me",
  tags: ["Admin"],
  summary: "Get current admin principal",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Current admin principal",
      content: { "application/json": { schema: AdminMeResponseSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Administrator access required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const adminUsersRoute = createRoute({
  method: "get",
  path: "/admin/users",
  tags: ["Admin"],
  summary: "List managed users",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Managed users",
      content: { "application/json": { schema: AdminUsersResponseSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Administrator access required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const adminUserDetailRoute = createRoute({
  method: "get",
  path: "/admin/users/{userId}",
  tags: ["Admin"],
  summary: "Get managed user detail",
  security: [{ cookieAuth: [] }],
  request: {
    params: z.object({
      userId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "Managed user detail",
      content: { "application/json": { schema: AdminUserDetailResponseSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Administrator access required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const adminObservabilityConfigRoute = createRoute({
  method: "get",
  path: "/admin/observability/config",
  tags: ["Admin"],
  summary: "Get admin observability embed config",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Grafana embed config",
      content: { "application/json": { schema: AdminObservabilityConfigSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    403: {
      description: "Administrator access required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export function createAdminRoutes(context: ApiRouteContext): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();
  const { db, env } = context;

  app.use("/admin/*", requireAdmin);

  app.openapi(adminMeRoute, (c) => {
    const admin = c.get("admin");
    const user = c.get("user");

    if (admin === null || user === null) {
      return c.json(
        {
          error: {
            code: "ADMIN_REQUIRED",
            message: "Administrator access is required.",
          },
        },
        403,
      );
    }

    return c.json({ admin, user }, 200);
  });

  app.openapi(adminUsersRoute, async (c) => {
    const params = listParams(c);
    const result = await listManagedUsers(db, params);
    return c.json(result satisfies { total: number; users: AdminManagedUser[] }, 200);
  });

  app.openapi(adminUserDetailRoute, async (c) => {
    const userId = c.req.param("userId");
    const user = await getManagedUserDetail(db, { userId });

    if (user === null) {
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

    return c.json({ user }, 200);
  });

  app.openapi(adminObservabilityConfigRoute, (c) =>
    c.json(
      {
        allowedVariables: ["service", "level", "query"] as Array<
          "service" | "level" | "query"
        >,
        defaultDashboardPath: env.AGENTHUB_GRAFANA_ADMIN_DASHBOARD_PATH,
        grafanaUrl: env.AGENTHUB_GRAFANA_URL,
      },
      200,
    ),
  );

  return app;
}
