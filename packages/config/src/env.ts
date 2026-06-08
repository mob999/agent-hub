import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

export const defaultAgentHubWorkspaceRoot = path.join(homedir(), ".agent-hub");
export const defaultAgentHubStorageRoot = path.join(
  defaultAgentHubWorkspaceRoot,
  "storage",
);

const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

const portSchema = z.coerce.number().int().min(1).max(65535).default(3000);

const databasePoolMaxSchema = z.coerce.number().int().min(1).max(20).default(3);

const sessionTtlDaysSchema = z.coerce.number().int().positive().default(30);

const storageDriverSchema = z.enum(["local", "s3"]).default("local");

const optionalNonEmptyStringSchema = z
  .string()
  .trim()
  .min(1)
  .optional();

type S3Env = {
  AGENTHUB_S3_ACCESS_KEY_ID?: string;
  AGENTHUB_S3_BUCKET?: string;
  AGENTHUB_S3_ENDPOINT?: string;
  AGENTHUB_S3_REGION?: string;
  AGENTHUB_S3_SECRET_ACCESS_KEY?: string;
  AGENTHUB_STORAGE_DRIVER: "local" | "s3";
};

function requireS3ConfigWhenEnabled(value: S3Env, ctx: z.RefinementCtx): void {
  if (value.AGENTHUB_STORAGE_DRIVER !== "s3") {
    return;
  }

  for (const key of [
    "AGENTHUB_S3_ENDPOINT",
    "AGENTHUB_S3_REGION",
    "AGENTHUB_S3_ACCESS_KEY_ID",
    "AGENTHUB_S3_SECRET_ACCESS_KEY",
    "AGENTHUB_S3_BUCKET",
  ] as const) {
    if (value[key] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${key} is required when AGENTHUB_STORAGE_DRIVER=s3.`,
        path: [key],
      });
    }
  }
}

function normalizeWorkspaceRoot(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return defaultAgentHubWorkspaceRoot;
  }

  const trimmed = value.trim();
  const looksLikeWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(trimmed);

  if (process.platform !== "win32" && looksLikeWindowsAbsolutePath) {
    return defaultAgentHubWorkspaceRoot;
  }

  return trimmed;
}

function normalizeStorageRoot(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return defaultAgentHubStorageRoot;
  }

  const trimmed = value.trim();
  const looksLikeWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(trimmed);

  if (process.platform !== "win32" && looksLikeWindowsAbsolutePath) {
    return defaultAgentHubStorageRoot;
  }

  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(homedir(), trimmed);
}

const workspaceRootSchema = z.preprocess(
  normalizeWorkspaceRoot,
  z.string().min(1),
);

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
  DATABASE_POOL_MAX: databasePoolMaxSchema,
  REDIS_URL: z.string().min(1),
  AUTH_SESSION_COOKIE: z.string().min(1).default("agent_hub_session"),
  AUTH_SESSION_TTL_DAYS: sessionTtlDaysSchema,
  AUTH_COOKIE_SECURE: cookieSecureSchema,
  AGENTHUB_DAEMON_TOKEN: z.string().min(1),
  AGENTHUB_DAEMON_TOKEN_SECRET: z.string().min(1).optional(),
  AGENTHUB_DAEMON_GATEWAY_URL: z.string().url().default("http://localhost:3001"),
  AGENTHUB_DEFAULT_DAEMON_DEVICE_ID: z.string().min(1).optional(),
  AGENTHUB_DEFAULT_AGENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_OAUTH_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:3000/auth/github/callback"),
  AGENTHUB_DEFAULT_WORKSPACE_PATH: workspaceRootSchema,
  AGENTHUB_STORAGE_DRIVER: storageDriverSchema,
  AGENTHUB_STORAGE_ROOT: z.preprocess(normalizeStorageRoot, z.string().min(1)),
  AGENTHUB_S3_ENDPOINT: z.string().url().optional(),
  AGENTHUB_S3_REGION: optionalNonEmptyStringSchema,
  AGENTHUB_S3_ACCESS_KEY_ID: optionalNonEmptyStringSchema,
  AGENTHUB_S3_SECRET_ACCESS_KEY: optionalNonEmptyStringSchema,
  AGENTHUB_S3_BUCKET: optionalNonEmptyStringSchema,
  AGENTHUB_S3_PUBLIC_BASE_URL: z.string().url().optional(),
  AGENTHUB_PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  AGENTHUB_PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
  AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
}).superRefine(requireS3ConfigWhenEnabled);

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(env);
}

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  WORKER_PORT: portSchema.default(3001),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: databasePoolMaxSchema,
  REDIS_URL: z.string().min(1),
  AGENTHUB_DAEMON_TOKEN: z.string().min(1),
  AGENTHUB_DAEMON_TOKEN_SECRET: z.string().min(1).optional(),
  AGENTHUB_WORKER_CONSUMER_NAME: z.string().min(1).default("worker-local"),
  AGENTHUB_STORAGE_DRIVER: storageDriverSchema,
  AGENTHUB_STORAGE_ROOT: z.preprocess(normalizeStorageRoot, z.string().min(1)),
  AGENTHUB_S3_ENDPOINT: z.string().url().optional(),
  AGENTHUB_S3_REGION: optionalNonEmptyStringSchema,
  AGENTHUB_S3_ACCESS_KEY_ID: optionalNonEmptyStringSchema,
  AGENTHUB_S3_SECRET_ACCESS_KEY: optionalNonEmptyStringSchema,
  AGENTHUB_S3_BUCKET: optionalNonEmptyStringSchema,
  AGENTHUB_S3_PUBLIC_BASE_URL: z.string().url().optional(),
  AGENTHUB_PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  AGENTHUB_PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
}).superRefine(requireS3ConfigWhenEnabled);

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
  AGENTHUB_WORKSPACE_ROOT: workspaceRootSchema,
  AGENTHUB_DAILY_MEMORY_REFRESH_INTERVAL_MINUTES: z.coerce
    .number()
    .nonnegative()
    .default(240),
  AGENTHUB_DAILY_MEMORY_REFRESH_TRANSCRIPT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  CODEX_EXECUTABLE_PATH: z.string().min(1).optional(),
  CLAUDE_CODE_EXECUTABLE_PATH: z.string().min(1).optional(),
});

export type DaemonEnv = z.infer<typeof daemonEnvSchema>;

export function loadDaemonEnv(
  env: NodeJS.ProcessEnv = process.env,
): DaemonEnv {
  return daemonEnvSchema.parse(env);
}
