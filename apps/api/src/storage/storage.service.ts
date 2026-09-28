/**
 * The one way the API stores uploaded files (CLAUDE.md). Business code depends only on
 * this class, never on a concrete back-end:
 *   - LocalStorageService: a local folder (./data/uploads) — used today
 *   - an S3 implementation for AWS, added later without touching business code
 *
 * Keys are S3-style object keys: "/"-separated, relative, e.g. "tb/FY2024-25/2024-04/IN.xlsx".
 * An abstract class (not an interface) so it can be used directly as a Nest injection token.
 */
export abstract class StorageService {
  /** Stores `body` under `key`, replacing any existing object. */
  abstract put(key: string, body: Buffer): Promise<void>;
  /** Returns the object's bytes. Throws StorageNotFoundError if it does not exist. */
  abstract get(key: string): Promise<Buffer>;
  abstract exists(key: string): Promise<boolean>;
  /** Deletes the object. Deleting a missing object is not an error (same as S3). */
  abstract delete(key: string): Promise<void>;
}

export class StorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Stored file not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

const KEY_SEGMENT = /^[A-Za-z0-9._ -]+$/;

/**
 * Rejects keys that could escape the storage root or behave differently between a local
 * folder and S3: empty, absolute, backslashes, "." / ".." segments, or unusual characters.
 */
export function assertValidKey(key: string): void {
  const segments = key.split('/');
  const ok =
    key.length > 0 &&
    key.length <= 1024 &&
    segments.every((s) => s !== '.' && s !== '..' && KEY_SEGMENT.test(s) && s.trim() === s);
  if (!ok) throw new RangeError(`Invalid storage key: "${key}"`);
}
