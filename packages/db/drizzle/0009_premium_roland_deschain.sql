ALTER TABLE "conversation_artifacts" ADD COLUMN "source_path" text;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "conversation_artifacts" DROP COLUMN "mime_type";--> statement-breakpoint
ALTER TABLE "conversation_artifacts" DROP COLUMN "metadata";