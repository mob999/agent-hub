CREATE TABLE "conversation_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"task_id" uuid,
	"run_id" uuid NOT NULL,
	"creator_agent_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(160) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(160),
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD COLUMN "result_artifact_ids" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD COLUMN "finalizer_run_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_task_id_conversation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."conversation_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_creator_agent_id_agents_id_fk" FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_artifacts_conversation_created_at_idx" ON "conversation_artifacts" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_task_id_idx" ON "conversation_artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_run_id_idx" ON "conversation_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_creator_agent_id_idx" ON "conversation_artifacts" USING btree ("creator_agent_id");