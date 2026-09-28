-- CreateEnum
CREATE TYPE "ErpSystem" AS ENUM ('ZOHO', 'XERO', 'OTHER');

-- CreateEnum
CREATE TYPE "Gaap" AS ENUM ('IND_AS', 'IFRS', 'US_GAAP', 'UK_GAAP', 'OTHER');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StatementType" AS ENUM ('SFS', 'CFS');

-- CreateTable
CREATE TABLE "currency" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(10) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "currency_pkey" PRIMARY KEY ("code")
);

-- ---------------------------------------------------------------------------
-- Data migration (hand-written): entity rows from step 1 have only code + name.
-- Seed currencies, rename name -> legal_name, add the new columns as nullable, fill the
-- 7 group entities from CLAUDE.md, then make the required columns NOT NULL.
-- On a fresh database the entity table is empty and the UPDATEs do nothing; the seed
-- fills everything. The seed stays the source of truth for later runs.
-- ---------------------------------------------------------------------------

INSERT INTO "currency" ("code", "name", "symbol", "updated_at") VALUES
  ('USD', 'US dollar', '$', CURRENT_TIMESTAMP),
  ('INR', 'Indian rupee', '₹', CURRENT_TIMESTAMP),
  ('AED', 'UAE dirham', 'AED', CURRENT_TIMESTAMP),
  ('GBP', 'Pound sterling', '£', CURRENT_TIMESTAMP),
  ('SGD', 'Singapore dollar', 'S$', CURRENT_TIMESTAMP),
  ('LKR', 'Sri Lankan rupee', 'Rs', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "entity" RENAME COLUMN "name" TO "legal_name";
ALTER TABLE "entity"
  ADD COLUMN "short_name" VARCHAR(60),
  ADD COLUMN "country" VARCHAR(60),
  ADD COLUMN "functional_currency" CHAR(3),
  ADD COLUMN "reporting_currency" CHAR(3),
  ADD COLUMN "parent_code" VARCHAR(10),
  ADD COLUMN "held_by_parent_pct" DECIMAL(7,4),
  ADD COLUMN "erp" "ErpSystem",
  ADD COLUMN "gaap" "Gaap",
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "to_be_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "to_be_confirmed_note" VARCHAR(500);

UPDATE "entity" e SET
  "short_name" = v.short_name, "country" = v.country,
  "functional_currency" = v.ccy, "reporting_currency" = v.ccy,
  "parent_code" = v.parent, "held_by_parent_pct" = v.pct,
  "erp" = v.erp::"ErpSystem", "gaap" = v.gaap::"Gaap", "sort_order" = v.sort,
  "to_be_confirmed" = v.tbc, "to_be_confirmed_note" = v.note
FROM (VALUES
  ('US', 'US',                 'United States',        'USD', NULL, NULL::DECIMAL, 'ZOHO', 'US_GAAP', 1, false, NULL),
  ('IN', 'India',              'India',                'INR', 'US', 58.49,  'ZOHO', 'IND_AS',  2, false, NULL),
  ('AE', 'UAE',                'United Arab Emirates', 'AED', 'IN', 100,    'ZOHO', 'IFRS',    3, false, NULL),
  ('UK', 'UK',                 'United Kingdom',       'GBP', 'IN', 100,    'ZOHO', 'UK_GAAP', 4, false, NULL),
  ('UC', 'Unconstrained',      'United States',        'USD', 'IN', 100,    'ZOHO', 'US_GAAP', 5, false, NULL),
  ('VS', 'Veracity Services',  'Singapore',            'SGD', 'UC', 100,    'XERO', 'IFRS',    6, true,  'Functional currency SGD to be confirmed (As-Is §3).'),
  ('VM', 'Veracity Sri Lanka', 'Sri Lanka',            'LKR', 'VS', 100,    'XERO', 'IFRS',    7, true,  'Functional currency LKR to be confirmed (As-Is §3).')
) AS v(code, short_name, country, ccy, parent, pct, erp, gaap, sort, tbc, note)
WHERE e."code" = v.code;

-- Any other entity (none expected): placeholder values, flagged for review.
UPDATE "entity" SET "short_name" = "code", "country" = 'Unknown', "functional_currency" = 'USD',
  "reporting_currency" = 'USD', "erp" = 'OTHER', "gaap" = 'OTHER', "to_be_confirmed" = true,
  "to_be_confirmed_note" = 'Created before step 2; complete the entity master.'
WHERE "short_name" IS NULL;

ALTER TABLE "entity"
  ALTER COLUMN "short_name" SET NOT NULL,
  ALTER COLUMN "country" SET NOT NULL,
  ALTER COLUMN "functional_currency" SET NOT NULL,
  ALTER COLUMN "reporting_currency" SET NOT NULL,
  ALTER COLUMN "erp" SET NOT NULL,
  ALTER COLUMN "gaap" SET NOT NULL;

-- Integrity guards (not expressible in the Prisma schema).
ALTER TABLE "entity" ADD CONSTRAINT "entity_held_pct_range"
  CHECK ("held_by_parent_pct" IS NULL OR ("held_by_parent_pct" >= 0.01 AND "held_by_parent_pct" <= 100));
ALTER TABLE "entity" ADD CONSTRAINT "entity_root_has_no_pct"
  CHECK ("parent_code" IS NOT NULL OR "held_by_parent_pct" IS NULL);
ALTER TABLE "entity" ADD CONSTRAINT "entity_not_own_parent"
  CHECK ("parent_code" IS NULL OR "parent_code" <> "code");

-- CreateTable
CREATE TABLE "entity_translated_currency" (
    "entity_code" VARCHAR(10) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,

    CONSTRAINT "entity_translated_currency_pkey" PRIMARY KEY ("entity_code","currency_code")
);

-- CreateTable
CREATE TABLE "entity_historical_rate" (
    "entity_code" VARCHAR(10) NOT NULL,
    "target_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "to_be_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(300),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entity_historical_rate_pkey" PRIMARY KEY ("entity_code","target_currency")
);

-- CreateTable
CREATE TABLE "financial_year" (
    "id" UUID NOT NULL,
    "start_year" INTEGER NOT NULL,
    "label" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period" (
    "id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "type" "PeriodType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" VARCHAR(30) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "status_changed_at" TIMESTAMPTZ(3),
    "status_changed_by_id" UUID,

    CONSTRAINT "period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "due_date_rule" (
    "statement_type" "StatementType" NOT NULL,
    "period_type" "PeriodType" NOT NULL,
    "working_days" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "due_date_rule_pkey" PRIMARY KEY ("statement_type","period_type")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "due_date_override" (
    "period_id" UUID NOT NULL,
    "statement_type" "StatementType" NOT NULL,
    "due_date" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "due_date_override_pkey" PRIMARY KEY ("period_id","statement_type")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_year_start_year_key" ON "financial_year"("start_year");

-- CreateIndex
CREATE INDEX "period_start_date_idx" ON "period"("start_date");

-- CreateIndex
CREATE UNIQUE INDEX "period_financial_year_id_type_sequence_key" ON "period"("financial_year_id", "type", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_date_key" ON "holiday"("date");

-- AddForeignKey
ALTER TABLE "entity" ADD CONSTRAINT "entity_functional_currency_fkey" FOREIGN KEY ("functional_currency") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity" ADD CONSTRAINT "entity_reporting_currency_fkey" FOREIGN KEY ("reporting_currency") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity" ADD CONSTRAINT "entity_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_translated_currency" ADD CONSTRAINT "entity_translated_currency_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_translated_currency" ADD CONSTRAINT "entity_translated_currency_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_historical_rate" ADD CONSTRAINT "entity_historical_rate_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_historical_rate" ADD CONSTRAINT "entity_historical_rate_target_currency_fkey" FOREIGN KEY ("target_currency") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_year" ADD CONSTRAINT "financial_year_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_year"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_status_changed_by_id_fkey" FOREIGN KEY ("status_changed_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_date_override" ADD CONSTRAINT "due_date_override_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_date_override" ADD CONSTRAINT "due_date_override_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- More integrity guards (hand-written).
ALTER TABLE "entity_historical_rate" ADD CONSTRAINT "entity_historical_rate_positive" CHECK ("rate" > 0);
ALTER TABLE "due_date_rule" ADD CONSTRAINT "due_date_rule_working_days_range" CHECK ("working_days" BETWEEN 0 AND 366);
