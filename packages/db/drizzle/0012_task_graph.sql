CREATE TABLE "conversation_task_workflows" (
  "id" uuid PRIMARY KEY NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "orchestrator_agent_id" uuid NOT NULL,
  "initial_run_id" uuid NOT NULL,
  "status" varchar(32) NOT NULL,
  "summary" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "conversation_task_workflows"
  ADD CONSTRAINT "conversation_task_workflows_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_task_workflows"
  ADD CONSTRAINT "conversation_task_workflows_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_task_workflows"
  ADD CONSTRAINT "conversation_task_workflows_orchestrator_agent_id_agents_id_fk"
  FOREIGN KEY ("orchestrator_agent_id") REFERENCES "public"."agents"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "conversation_task_workflows_conversation_created_at_idx"
  ON "conversation_task_workflows" USING btree ("conversation_id","created_at");

CREATE INDEX "conversation_task_workflows_initial_run_id_idx"
  ON "conversation_task_workflows" USING btree ("initial_run_id");

ALTER TABLE "conversation_tasks"
  ADD COLUMN "workflow_id" uuid;

ALTER TABLE "conversation_tasks"
  ADD COLUMN "depends_on_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "conversation_tasks"
  ADD COLUMN "blocked_reason" text;

ALTER TABLE "conversation_tasks"
  ADD COLUMN "checkpoint_run_id" uuid;

INSERT INTO "conversation_task_workflows" (
  "id",
  "owner_user_id",
  "conversation_id",
  "orchestrator_agent_id",
  "initial_run_id",
  "status",
  "created_at",
  "updated_at"
)
SELECT DISTINCT
  "creator_run_id",
  "owner_user_id",
  "conversation_id",
  "orchestrator_agent_id",
  "creator_run_id",
  'active',
  min("created_at"),
  max("updated_at")
FROM "conversation_tasks"
GROUP BY
  "creator_run_id",
  "owner_user_id",
  "conversation_id",
  "orchestrator_agent_id";

UPDATE "conversation_tasks"
SET "workflow_id" = "creator_run_id"
WHERE "workflow_id" IS NULL;

ALTER TABLE "conversation_tasks"
  ALTER COLUMN "workflow_id" SET NOT NULL;

ALTER TABLE "conversation_tasks"
  ADD CONSTRAINT "conversation_tasks_workflow_id_conversation_task_workflows_id_fk"
  FOREIGN KEY ("workflow_id") REFERENCES "public"."conversation_task_workflows"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "conversation_tasks_workflow_idx"
  ON "conversation_tasks" USING btree ("workflow_id");
