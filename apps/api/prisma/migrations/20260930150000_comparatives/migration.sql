-- Page 5: comparatives (basis per task, comparative TB uploads, variance explanations, materiality, settings).
-- CreateEnum
CREATE TYPE "TbPurpose" AS ENUM ('CURRENT', 'COMPARATIVE');

-- CreateEnum
CREATE TYPE "ComparativeBasis" AS ENUM ('PREVIOUS_PERIOD', 'SAME_PERIOD_LAST_YEAR');

-- DropIndex
DROP INDEX "tb_version_task_id_entity_code_version_key";

-- AlterTable
ALTER TABLE "entity" ADD COLUMN     "materiality" DECIMAL(20,4);

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "comparative_basis" "ComparativeBasis" NOT NULL DEFAULT 'PREVIOUS_PERIOD';

-- AlterTable
ALTER TABLE "task_entity" ADD COLUMN     "roll_forward" JSONB;

-- AlterTable
ALTER TABLE "tb_version" ADD COLUMN     "period_id" UUID,
ADD COLUMN     "purpose" "TbPurpose" NOT NULL DEFAULT 'CURRENT';

-- CreateTable
CREATE TABLE "variance_explanation" (
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "account_code" VARCHAR(40) NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variance_explanation_pkey" PRIMARY KEY ("task_id","entity_code","account_code")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" VARCHAR(60) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_version_task_id_entity_code_purpose_version_key" ON "tb_version"("task_id", "entity_code", "purpose", "version");

-- AddForeignKey
ALTER TABLE "variance_explanation" ADD CONSTRAINT "variance_explanation_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variance_explanation" ADD CONSTRAINT "variance_explanation_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO "app_setting" ("key", "value", "updated_at") VALUES ('VARIANCE_PCT_THRESHOLD', '0.20', now()) ON CONFLICT DO NOTHING;
