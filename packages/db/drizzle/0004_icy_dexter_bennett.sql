CREATE TABLE "conversation_agent_members" (
	"conversation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_agent_members" ADD CONSTRAINT "conversation_agent_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_agent_members" ADD CONSTRAINT "conversation_agent_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_agent_members_unique_idx" ON "conversation_agent_members" USING btree ("conversation_id","agent_id");--> statement-breakpoint
CREATE INDEX "conversation_agent_members_agent_id_idx" ON "conversation_agent_members" USING btree ("agent_id");