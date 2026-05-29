ALTER TABLE "conversation_artifacts"
  DROP CONSTRAINT IF EXISTS "conversation_artifacts_task_id_conversation_tasks_id_fk";

DROP INDEX IF EXISTS "conversation_artifacts_task_id_idx";
DROP INDEX IF EXISTS "conversation_tasks_workflow_idx";
DROP INDEX IF EXISTS "conversation_tasks_conversation_created_at_idx";
DROP INDEX IF EXISTS "conversation_tasks_assignee_run_id_idx";
DROP INDEX IF EXISTS "conversation_tasks_assignee_agent_id_idx";
DROP INDEX IF EXISTS "conversation_task_workflows_conversation_created_at_idx";
DROP INDEX IF EXISTS "conversation_task_workflows_initial_run_id_idx";

ALTER TABLE "conversation_artifacts"
  DROP COLUMN IF EXISTS "task_id";

DROP TABLE IF EXISTS "conversation_tasks" CASCADE;
DROP TABLE IF EXISTS "conversation_task_workflows" CASCADE;

CREATE TABLE "conversation_goals" (
  "id" uuid PRIMARY KEY NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "orchestrator_agent_id" uuid NOT NULL,
  "initial_run_id" uuid NOT NULL,
  "title" varchar(160) NOT NULL,
  "description" text,
  "status" varchar(32) NOT NULL,
  "summary" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "conversation_goals"
  ADD CONSTRAINT "conversation_goals_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_goals"
  ADD CONSTRAINT "conversation_goals_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_goals"
  ADD CONSTRAINT "conversation_goals_orchestrator_agent_id_agents_id_fk"
  FOREIGN KEY ("orchestrator_agent_id") REFERENCES "public"."agents"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "conversation_goals_conversation_created_at_idx"
  ON "conversation_goals" USING btree ("conversation_id","created_at");

CREATE INDEX "conversation_goals_initial_run_id_idx"
  ON "conversation_goals" USING btree ("initial_run_id");

CREATE TABLE "conversation_goal_tasks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "goal_id" uuid NOT NULL,
  "index" integer NOT NULL,
  "assignee_agent_id" uuid NOT NULL,
  "assignee_run_id" uuid,
  "dispatch_message_id" uuid,
  "depends_on_task_indexes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "title" varchar(160) NOT NULL,
  "description" text,
  "status" varchar(32) NOT NULL,
  "blocked_reason" text,
  "summary" text,
  "result_artifact_ids" jsonb,
  "completed_at" timestamp with time zone,
  "checkpoint_run_id" uuid,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "conversation_goal_tasks"
  ADD CONSTRAINT "conversation_goal_tasks_goal_id_conversation_goals_id_fk"
  FOREIGN KEY ("goal_id") REFERENCES "public"."conversation_goals"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_goal_tasks"
  ADD CONSTRAINT "conversation_goal_tasks_assignee_agent_id_agents_id_fk"
  FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_goal_tasks"
  ADD CONSTRAINT "conversation_goal_tasks_dispatch_message_id_conversation_messages_id_fk"
  FOREIGN KEY ("dispatch_message_id") REFERENCES "public"."conversation_messages"("id")
  ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX "conversation_goal_tasks_goal_index_unique_idx"
  ON "conversation_goal_tasks" USING btree ("goal_id","index");

CREATE INDEX "conversation_goal_tasks_goal_created_at_idx"
  ON "conversation_goal_tasks" USING btree ("goal_id","created_at");

CREATE INDEX "conversation_goal_tasks_assignee_run_id_idx"
  ON "conversation_goal_tasks" USING btree ("assignee_run_id");

CREATE INDEX "conversation_goal_tasks_assignee_agent_id_idx"
  ON "conversation_goal_tasks" USING btree ("assignee_agent_id");

ALTER TABLE "conversation_artifacts"
  ADD COLUMN "goal_id" uuid;

ALTER TABLE "conversation_artifacts"
  ADD COLUMN "goal_task_id" uuid;

ALTER TABLE "conversation_artifacts"
  ADD COLUMN "task_index" integer;

ALTER TABLE "conversation_artifacts"
  ADD CONSTRAINT "conversation_artifacts_goal_id_conversation_goals_id_fk"
  FOREIGN KEY ("goal_id") REFERENCES "public"."conversation_goals"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "conversation_artifacts"
  ADD CONSTRAINT "conversation_artifacts_goal_task_id_conversation_goal_tasks_id_fk"
  FOREIGN KEY ("goal_task_id") REFERENCES "public"."conversation_goal_tasks"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX "conversation_artifacts_goal_id_idx"
  ON "conversation_artifacts" USING btree ("goal_id");

CREATE INDEX "conversation_artifacts_goal_task_id_idx"
  ON "conversation_artifacts" USING btree ("goal_task_id");
