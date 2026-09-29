-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "last_format_code" VARCHAR(40);

-- AlterTable
ALTER TABLE "financial_year" ADD COLUMN     "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "task" DROP COLUMN "format",
ADD COLUMN     "format_code" VARCHAR(40),
ADD COLUMN     "reviewer_note" VARCHAR(1000);

-- CreateTable
CREATE TABLE "format" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "format_pkey" PRIMARY KEY ("code")
);

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_last_format_code_fkey" FOREIGN KEY ("last_format_code") REFERENCES "format"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_format_code_fkey" FOREIGN KEY ("format_code") REFERENCES "format"("code") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data (hand-written)
-- ---------------------------------------------------------------------------

-- Starting formats; maintained in the Formats configuration screen later.
INSERT INTO "format" ("code", "name", "description", "sort_order", "updated_at") VALUES
  ('STATUTORY', 'Statutory FS', 'Balance sheet, profit and loss, cash flow statement and notes in the statutory layout for the entity''s GAAP.', 1, CURRENT_TIMESTAMP),
  ('MANAGEMENT', 'Management FS', 'Condensed balance sheet and profit and loss for internal management reporting.', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Step 1 of every task is now called UPLOAD_DATA ("Upload data").
UPDATE "task_entity" SET "current_step" = 'UPLOAD_DATA' WHERE "current_step" = 'UPLOAD_TB';
UPDATE "task_level" SET "current_step" = 'UPLOAD_DATA' WHERE "current_step" = 'UPLOAD_TB';
UPDATE "task" SET "current_step" = 'UPLOAD_DATA' WHERE "current_step" = 'UPLOAD_TB';

-- Demo tasks were created before formats existed.
UPDATE "task" SET "format_code" = 'STATUTORY' WHERE "format_code" IS NULL AND "is_demo";
