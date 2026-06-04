ALTER TABLE "daemon_devices" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "daemon_devices" ADD COLUMN "name" varchar(120);--> statement-breakpoint
ALTER TABLE "daemon_devices" ADD COLUMN "registration_shell" varchar(16);--> statement-breakpoint
ALTER TABLE "daemon_devices" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "daemon_devices" SET "name" = "id" WHERE "name" IS NULL;--> statement-breakpoint
ALTER TABLE "daemon_devices" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "daemon_devices" ADD CONSTRAINT "daemon_devices_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daemon_devices_owner_deleted_idx" ON "daemon_devices" USING btree ("owner_user_id","deleted_at");
