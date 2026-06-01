CREATE TABLE "conversation_deployments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "goal_id" uuid,
  "task_index" integer,
  "run_id" uuid NOT NULL,
  "creator_agent_id" uuid NOT NULL,
  "title" varchar(160) NOT NULL,
  "entrypoint" text NOT NULL,
  "status" varchar(32) DEFAULT 'ready' NOT NULL,
  "storage_prefix" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "conversation_deployments"
  ADD CONSTRAINT "conversation_deployments_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_deployments"
  ADD CONSTRAINT "conversation_deployments_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_deployments"
  ADD CONSTRAINT "conversation_deployments_goal_id_conversation_goals_id_fk"
  FOREIGN KEY ("goal_id") REFERENCES "public"."conversation_goals"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "conversation_deployments"
  ADD CONSTRAINT "conversation_deployments_creator_agent_id_agents_id_fk"
  FOREIGN KEY ("creator_agent_id") REFERENCES "public"."agents"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "conversation_deployments_conversation_created_at_idx"
  ON "conversation_deployments" USING btree ("conversation_id","created_at");

CREATE INDEX "conversation_deployments_goal_id_idx"
  ON "conversation_deployments" USING btree ("goal_id");

CREATE INDEX "conversation_deployments_run_id_idx"
  ON "conversation_deployments" USING btree ("run_id");

CREATE INDEX "conversation_deployments_creator_agent_id_idx"
  ON "conversation_deployments" USING btree ("creator_agent_id");
