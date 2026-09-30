-- Config C1: ownership history, incorporation date, level currency overrides.
-- AlterTable
ALTER TABLE "entity" ADD COLUMN     "incorporated_on" DATE;

-- CreateTable
CREATE TABLE "entity_ownership" (
    "id" UUID NOT NULL,
    "entity_code" VARCHAR(10) NOT NULL,
    "parent_code" VARCHAR(10),
    "held_by_parent_pct" DECIMAL(7,4),
    "effective_from" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_currency_override" (
    "parent_entity_code" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "level_currency_override_pkey" PRIMARY KEY ("parent_entity_code")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_ownership_entity_code_effective_from_key" ON "entity_ownership"("entity_code", "effective_from");

-- AddForeignKey
ALTER TABLE "entity_ownership" ADD CONSTRAINT "entity_ownership_entity_code_fkey" FOREIGN KEY ("entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_ownership" ADD CONSTRAINT "entity_ownership_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "entity"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_ownership" ADD CONSTRAINT "entity_ownership_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_currency_override" ADD CONSTRAINT "level_currency_override_parent_entity_code_fkey" FOREIGN KEY ("parent_entity_code") REFERENCES "entity"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level_currency_override" ADD CONSTRAINT "level_currency_override_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing entities: their current parent and % held, effective from Apr-2025.
INSERT INTO "entity_ownership" ("id", "entity_code", "parent_code", "held_by_parent_pct", "effective_from", "reason")
SELECT gen_random_uuid(), "code", "parent_code", "held_by_parent_pct", DATE '2025-04-01', 'Initial group structure' FROM "entity"
ON CONFLICT DO NOTHING;
