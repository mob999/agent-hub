CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_type" varchar(32) NOT NULL,
	"sender_agent_id" uuid,
	"run_id" uuid,
	"content" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"key" varchar(80),
	"title" varchar(160) NOT NULL,
	"direct_agent_id" uuid,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_created_at_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_run_id_idx" ON "conversation_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "conversations_owner_updated_at_idx" ON "conversations" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_owner_key_unique_idx" ON "conversations" USING btree ("owner_user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_owner_direct_agent_unique_idx" ON "conversations" USING btree ("owner_user_id","direct_agent_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_conversation_id_idx" ON "runs" USING btree ("conversation_id");