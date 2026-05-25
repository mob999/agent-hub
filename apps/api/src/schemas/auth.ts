import { z } from "@hono/zod-openapi";

export const UserSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "0f3ac4e0-ffea-4f92-93fd-4ff31cc24719" }),
    email: z.string().email().openapi({ example: "test@example.com" }),
    name: z.string().nullable().openapi({ example: "Manual Test" }),
  })
  .openapi("User");

export const RegisterRequestSchema = z
  .object({
    email: z.string().email().max(320).openapi({ example: "test@example.com" }),
    password: z.string().min(8).max(128).openapi({ example: "12345678" }),
    name: z.string().min(1).max(120).optional().openapi({ example: "Manual Test" }),
  })
  .openapi("RegisterRequest");

export const LoginRequestSchema = z
  .object({
    email: z.string().email().max(320).openapi({ example: "test@example.com" }),
    password: z.string().min(1).max(128).openapi({ example: "12345678" }),
  })
  .openapi("LoginRequest");

export const AuthUserResponseSchema = z
  .object({
    user: UserSchema,
  })
  .openapi("AuthUserResponse");

