import { z } from "@hono/zod-openapi";

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "UNAUTHORIZED" }),
      message: z.string().openapi({ example: "Authentication required." }),
    }),
  })
  .openapi("ErrorResponse");

export const OkResponseSchema = z
  .object({
    ok: z.boolean().openapi({ example: true }),
  })
  .openapi("OkResponse");

export const HealthResponseSchema = z
  .object({
    ok: z.boolean().openapi({ example: true }),
  })
  .openapi("HealthResponse");

