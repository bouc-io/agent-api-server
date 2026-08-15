/*
  Warnings:

  - You are about to drop the column `parameters` on the `Tool` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "provenance" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "Tool" DROP COLUMN "parameters",
ADD COLUMN     "policy" JSONB DEFAULT '{}',
ADD COLUMN     "schema" JSONB;

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "user_id" TEXT,
    "tenant_id" TEXT,
    "agent_id" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "trigger_message_id" TEXT,
    "plan" JSONB,
    "snapshot" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "step_index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "tool_input" JSONB NOT NULL,
    "tool_output" JSONB,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Run_assignment_id_created_at_idx" ON "Run"("assignment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "RunStep_run_id_step_index_idx" ON "RunStep"("run_id", "step_index");

-- CreateIndex
CREATE INDEX "ToolCall_run_id_created_at_idx" ON "ToolCall"("run_id", "created_at");

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_trigger_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunStep" ADD CONSTRAINT "RunStep_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
