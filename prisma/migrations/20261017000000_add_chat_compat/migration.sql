-- AlterTable
-- Chat-surface fields, inherited from chatbot-api-server's Chat model as the /v1/chats
-- surface folds into this service. `surface` partitions simple chat conversations from
-- agent assignments in this shared table: the chat API writes and filters 'chat', every
-- existing row and every agent run keeps the 'agent' default.
-- summary/last_distilled_at/distilled_message_count carry the chatbot's distillation
-- throttle, which fires only after N new messages AND a minimum interval.
ALTER TABLE "Assignment" ADD COLUMN "surface" TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE "Assignment" ADD COLUMN "summary" VARCHAR(255);
ALTER TABLE "Assignment" ADD COLUMN "last_distilled_at" TIMESTAMP(3);
ALTER TABLE "Assignment" ADD COLUMN "distilled_message_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
-- Backs GET /v1/chats, which lists one user's chat conversations newest first.
CREATE INDEX "Assignment_user_id_surface_updated_at_idx" ON "Assignment"("user_id", "surface", "updated_at" DESC);

-- AlterTable
-- Per-message token denormalization. Run still holds the authoritative per-turn totals;
-- these back the per-message token footer in the chat UI and GET /v1/chats/:id/usage,
-- which aggregates assistant messages rather than runs.
ALTER TABLE "Message" ADD COLUMN "prompt_tokens" INTEGER DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "completion_tokens" INTEGER DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "total_tokens" INTEGER DEFAULT 0;

-- CreateTable
-- Per-message feedback, kept deliberately: RunFeedback is per run, which is the right
-- grain for agentic work but not for a chat turn the user thumbs up or down.
CREATE TABLE "MessageFeedback" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageFeedback_message_id_key" ON "MessageFeedback"("message_id");

-- AddForeignKey
ALTER TABLE "MessageFeedback" ADD CONSTRAINT "MessageFeedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
