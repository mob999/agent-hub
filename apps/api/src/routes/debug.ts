import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth, type AppBindings } from "../auth/middleware.js";
import { AuthUserResponseSchema } from "../schemas/auth.js";
import { ErrorResponseSchema } from "../schemas/common.js";

const debugProtectedRoute = createRoute({
  method: "get",
  path: "/debug/protected",
  tags: ["Debug"],
  summary: "Protected debug endpoint",
  description: "Temporary endpoint for testing cookie authentication. Remove or restrict before production.",
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: "Authenticated user",
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

export function createDebugRoutes(): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();

  app.use("/debug/protected", requireAuth);
  app.openapi(debugProtectedRoute, (c) => {
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

    return c.json({ user }, 200);
  });

  return app;
}
