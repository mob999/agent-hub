import { z } from "@hono/zod-openapi";

export const UserSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "0f3ac4e0-ffea-4f92-93fd-4ff31cc24719" }),
    email: z.string().email().openapi({ example: "test@example.com" }),
    name: z.string().nullable().openapi({ example: "Manual Test" }),
    avatar: z.string().nullable().openapi({ example: "/avatars/avatar-01.png" }),
  })
  .openapi("User");

export const AuthUserResponseSchema = z
  .object({
    user: UserSchema,
  })
  .openapi("AuthUserResponse");
