ALTER TABLE "users" ADD COLUMN "avatar" text;

UPDATE "users"
SET "avatar" = '/avatars/avatar-' || lpad((1 + floor(random() * 20))::int::text, 2, '0') || '.png'
WHERE "avatar" IS NULL;
