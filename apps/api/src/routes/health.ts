import { createRoute, OpenAPIHono } from "@hono/zod-openapi";

import type { AppBindings } from "../auth/middleware.js";
import { HealthResponseSchema } from "../schemas/common.js";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check",
  responses: {
    200: {
      description: "API is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

export function createHealthRoutes(): OpenAPIHono<AppBindings> {
  const app = new OpenAPIHono<AppBindings>();

  app.openapi(healthRoute, (c) => c.json({ ok: true }, 200));

  return app;
}
