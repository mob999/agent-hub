CREATE TABLE "admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "role" varchar(32) DEFAULT 'admin' NOT NULL,
  "source" varchar(32) DEFAULT 'env' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_unique_idx" ON "admin_users" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "admin_users_revoked_at_idx" ON "admin_users" USING btree ("revoked_at");
