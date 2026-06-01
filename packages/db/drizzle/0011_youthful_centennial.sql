CREATE TABLE "conversation_message_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message_artifacts" ADD CONSTRAINT "conversation_message_artifacts_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_artifacts" ADD CONSTRAINT "conversation_message_artifacts_artifact_id_conversation_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."conversation_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_artifacts_message_position_idx" ON "conversation_message_artifacts" USING btree ("message_id","position");--> statement-breakpoint
CREATE INDEX "conversation_message_artifacts_artifact_idx" ON "conversation_message_artifacts" USING btree ("artifact_id");
