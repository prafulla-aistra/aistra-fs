-- AlterTable
ALTER TABLE "consolidation_adjustment" ADD COLUMN     "brought_forward_from_id" UUID,
ADD COLUMN     "replaces_entry_id" VARCHAR(80),
ADD COLUMN     "source_ref" VARCHAR(300),
ADD COLUMN     "this_level_only" BOOLEAN NOT NULL DEFAULT false;
