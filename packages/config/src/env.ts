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
  REDIS_URL: z.string().min(1).optional(),
  AUTH_SESSION_COOKIE: z.string().min(1).default("agent_hub_session"),
  AUTH_SESSION_TTL_DAYS: sessionTtlDaysSchema,
  AUTH_COOKIE_SECURE: cookieSecureSchema,
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(env);
}

