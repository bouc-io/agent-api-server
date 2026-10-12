-- AlterTable
-- Promptset provenance per run: which prompt text actually produced this run.
-- promptset_version is the hand-bumped semver from prompts/promptset.json;
-- promptset_hash is the sha256 over every resolved prompt template, which is what
-- catches a prompt edit that shipped without a version bump.
ALTER TABLE "Run" ADD COLUMN "promptset_version" TEXT;
ALTER TABLE "Run" ADD COLUMN "promptset_hash" TEXT;
