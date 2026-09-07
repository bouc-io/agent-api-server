-- Rename columns in Assignment
ALTER TABLE "Assignment" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Assignment" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "Assignment" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "Assignment" RENAME COLUMN "isArchived" TO "is_archived";

-- Rename columns in Message
ALTER TABLE "Message" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Message" RENAME COLUMN "assignmentId" TO "assignment_id";

-- Rename columns in Tool
ALTER TABLE "Tool" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Tool" RENAME COLUMN "updatedAt" TO "updated_at";

-- Rename indexes
ALTER INDEX "Assignment_updatedAt_idx" RENAME TO "Assignment_updated_at_idx";
ALTER INDEX "Message_assignmentId_createdAt_idx" RENAME TO "Message_assignment_id_created_at_idx";
