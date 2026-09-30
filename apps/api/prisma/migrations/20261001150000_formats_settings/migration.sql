-- Config C2: format versions and lines, task format version, settings, account source CONFIGURATION.
-- CreateEnum
CREATE TYPE "FormatLineType" AS ENUM ('HEADING', 'LINE', 'TOTAL');

-- AlterEnum
ALTER TYPE "AccountSource" ADD VALUE 'CONFIGURATION';

-- AlterTable
ALTER TABLE "format" ADD COLUMN     "current_version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "description" SET DATA TYPE VARCHAR(500);

-- AlterTable
ALTER TABLE "task" ADD COLUMN     "format_version" INTEGER;

-- CreateTable
CREATE TABLE "format_version" (
    "id" UUID NOT NULL,
    "format_code" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "format_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "format_line" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "statement" "FsliStatement" NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "type" "FormatLineType" NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "indent" INTEGER NOT NULL DEFAULT 0,
    "fslis" TEXT[],
    "formula" JSONB NOT NULL DEFAULT '[]',
    "role" VARCHAR(40),

    CONSTRAINT "format_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "format_version_format_code_version_key" ON "format_version"("format_code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "format_line_version_id_statement_key_key" ON "format_line"("version_id", "statement", "key");

-- AddForeignKey
ALTER TABLE "format_version" ADD CONSTRAINT "format_version_format_code_fkey" FOREIGN KEY ("format_code") REFERENCES "format"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "format_version" ADD CONSTRAINT "format_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "format_line" ADD CONSTRAINT "format_line_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "format_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;


UPDATE "task" SET "format_version" = 1 WHERE "format_code" IS NOT NULL AND "format_version" IS NULL;
INSERT INTO "app_setting" ("key", "value", "updated_at") VALUES ('IC_DIFF_THRESHOLD', '1.00', now()), ('RATE_SOURCE', '', now()) ON CONFLICT DO NOTHING;
