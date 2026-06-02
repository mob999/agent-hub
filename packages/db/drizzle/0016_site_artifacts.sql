ALTER TABLE "conversation_artifacts"
  ADD COLUMN "kind" varchar(32) DEFAULT 'file' NOT NULL;

ALTER TABLE "conversation_artifacts"
  ADD COLUMN "entrypoint" text;

ALTER TABLE "conversation_artifacts"
  ADD COLUMN "file_count" integer;

CREATE TABLE "conversation_artifact_files" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "artifact_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "path" text NOT NULL,
  "mime_type" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" text NOT NULL,
  "latest_revision_id" uuid,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

ALTER TABLE "conversation_artifact_files"
  ADD CONSTRAINT "conversation_artifact_files_artifact_id_conversation_artifacts_id_fk"
  FOREIGN KEY ("artifact_id") REFERENCES "public"."conversation_artifacts"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_artifact_files"
  ADD CONSTRAINT "conversation_artifact_files_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_artifact_files"
  ADD CONSTRAINT "conversation_artifact_files_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "conversation_artifact_files_artifact_path_unique_idx"
  ON "conversation_artifact_files" USING btree ("artifact_id","path");

CREATE INDEX "conversation_artifact_files_conversation_idx"
  ON "conversation_artifact_files" USING btree ("conversation_id");

CREATE TABLE "conversation_artifact_file_revisions" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "artifact_file_id" uuid NOT NULL,
  "artifact_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "path" text NOT NULL,
  "editor_user_id" uuid,
  "storage_key" text NOT NULL,
  "content_hash" varchar(128) NOT NULL,
  "summary" text,
  "created_at" timestamp with time zone NOT NULL
);

ALTER TABLE "conversation_artifact_file_revisions"
  ADD CONSTRAINT "conversation_artifact_file_revisions_artifact_file_id_conversation_artifact_files_id_fk"
  FOREIGN KEY ("artifact_file_id") REFERENCES "public"."conversation_artifact_files"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_artifact_file_revisions"
  ADD CONSTRAINT "conversation_artifact_file_revisions_artifact_id_conversation_artifacts_id_fk"
  FOREIGN KEY ("artifact_id") REFERENCES "public"."conversation_artifacts"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_artifact_file_revisions"
  ADD CONSTRAINT "conversation_artifact_file_revisions_owner_user_id_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_artifact_file_revisions"
  ADD CONSTRAINT "conversation_artifact_file_revisions_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "conversation_artifact_file_revisions"
  ADD CONSTRAINT "conversation_artifact_file_revisions_editor_user_id_users_id_fk"
  FOREIGN KEY ("editor_user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX "conversation_artifact_file_revisions_file_created_at_idx"
  ON "conversation_artifact_file_revisions" USING btree ("artifact_file_id","created_at");

CREATE INDEX "conversation_artifact_file_revisions_artifact_idx"
  ON "conversation_artifact_file_revisions" USING btree ("artifact_id");

ALTER TABLE "conversation_deployments"
  ADD COLUMN "source_artifact_id" uuid;

ALTER TABLE "conversation_deployments"
  ADD COLUMN "source_revision_id" uuid;

ALTER TABLE "conversation_deployments"
  ADD COLUMN "published_by_user_id" uuid;

ALTER TABLE "conversation_deployments"
  ADD COLUMN "published_from" varchar(32) DEFAULT 'agent' NOT NULL;

ALTER TABLE "conversation_deployments"
  ADD CONSTRAINT "conversation_deployments_source_artifact_id_conversation_artifacts_id_fk"
  FOREIGN KEY ("source_artifact_id") REFERENCES "public"."conversation_artifacts"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "conversation_deployments"
  ADD CONSTRAINT "conversation_deployments_published_by_user_id_users_id_fk"
  FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX "conversation_deployments_source_artifact_id_idx"
  ON "conversation_deployments" USING btree ("source_artifact_id");
