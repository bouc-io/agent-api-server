-- CreateTable
CREATE TABLE "Scratchpad" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scratchpad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scratchpad_assignment_id_idx" ON "Scratchpad"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "Scratchpad_assignment_id_key_key" ON "Scratchpad"("assignment_id", "key");

