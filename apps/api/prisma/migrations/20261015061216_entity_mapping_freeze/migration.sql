-- AlterTable
ALTER TABLE "entity" ADD COLUMN     "mapping_frozen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mapping_frozen_at" TIMESTAMPTZ(3),
ADD COLUMN     "mapping_frozen_by_id" UUID;
