-- Rename tenant_id → org_id on Run, RunStep, ToolCall
-- Uses RENAME COLUMN to preserve existing NULL values (no data loss)
ALTER TABLE "Run" RENAME COLUMN "tenant_id" TO "org_id";
ALTER TABLE "RunStep" RENAME COLUMN "tenant_id" TO "org_id";
ALTER TABLE "ToolCall" RENAME COLUMN "tenant_id" TO "org_id";

-- Add org_id to Assignment
ALTER TABLE "Assignment" ADD COLUMN "org_id" TEXT;

-- Index for org-scoped queries on Assignment
CREATE INDEX "Assignment_org_id_user_id_idx" ON "Assignment"("org_id", "user_id");

-- Backfill all existing records to the public org
UPDATE "Assignment" SET "org_id" = 'a0000000-0000-4000-8000-000000000002' WHERE "org_id" IS NULL;
UPDATE "Run"        SET "org_id" = 'a0000000-0000-4000-8000-000000000002' WHERE "org_id" IS NULL;
UPDATE "RunStep"    SET "org_id" = 'a0000000-0000-4000-8000-000000000002' WHERE "org_id" IS NULL;
UPDATE "ToolCall"   SET "org_id" = 'a0000000-0000-4000-8000-000000000002' WHERE "org_id" IS NULL;
