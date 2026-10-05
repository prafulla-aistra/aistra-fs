-- CreateTable
CREATE TABLE "intercompany_pair" (
    "id" UUID NOT NULL,
    "entity_a" VARCHAR(10) NOT NULL,
    "entity_b" VARCHAR(10) NOT NULL,
    "tolerance" DECIMAL(20,4) NOT NULL DEFAULT 1,
    "to_be_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(300),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intercompany_pair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition" (
    "id" UUID NOT NULL,
    "subsidiary_code" VARCHAR(10) NOT NULL,
    "parent_code" VARCHAR(10) NOT NULL,
    "acquired_on" DATE NOT NULL,
    "pct_acquired" DECIMAL(7,4) NOT NULL,
    "cost" DECIMAL(20,4) NOT NULL,
    "share_capital" DECIMAL(20,4) NOT NULL,
    "premium" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "pre_acquisition_reserves" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "to_be_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "acquisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_rate" (
    "acquisition_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "to_be_confirmed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "acquisition_rate_pkey" PRIMARY KEY ("acquisition_id","currency")
);

-- CreateTable
CREATE TABLE "consolidation_run" (
    "task_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "entries" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "nci_profit" JSONB NOT NULL,
    "generated_by_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_run_pkey" PRIMARY KEY ("task_id","level")
);

-- CreateTable
CREATE TABLE "consolidation_adjustment" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "narration" VARCHAR(300) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "lines" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intercompany_pair_entity_a_entity_b_key" ON "intercompany_pair"("entity_a", "entity_b");

-- CreateIndex
CREATE INDEX "acquisition_subsidiary_code_idx" ON "acquisition"("subsidiary_code");

-- CreateIndex
CREATE INDEX "consolidation_adjustment_task_id_level_idx" ON "consolidation_adjustment"("task_id", "level");

-- AddForeignKey
ALTER TABLE "acquisition_rate" ADD CONSTRAINT "acquisition_rate_acquisition_id_fkey" FOREIGN KEY ("acquisition_id") REFERENCES "acquisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_run" ADD CONSTRAINT "consolidation_run_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_adjustment" ADD CONSTRAINT "consolidation_adjustment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

