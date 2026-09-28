import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertValidKey, StorageNotFoundError, StorageService } from './storage.service';

/** Stores files in a local folder, mirroring the object key as a relative path. */
export class LocalStorageService extends StorageService {
  constructor(private readonly root: string) {
    super();
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Write to a temp file and rename, so a crash never leaves a half-written upload.
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, body);
      await rename(tmp, file);
    } finally {
      await rm(tmp, { force: true });
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    assertValidKey(key);
    const file = path.resolve(this.root, ...key.split('/'));
    // Defence in depth: assertValidKey already forbids "..".
    if (!file.startsWith(path.resolve(this.root) + path.sep)) {
      throw new RangeError(`Invalid storage key: "${key}"`);
    }
    return file;
  }
}

function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
