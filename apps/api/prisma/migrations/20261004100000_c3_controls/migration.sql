-- Config C3: control-check register, approval rules, edit-access requests.
-- CreateEnum
CREATE TYPE "CheckSeverity" AS ENUM ('BLOCKING', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "EditAccessStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "control_check" (
    "code" VARCHAR(40) NOT NULL,
    "statement_type" "StatementType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "severity" "CheckSeverity" NOT NULL,
    "threshold" DECIMAL(20,4),
    "threshold_unit" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "to_be_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "control_check_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "approval_rule" (
    "id" UUID NOT NULL,
    "statement_type" "StatementType" NOT NULL,
    "entity_code" VARCHAR(10),
    "review_levels" INTEGER NOT NULL DEFAULT 1,
    "reviewer_ids" TEXT[],
    "approver_ids" TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edit_access_request" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "EditAccessStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_comment" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edit_access_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_rule_statement_type_entity_code_idx" ON "approval_rule"("statement_type", "entity_code");

-- CreateIndex
CREATE INDEX "edit_access_request_status_created_at_idx" ON "edit_access_request"("status", "created_at");

-- AddForeignKey
ALTER TABLE "edit_access_request" ADD CONSTRAINT "edit_access_request_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edit_access_request" ADD CONSTRAINT "edit_access_request_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edit_access_request" ADD CONSTRAINT "edit_access_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

