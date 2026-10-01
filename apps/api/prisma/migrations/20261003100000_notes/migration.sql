-- Notes to accounts: templates per format, structured notes per task entity (versioned); statement_text is replaced.
-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('LINE', 'NARRATIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('DRAFT', 'CARRIED_FORWARD', 'EDITED', 'REVIEWED');

-- DropForeignKey
ALTER TABLE "statement_text" DROP CONSTRAINT "statement_text_task_id_fkey";

-- DropForeignKey
ALTER TABLE "statement_text" DROP CONSTRAINT "statement_text_updated_by_id_fkey";

-- DropTable
DROP TABLE "statement_text";

-- CreateTable
CREATE TABLE "note_template" (
    "id" UUID NOT NULL,
    "format_code" VARCHAR(40) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "kind" "NoteKind" NOT NULL,
    "line_keys" TEXT[],
    "default_blocks" JSONB NOT NULL DEFAULT '[]',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "note_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_note" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "kind" "NoteKind" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "line_keys" TEXT[],
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "status" "NoteStatus" NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "carried_from_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entity_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_note_version" (
    "id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "blocks" JSONB NOT NULL,
    "status" "NoteStatus" NOT NULL,
    "edited_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_note_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_template_format_code_sort_order_idx" ON "note_template"("format_code", "sort_order");

-- CreateIndex
CREATE INDEX "entity_note_task_id_entity_code_sort_order_idx" ON "entity_note"("task_id", "entity_code", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "entity_note_version_note_id_version_key" ON "entity_note_version"("note_id", "version");

-- AddForeignKey
ALTER TABLE "note_template" ADD CONSTRAINT "note_template_format_code_fkey" FOREIGN KEY ("format_code") REFERENCES "format"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_note" ADD CONSTRAINT "entity_note_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_note_version" ADD CONSTRAINT "entity_note_version_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "entity_note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

