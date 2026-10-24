-- CreateTable
CREATE TABLE "RunFeedback" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunFeedback_run_id_key" ON "RunFeedback"("run_id");

-- AddForeignKey
ALTER TABLE "RunFeedback" ADD CONSTRAINT "RunFeedback_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
