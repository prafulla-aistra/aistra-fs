-- Page 7: statements and notes (statement snapshots and editable note text).
-- CreateTable
CREATE TABLE "statement_snapshot" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "figures" JSONB NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_text" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "text" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "statement_text_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "statement_snapshot_task_id_entity_code_key" ON "statement_snapshot"("task_id", "entity_code");

-- CreateIndex
CREATE UNIQUE INDEX "statement_text_task_id_entity_code_kind_key" ON "statement_text"("task_id", "entity_code", "kind");

-- AddForeignKey
ALTER TABLE "statement_snapshot" ADD CONSTRAINT "statement_snapshot_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_text" ADD CONSTRAINT "statement_text_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_text" ADD CONSTRAINT "statement_text_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

