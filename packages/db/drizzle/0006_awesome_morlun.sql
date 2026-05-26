CREATE TABLE "conversation_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"creator_run_id" uuid NOT NULL,
	"orchestrator_agent_id" uuid NOT NULL,
	"assignee_agent_id" uuid NOT NULL,
	"assignee_run_id" uuid,
	"dispatch_message_id" uuid,
	"title" varchar(160) NOT NULL,
	"description" text,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "orchestrator_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_orchestrator_agent_id_agents_id_fk" FOREIGN KEY ("orchestrator_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_dispatch_message_id_conversation_messages_id_fk" FOREIGN KEY ("dispatch_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_tasks_conversation_created_at_idx" ON "conversation_tasks" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_tasks_creator_run_id_idx" ON "conversation_tasks" USING btree ("creator_run_id");--> statement-breakpoint
CREATE INDEX "conversation_tasks_assignee_run_id_idx" ON "conversation_tasks" USING btree ("assignee_run_id");--> statement-breakpoint
CREATE INDEX "conversation_tasks_assignee_agent_id_idx" ON "conversation_tasks" USING btree ("assignee_agent_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_orchestrator_agent_id_agents_id_fk" FOREIGN KEY ("orchestrator_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_orchestrator_agent_id_idx" ON "conversations" USING btree ("orchestrator_agent_id");