CREATE TABLE "agent_runtime_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"daemon_device_id" varchar(120) NOT NULL,
	"runtime_kind" varchar(40) NOT NULL,
	"runtime_version" varchar(120),
	"executable_path" text,
	"capabilities" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"error" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"daemon_device_id" varchar(120) NOT NULL,
	"workspace_path" text,
	"status" varchar(32) NOT NULL,
	"sync_mode" varchar(32) DEFAULT 'local-only' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"avatar" text,
	"default_runtime_kind" varchar(40) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daemon_runtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daemon_device_id" varchar(120) NOT NULL,
	"runtime_kind" varchar(40) NOT NULL,
	"runtime_version" varchar(120),
	"executable_path" text,
	"capabilities" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'ready' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runtime_bindings" ADD CONSTRAINT "agent_runtime_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_bindings" ADD CONSTRAINT "agent_runtime_bindings_daemon_device_id_daemon_devices_id_fk" FOREIGN KEY ("daemon_device_id") REFERENCES "public"."daemon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_daemon_device_id_daemon_devices_id_fk" FOREIGN KEY ("daemon_device_id") REFERENCES "public"."daemon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_runtimes" ADD CONSTRAINT "daemon_runtimes_daemon_device_id_daemon_devices_id_fk" FOREIGN KEY ("daemon_device_id") REFERENCES "public"."daemon_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runtime_bindings_agent_unique_idx" ON "agent_runtime_bindings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_runtime_bindings_daemon_device_id_idx" ON "agent_runtime_bindings" USING btree ("daemon_device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_workspaces_agent_daemon_unique_idx" ON "agent_workspaces" USING btree ("agent_id","daemon_device_id");--> statement-breakpoint
CREATE INDEX "agent_workspaces_daemon_device_id_idx" ON "agent_workspaces" USING btree ("daemon_device_id");--> statement-breakpoint
CREATE INDEX "agents_owner_user_id_idx" ON "agents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daemon_runtimes_device_runtime_unique_idx" ON "daemon_runtimes" USING btree ("daemon_device_id","runtime_kind");--> statement-breakpoint
CREATE INDEX "daemon_runtimes_device_id_idx" ON "daemon_runtimes" USING btree ("daemon_device_id");