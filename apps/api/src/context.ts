import type { ApiEnv } from "@agent-hub/config";
import type { Db } from "@agent-hub/db";
import type { createAgentHubRedisClient, createLogger } from "@agent-hub/server";

import type { ApiServices } from "./services/api-services.js";

export type AgentHubRedisClient = ReturnType<typeof createAgentHubRedisClient>;
export type ApiLogger = ReturnType<typeof createLogger>;

export type ApiContext = {
  db: Db;
  env: ApiEnv;
  logger: ApiLogger;
  realtimeSubscriber: AgentHubRedisClient;
  redis: AgentHubRedisClient;
  repositoryRoot: string;
};

export type ApiRouteContext = ApiContext & {
  services: ApiServices;
};
