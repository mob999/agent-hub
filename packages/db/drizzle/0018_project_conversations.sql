ALTER TABLE "runs"
  ADD COLUMN "memory_workspace_path" text;

CREATE TABLE "conversation_projects" (
  "conversation_id" uuid PRIMARY KEY NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "remote_url" text NOT NULL,
  "daemon_device_id" varchar(120) NOT NULL,
  "base_repo_path" text,
  "default_branch" varchar(160),
  "base_head" varchar(80),
  "clone_status" varchar(32) NOT NULL,
  "clone_error" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE INDEX "conversation_projects_owner_idx"
  ON "conversation_projects" USING btree ("owner_user_id");

CREATE INDEX "conversation_projects_daemon_idx"
  ON "conversation_projects" USING btree ("daemon_device_id");

CREATE INDEX "conversation_projects_clone_status_idx"
  ON "conversation_projects" USING btree ("clone_status");

CREATE TABLE "conversation_project_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "goal_id" uuid,
  "task_index" integer,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "run_id" uuid NOT NULL,
  "branch_name" text NOT NULL,
  "worktree_path" text NOT NULL,
  "base_commit" varchar(80),
  "head_commit" varchar(80),
  "status" varchar(32) NOT NULL,
  "summary" text,
  "diff_stat" text,
  "diff" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "merged_at" timestamp with time zone
);

CREATE INDEX "conversation_project_changes_conversation_idx"
  ON "conversation_project_changes" USING btree ("conversation_id","created_at");

CREATE INDEX "conversation_project_changes_run_idx"
  ON "conversation_project_changes" USING btree ("run_id");

CREATE INDEX "conversation_project_changes_status_idx"
  ON "conversation_project_changes" USING btree ("status");
