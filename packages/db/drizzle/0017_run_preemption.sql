ALTER TABLE "runs"
  ADD COLUMN "runtime_session_id" text;

ALTER TABLE "runs"
  ADD COLUMN "parent_run_id" uuid;

ALTER TABLE "runs"
  ADD COLUMN "preempted_by_run_id" uuid;

ALTER TABLE "runs"
  ADD COLUMN "dispatch_mode" varchar(16) DEFAULT 'new' NOT NULL;

CREATE INDEX "runs_active_scope_idx"
  ON "runs" USING btree ("owner_user_id","conversation_id","agent_id","status");

CREATE INDEX "runs_runtime_session_id_idx"
  ON "runs" USING btree ("runtime_session_id");
