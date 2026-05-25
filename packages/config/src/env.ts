import { z } from "zod";

const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

const portSchema = z.coerce.number().int().min(1).max(65535).default(3000);

const sessionTtlDaysSchema = z.coerce.number().int().positive().default(30);

const cookieSecureSchema = z
  .preprocess((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }

    return value;
  }, z.boolean())
  .default(false);

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: portSchema,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AUTH_SESSION_COOKIE: z.string().min(1).default("agent_hub_session"),
  AUTH_SESSION_TTL_DAYS: sessionTtlDaysSchema,
  AUTH_COOKIE_SECURE: cookieSecureSchema,
  AGENTHUB_DAEMON_TOKEN: z.string().min(1),
  AGENTHUB_DEFAULT_DAEMON_DEVICE_ID: z.string().min(1).optional(),
  AGENTHUB_DEFAULT_AGENT_ID: z.string().min(1).optional(),
  AGENTHUB_DEFAULT_WORKSPACE_PATH: z.string().min(1).optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(env);
}

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  WORKER_PORT: portSchema.default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AGENTHUB_DAEMON_TOKEN: z.string().min(1),
  AGENTHUB_WORKER_CONSUMER_NAME: z.string().min(1).default("worker-local"),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkerEnv {
  return workerEnvSchema.parse(env);
}

export const daemonEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  AGENTHUB_DAEMON_GATEWAY_URL: z.string().url(),
  AGENTHUB_DAEMON_TOKEN: z.string().min(1),
  AGENTHUB_DEVICE_ID: z.string().min(1),
  AGENTHUB_WORKSPACE_ROOT: z.string().min(1),
  CODEX_EXECUTABLE_PATH: z.string().min(1).optional(),
});

export type DaemonEnv = z.infer<typeof daemonEnvSchema>;

export function loadDaemonEnv(
  env: NodeJS.ProcessEnv = process.env,
): DaemonEnv {
  return daemonEnvSchema.parse(env);
}

