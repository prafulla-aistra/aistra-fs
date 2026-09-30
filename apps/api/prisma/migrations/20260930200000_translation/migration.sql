-- Page 6: stored translation snapshots (prior period for the RE roll-forward and FCTR movement).
-- CreateTable
CREATE TABLE "translation_snapshot" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "target_currency" CHAR(3) NOT NULL,
    "period_id" UUID NOT NULL,
    "retained" DECIMAL(20,4) NOT NULL,
    "profit" DECIMAL(20,4) NOT NULL,
    "fctr" DECIMAL(20,4) NOT NULL,
    "result" JSONB NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "translation_snapshot_entity_code_target_currency_period_id_idx" ON "translation_snapshot"("entity_code", "target_currency", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "translation_snapshot_task_id_entity_code_target_currency_key" ON "translation_snapshot"("task_id", "entity_code", "target_currency");

-- AddForeignKey
ALTER TABLE "translation_snapshot" ADD CONSTRAINT "translation_snapshot_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

