import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, UploadKind, UploadedFile } from '@prisma/client';
import type { StorageService } from '../storage/storage.service';

/** A file name made safe for a storage key segment (the original name is kept in the DB). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '');
  return (cleaned || 'file').slice(-120);
}

export function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Stores an upload's original bytes in object storage and records it. Keys:
 *   tasks/<task id>/<entity>/<kind>/<uuid>-<name>     files of a task entity
 *   rates/<uuid>-<name>                                rate files (group level)
 */
export async function storeUpload(
  db: Prisma.TransactionClient,
  storage: StorageService,
  f: {
    kind: UploadKind;
    body: Buffer;
    originalName: string;
    contentType: string;
    taskId?: string | null;
    entityCode?: string | null;
    uploadedById: string;
    uploadedAt?: Date;
  },
): Promise<UploadedFile> {
  const id = randomUUID();
  const name = `${id}-${safeFileName(f.originalName)}`;
  const storageKey =
    f.taskId && f.entityCode
      ? `tasks/${f.taskId}/${f.entityCode}/${f.kind.toLowerCase()}/${name}`
      : `${f.kind.toLowerCase()}/${name}`;
  await storage.put(storageKey, f.body);
  return db.uploadedFile.create({
    data: {
      id,
      kind: f.kind,
      storageKey,
      originalName: f.originalName.slice(0, 255),
      contentType: f.contentType.slice(0, 120) || 'application/octet-stream',
      size: f.body.length,
      sha256: sha256(f.body),
      taskId: f.taskId ?? null,
      entityCode: f.entityCode ?? null,
      uploadedById: f.uploadedById,
      ...(f.uploadedAt ? { uploadedAt: f.uploadedAt } : {}),
    },
  });
}
