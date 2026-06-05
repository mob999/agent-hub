import path from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { loadApiEnv } from "@agent-hub/config";
import { createDb } from "@agent-hub/db";
import {
  createAgentHubRedisClient,
  createLogger,
  subscribeRealtimeEvents,
} from "@agent-hub/server";

import { createApiApp } from "./app.js";
import type { ApiContext } from "./context.js";

const env = loadApiEnv();
const db = createDb(env.DATABASE_URL, {
  maxConnections: env.DATABASE_POOL_MAX,
});
const redis = createAgentHubRedisClient(env.REDIS_URL);
const realtimeSubscriber = createAgentHubRedisClient(env.REDIS_URL);
const logger = createLogger({ bindings: { service: "api" } });
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const context: ApiContext = {
  db,
  env,
  logger,
  realtimeSubscriber,
  redis,
  repositoryRoot,
};

await redis.connect();
await realtimeSubscriber.connect();

export const { app, services } = createApiApp(context);

await subscribeRealtimeEvents(realtimeSubscriber, (event) => {
  services.deliverRealtimeEvent(event);
});

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  () => {
    logger.info(
      { port: env.PORT, url: "http://localhost:" + env.PORT },
      "API server listening",
    );
  },
);
