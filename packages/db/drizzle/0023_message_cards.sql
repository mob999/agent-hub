ALTER TABLE "conversation_messages" ADD COLUMN "cards" jsonb;
ALTER TABLE "conversation_goals" ADD COLUMN "card_message_id" uuid;
ALTER TABLE "conversation_goals" ADD CONSTRAINT "conversation_goals_card_message_id_conversation_messages_id_fk" FOREIGN KEY ("card_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;
