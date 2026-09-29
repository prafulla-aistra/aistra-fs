-- Page 3: FSLI master, charts of accounts, exchange rates, uploads and TB versions.

-- CreateEnum
CREATE TYPE "FsliStatement" AS ENUM ('BS', 'PL');

-- CreateEnum
CREATE TYPE "FsliClass" AS ENUM ('A', 'L', 'E', 'I', 'X');

-- CreateEnum
CREATE TYPE "RateBasis" AS ENUM ('CLOSING', 'AVERAGE', 'HISTORICAL', 'OPENING', 'ROLL_FORWARD', 'COMPUTED');

-- CreateEnum
CREATE TYPE "AccountSource" AS ENUM ('SEED', 'COA_UPLOAD', 'TASK_MAPPING');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('TB', 'COA', 'OTHER', 'RATES');

-- CreateEnum
CREATE TYPE "TbStatus" AS ENUM ('ERROR', 'VALIDATED_WITH_WARNINGS', 'VALIDATED');

-- CreateTable
CREATE TABLE "fsli" (
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "statement" "FsliStatement" NOT NULL,
    "class" "FsliClass" NOT NULL,
    "rate_basis" "RateBasis" NOT NULL,
    "consolidation_only" BOOLEAN NOT NULL DEFAULT false,
    "needs_counterparty" BOOLEAN NOT NULL DEFAULT false,
    "intercompany" BOOLEAN NOT NULL DEFAULT false,
    "computed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fsli_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "account_type_default" (
    "erp" "ErpSystem" NOT NULL,
    "account_type" VARCHAR(60) NOT NULL,
    "fsli_code" VARCHAR(30) NOT NULL,

    CONSTRAINT "account_type_default_pkey" PRIMARY KEY ("erp","account_type")
);

-- CreateTable
CREATE TABLE "entity_account" (
    "id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "account_code" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(200) NOT NULL,
    "account_type" VARCHAR(60),
    "parent_account" VARCHAR(200),
    "fsli_code" VARCHAR(30),
    "counterparty_code" VARCHAR(10),
    "rate_basis_override" "RateBasis",
    "source" "AccountSource" NOT NULL,
    "suggested" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entity_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate" (
    "month" DATE NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "opening" DECIMAL(20,10),
    "closing" DECIMAL(20,10),
    "average" DECIMAL(20,10),
    "source" VARCHAR(200) NOT NULL,
    "entered_by_id" UUID,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("month","currency_code")
);

-- CreateTable
CREATE TABLE "uploaded_file" (
    "id" UUID NOT NULL,
    "kind" "UploadKind" NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "task_id" UUID,
    "entity_code" VARCHAR(10),
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_version" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "status" "TbStatus" NOT NULL,
    "debits" DECIMAL(20,4) NOT NULL,
    "credits" DECIMAL(20,4) NOT NULL,
    "difference" DECIMAL(20,4) NOT NULL,
    "line_count" INTEGER NOT NULL,
    "new_accounts" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "detected_period" JSONB,
    "detected_organisation" VARCHAR(300),
    "acknowledgements" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tb_line" (
    "id" BIGSERIAL NOT NULL,
    "tb_version_id" UUID NOT NULL,
    "account_code" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "source_rows" INTEGER[],
    "zero" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tb_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_profile" (
    "entity_code" VARCHAR(10) NOT NULL,
    "settings" JSONB NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "upload_profile_pkey" PRIMARY KEY ("entity_code")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_account_entity_code_account_code_key" ON "entity_account"("entity_code", "account_code");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_file_storage_key_key" ON "uploaded_file"("storage_key");

-- CreateIndex
CREATE INDEX "uploaded_file_sha256_idx" ON "uploaded_file"("sha256");

-- CreateIndex
CREATE INDEX "uploaded_file_task_id_entity_code_kind_idx" ON "uploaded_file"("task_id", "entity_code", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "tb_version_task_id_entity_code_version_key" ON "tb_version"("task_id", "entity_code", "version");

-- CreateIndex
CREATE INDEX "tb_line_tb_version_id_idx" ON "tb_line"("tb_version_id");

-- AddForeignKey
ALTER TABLE "account_type_default" ADD CONSTRAINT "account_type_default_fsli_code_fkey" FOREIGN KEY ("fsli_code") REFERENCES "fsli"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_account" ADD CONSTRAINT "entity_account_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_account" ADD CONSTRAINT "entity_account_fsli_code_fkey" FOREIGN KEY ("fsli_code") REFERENCES "fsli"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_account" ADD CONSTRAINT "entity_account_counterparty_code_fkey" FOREIGN KEY ("counterparty_code") REFERENCES "entity"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_account" ADD CONSTRAINT "entity_account_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_entered_by_id_fkey" FOREIGN KEY ("entered_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file" ADD CONSTRAINT "uploaded_file_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file" ADD CONSTRAINT "uploaded_file_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file" ADD CONSTRAINT "uploaded_file_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_version" ADD CONSTRAINT "tb_version_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_version" ADD CONSTRAINT "tb_version_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_version" ADD CONSTRAINT "tb_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tb_line" ADD CONSTRAINT "tb_line_tb_version_id_fkey" FOREIGN KEY ("tb_version_id") REFERENCES "tb_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_profile" ADD CONSTRAINT "upload_profile_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_profile" ADD CONSTRAINT "upload_profile_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rates are units per 1 USD and must be positive when present.
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_positive" CHECK (("opening" IS NULL OR "opening" > 0) AND ("closing" IS NULL OR "closing" > 0) AND ("average" IS NULL OR "average" > 0));
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_first_of_month" CHECK (EXTRACT(DAY FROM "month") = 1);
