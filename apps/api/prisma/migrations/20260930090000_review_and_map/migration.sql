-- Page 4: account type on TB lines; the task in which an account was mapped.
-- AlterTable
ALTER TABLE "entity_account" ADD COLUMN     "mapped_in_task_id" UUID;

-- AlterTable
ALTER TABLE "tb_line" ADD COLUMN     "account_type" VARCHAR(60);

-- AddForeignKey
ALTER TABLE "entity_account" ADD CONSTRAINT "entity_account_mapped_in_task_id_fkey" FOREIGN KEY ("mapped_in_task_id") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

