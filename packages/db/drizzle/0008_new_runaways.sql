CREATE TABLE "conversation_artifact_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"revision_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"run_id" uuid,
	"error" text,
	"result" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_artifact_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"run_id" uuid,
	"editor_user_id" uuid,
	"storage_key" text NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD COLUMN "status" varchar(32) DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD COLUMN "latest_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_artifact_actions" ADD CONSTRAINT "conversation_artifact_actions_artifact_id_conversation_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."conversation_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifact_actions" ADD CONSTRAINT "conversation_artifact_actions_revision_id_conversation_artifact_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."conversation_artifact_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifact_actions" ADD CONSTRAINT "conversation_artifact_actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifact_actions" ADD CONSTRAINT "conversation_artifact_actions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifact_revisions" ADD CONSTRAINT "conversation_artifact_revisions_artifact_id_conversation_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."conversation_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifact_revisions" ADD CONSTRAINT "conversation_artifact_revisions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifact_revisions" ADD CONSTRAINT "conversation_artifact_revisions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifact_revisions" ADD CONSTRAINT "conversation_artifact_revisions_editor_user_id_users_id_fk" FOREIGN KEY ("editor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_artifact_actions_artifact_created_at_idx" ON "conversation_artifact_actions" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_artifact_actions_conversation_idx" ON "conversation_artifact_actions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_artifact_actions_status_idx" ON "conversation_artifact_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversation_artifact_revisions_artifact_created_at_idx" ON "conversation_artifact_revisions" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_artifact_revisions_conversation_idx" ON "conversation_artifact_revisions" USING btree ("conversation_id");