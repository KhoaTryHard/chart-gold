import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/db', () => ({ getDatabase: vi.fn() }));
import {
  canRetireBlob,
  storageMaintenance,
} from '@/lib/editorial/storage-maintenance';
const now = Date.now();
const location = {
  provider: 'r2',
  verifiedAt: new Date(now - 31 * 86400000),
  sourceBlobUrl: 'https://private.example/source',
  sha256: 'a'.repeat(64),
  etag: 'r2-etag',
};
afterEach(() => vi.unstubAllEnvs());
it('retains Blob for the full 30-day rollback window', () => {
  expect(
    canRetireBlob(
      { ...location, verifiedAt: new Date(now - 29 * 86400000) },
      now,
    ),
  ).toBe(false);
  expect(canRetireBlob(location, now)).toBe(true);
});
it('never retires an unverified, rolled-back or R2-only object', () => {
  expect(canRetireBlob({ ...location, verifiedAt: null }, now)).toBe(false);
  expect(canRetireBlob({ ...location, provider: 'blob' }, now)).toBe(false);
  expect(canRetireBlob({ ...location, sourceBlobUrl: null }, now)).toBe(false);
  expect(canRetireBlob({ ...location, sha256: null }, now)).toBe(false);
});
it('disables source deletion as soon as writes are rolled back to Blob', async () => {
  vi.stubEnv('MEDIA_STORAGE_RETIRE_BLOB', 'true');
  vi.stubEnv('MEDIA_STORAGE_PROVIDER', 'blob');
  await expect(
    storageMaintenance({ operation: 'retire' }),
  ).rejects.toMatchObject({ status: 503 });
});
