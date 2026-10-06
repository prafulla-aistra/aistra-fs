-- Decisions round 1: holiday calendars, P&L basis, approvals by period type, NCI measurement, statutory details, signing details.
-- DropIndex
DROP INDEX "holiday_date_key";

-- AlterTable
ALTER TABLE "acquisition" ADD COLUMN     "nci_fair_value" DECIMAL(20,4),
ADD COLUMN     "nci_measurement" VARCHAR(20);

-- AlterTable
ALTER TABLE "approval_rule" ADD COLUMN     "period_type" "PeriodType";

-- AlterTable
ALTER TABLE "entity" ADD COLUMN     "holiday_calendar" VARCHAR(60);

-- AlterTable
ALTER TABLE "holiday" ADD COLUMN     "calendar" VARCHAR(60) NOT NULL DEFAULT 'GROUP';

-- AlterTable
ALTER TABLE "task_entity" ADD COLUMN     "period_tie_explanation" VARCHAR(1000);

-- AlterTable
ALTER TABLE "tb_line" ADD COLUMN     "ytd_amount" DECIMAL(20,4);

-- AlterTable
ALTER TABLE "upload_profile" ADD COLUMN     "pl_basis" VARCHAR(10) NOT NULL DEFAULT 'PERIOD';

-- CreateTable
CREATE TABLE "statutory_details" (
    "entity_code" VARCHAR(10) NOT NULL,
    "registered_office" VARCHAR(500),
    "registration_no" VARCHAR(60),
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "statutory_details_pkey" PRIMARY KEY ("entity_code")
);

-- CreateTable
CREATE TABLE "statutory_officer" (
    "id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "designation" VARCHAR(100) NOT NULL,
    "identifier" VARCHAR(60),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "statutory_officer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_details" (
    "task_id" UUID NOT NULL,
    "key" VARCHAR(10) NOT NULL,
    "board_approval_date" DATE NOT NULL,
    "place" VARCHAR(120) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "signing_details_pkey" PRIMARY KEY ("task_id","key")
);

-- CreateIndex
CREATE INDEX "statutory_officer_entity_code_idx" ON "statutory_officer"("entity_code");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_date_calendar_key" ON "holiday"("date", "calendar");

-- AddForeignKey
ALTER TABLE "statutory_officer" ADD CONSTRAINT "statutory_officer_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "statutory_details"("entity_code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_details" ADD CONSTRAINT "signing_details_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

