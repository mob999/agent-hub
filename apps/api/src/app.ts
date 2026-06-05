import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import { attachAuthUser, type AppBindings } from "./auth/middleware.js";
import type { ApiContext, ApiRouteContext } from "./context.js";
import { authRoutes } from "./routes/auth.js";
import { createAgentsRoutes } from "./routes/agents.js";
import { createArtifactsRoutes } from "./routes/artifacts.js";
import { createConversationMessageRoutes } from "./routes/conversation-messages.js";
import { createConversationProjectRoutes } from "./routes/conversation-projects.js";
import { createConversationsRoutes } from "./routes/conversations.js";
import { createDaemonRoutes } from "./routes/daemon.js";
import { createDebugRoutes } from "./routes/debug.js";
import { createHealthRoutes } from "./routes/health.js";
import { createRealtimeRoutes } from "./routes/realtime.js";
import { createRunsRoutes } from "./routes/runs.js";
import { createSearchRoutes } from "./routes/search.js";
import { createApiServices, type ApiServices } from "./services/api-services.js";

export type CreatedApiApp = {
  app: OpenAPIHono<AppBindings>;
  services: ApiServices;
};

function urlOrigin(value: string): string {
  return new URL(value).origin;
}

export function createApiApp(context: ApiContext): CreatedApiApp {
  const services = createApiServices(context);
  const routeContext: ApiRouteContext = {
    ...context,
    services,
  };
  const app = new OpenAPIHono<AppBindings>();

  app.use("*", async (c, next) => {
    c.set("env", context.env);
    c.set("db", context.db);
    c.set("logger", context.logger);
    c.set("redis", context.redis);
    return next();
  });

  app.use(
    "*",
    cors({
      origin: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        urlOrigin(context.env.AGENTHUB_PUBLIC_WEB_URL),
      ],
      credentials: true,
    }),
  );

  app.use("*", attachAuthUser);

  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: context.env.AUTH_SESSION_COOKIE,
  });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "AgentHub API",
      version: "0.1.0",
      description: "AgentHub backend API",
    },
    servers: [
      {
        url: "http://localhost:" + context.env.PORT,
        description: "Local development server",
      },
    ],
  });

  app.get(
    "/docs",
    swaggerUI({
      url: "/openapi.json",
    }),
  );

  app.route("/", createHealthRoutes());
  app.route("/", createRealtimeRoutes(routeContext));
  app.route("/", createDaemonRoutes(routeContext));
  app.route("/", createAgentsRoutes(routeContext));
  app.route("/", createSearchRoutes(routeContext));
  app.route("/", createConversationsRoutes(routeContext));
  app.route("/", createConversationProjectRoutes(routeContext));
  app.route("/", createConversationMessageRoutes(routeContext));
  app.route("/", createArtifactsRoutes(routeContext));
  app.route("/", createRunsRoutes(routeContext));
  app.route("/auth", authRoutes);
  app.route("/", createDebugRoutes());

  return { app, services };
}
