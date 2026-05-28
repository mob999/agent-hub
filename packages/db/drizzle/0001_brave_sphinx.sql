CREATE TABLE "daemon_devices" (
	"id" varchar(120) PRIMARY KEY NOT NULL,
	"status" varchar(32) DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"agent_id" varchar(120) NOT NULL,
	"daemon_device_id" varchar(120) NOT NULL,
	"status" varchar(32) NOT NULL,
	"prompt" text NOT NULL,
	"workspace_path" text NOT NULL,
	"runtime" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_events_run_id_idx" ON "run_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_owner_user_id_idx" ON "runs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "runs_daemon_device_id_idx" ON "runs" USING btree ("daemon_device_id");