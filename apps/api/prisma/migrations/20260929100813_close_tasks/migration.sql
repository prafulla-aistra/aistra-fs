-- CreateEnum
CREATE TYPE "TaskItemStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'FINALISED');

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "type" "StatementType" NOT NULL,
    "period_id" UUID NOT NULL,
    "format" VARCHAR(60),
    "description" VARCHAR(300) NOT NULL,
    "due_date" DATE NOT NULL,
    "current_step" VARCHAR(40) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_entity" (
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "status" "TaskItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "current_step" VARCHAR(40) NOT NULL,
    "finalised_by_id" UUID,
    "finalised_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_entity_pkey" PRIMARY KEY ("task_id","entity_code")
);

-- CreateTable
CREATE TABLE "task_level" (
    "task_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "parent_entity_code" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "members" TEXT[],
    "status" "TaskItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "current_step" VARCHAR(40) NOT NULL,
    "finalised_by_id" UUID,
    "finalised_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_level_pkey" PRIMARY KEY ("task_id","level")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_number_key" ON "task"("number");

-- CreateIndex
CREATE INDEX "task_period_id_idx" ON "task"("period_id");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_entity" ADD CONSTRAINT "task_entity_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_entity" ADD CONSTRAINT "task_entity_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_entity" ADD CONSTRAINT "task_entity_finalised_by_id_fkey" FOREIGN KEY ("finalised_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_level" ADD CONSTRAINT "task_level_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_level" ADD CONSTRAINT "task_level_finalised_by_id_fkey" FOREIGN KEY ("finalised_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
