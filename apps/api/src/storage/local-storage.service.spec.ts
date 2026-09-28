import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalStorageService } from './local-storage.service';
import { StorageNotFoundError } from './storage.service';

describe('LocalStorageService', () => {
  let root: string;
  let storage: LocalStorageService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'finance-close-storage-'));
    storage = new LocalStorageService(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('stores, reads, overwrites and deletes a file under nested keys', async () => {
    const key = 'tb/FY 2024-25/2024-04/IN.xlsx';
    expect(await storage.exists(key)).toBe(false);

    await storage.put(key, Buffer.from('v1'));
    await storage.put(key, Buffer.from('v2'));
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.get(key)).toString()).toBe('v2');
    // No temp files left behind.
    expect(await readdir(path.join(root, 'tb', 'FY 2024-25', '2024-04'))).toEqual(['IN.xlsx']);

    await storage.delete(key);
    await storage.delete(key); // deleting twice is fine, like S3
    expect(await storage.exists(key)).toBe(false);
  });

  it('throws StorageNotFoundError for a missing file', async () => {
    await expect(storage.get('missing.pdf')).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it.each(['', '/abs', '../escape', 'a/../../b', 'a\\b', 'a//b', './a', 'a/ b'])(
    'rejects unsafe key %p',
    async (key) => {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    },
  );
});
