ALTER TABLE "conversation_artifacts"
  ADD COLUMN "creator_type" varchar(32) DEFAULT 'agent' NOT NULL;

ALTER TABLE "conversation_artifacts"
  ADD COLUMN "creator_user_id" uuid;

ALTER TABLE "conversation_artifacts"
  ALTER COLUMN "run_id" DROP NOT NULL;

ALTER TABLE "conversation_artifacts"
  ALTER COLUMN "creator_agent_id" DROP NOT NULL;

ALTER TABLE "conversation_artifacts"
  ADD CONSTRAINT "conversation_artifacts_creator_user_id_users_id_fk"
  FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "conversation_artifacts_creator_user_id_idx"
  ON "conversation_artifacts" USING btree ("creator_user_id");
