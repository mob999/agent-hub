ALTER TABLE "agents" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
