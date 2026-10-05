-- Page 10: run member snapshots, level last editor, CFS note templates, IC explanations.
-- AlterTable
ALTER TABLE "consolidation_run" ADD COLUMN     "members" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "note_template" ADD COLUMN     "applies_to" VARCHAR(3) NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "task_level" ADD COLUMN     "last_edited_by_id" UUID;

-- CreateTable
CREATE TABLE "elimination_explanation" (
    "task_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "entry_id" VARCHAR(80) NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "elimination_explanation_pkey" PRIMARY KEY ("task_id","level","entry_id")
);

-- AddForeignKey
ALTER TABLE "elimination_explanation" ADD CONSTRAINT "elimination_explanation_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

