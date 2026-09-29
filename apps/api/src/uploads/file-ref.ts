import type { Prisma, UploadedFile } from '@prisma/client';
import type { FileRefDto } from '@finance-close/shared';

type Db = Prisma.TransactionClient;

export function toFileRef(f: UploadedFile & { uploadedBy: { name: string } }): FileRefDto {
  return {
    id: f.id,
    name: f.originalName,
    size: f.size,
    uploadedBy: f.uploadedBy.name,
    uploadedAt: f.uploadedAt.toISOString(),
  };
}

export async function fileRef(db: Db, id: string): Promise<FileRefDto> {
  const f = await db.uploadedFile.findUniqueOrThrow({
    where: { id },
    include: { uploadedBy: { select: { name: true } } },
  });
  return toFileRef(f);
}
