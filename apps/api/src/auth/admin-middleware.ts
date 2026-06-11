import { getAdminPrincipalByEmail } from "@agent-hub/server";
import type { MiddlewareHandler } from "hono";

import type { AppBindings } from "./middleware.js";

export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
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

  const admin = await getAdminPrincipalByEmail(c.get("db"), user.email);
  if (admin === null) {
    c.set("admin", null);
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

  c.set("admin", admin);
  await next();
};
