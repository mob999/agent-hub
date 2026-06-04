import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import type { Handler } from "hono";

import type { AppBindings } from "../auth/middleware.js";
import { ErrorResponseSchema } from "../schemas/common.js";

type ApiMethod = "get" | "post" | "put" | "patch" | "delete";

const GenericJsonSchema = z.any().openapi("GenericJsonResponse");

function honoPathToOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function tagForPath(path: string): string {
  const firstSegment = path.split("/").filter(Boolean)[0];

  switch (firstSegment) {
    case "daemon":
      return "Daemon";
    case "agents":
      return "Agents";
    case "search":
      return "Search";
    case "conversations":
      return "Conversations";
    case "artifacts":
      return "Artifacts";
    case "deployments":
      return "Deployments";
    case "runs":
      return "Runs";
    case "events":
      return "Realtime";
    default:
      return "API";
  }
}

function summaryFor(method: ApiMethod, path: string): string {
  return method.toUpperCase() + " " + honoPathToOpenApiPath(path);
}

function defaultResponses(path: string): RouteConfig["responses"] {
  if (path === "/events") {
    return {
      200: {
        description: "Realtime event stream",
        content: {
          "text/event-stream": {
            schema: z.string(),
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
    };
  }

  return {
    default: {
      description: "Response",
      content: {
        "application/json": {
          schema: GenericJsonSchema,
        },
      },
    },
  };
}

export function openApiRoute<P extends string>(
  app: OpenAPIHono<AppBindings>,
  method: ApiMethod,
  path: P,
  handler: Handler<AppBindings, P>,
  options: {
    description?: string;
    hide?: boolean;
    request?: RouteConfig["request"];
    responses?: RouteConfig["responses"];
    security?: RouteConfig["security"];
    summary?: string;
    tags?: string[];
  } = {},
): void {
  const route = createRoute({
    method,
    path: honoPathToOpenApiPath(path),
    tags: options.tags ?? [tagForPath(path)],
    summary: options.summary ?? summaryFor(method, path),
    description: options.description,
    security: options.security ?? [{ cookieAuth: [] }],
    request: options.request,
    responses: options.responses ?? defaultResponses(path),
    hide: options.hide,
  });

  app.openapi(route as never, handler as never);
}
