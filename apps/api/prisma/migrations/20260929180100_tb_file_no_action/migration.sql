-- Deleting a task removes its files and TB versions together (NO ACTION is checked at the end
-- of the statement, so the cascade from task succeeds; a file still used by a version cannot be deleted alone).
-- DropForeignKey
ALTER TABLE "tb_version" DROP CONSTRAINT "tb_version_file_id_fkey";

-- AddForeignKey
ALTER TABLE "tb_version" ADD CONSTRAINT "tb_version_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

