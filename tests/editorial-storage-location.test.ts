import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  db: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  verifiedPut: vi.fn(),
}));
vi.mock('@vercel/blob', () => ({
  get: mocks.get,
  head: mocks.head,
  put: mocks.put,
  del: mocks.del,
}));
vi.mock('@/db', () => ({ getDatabase: mocks.db }));
vi.mock('@/lib/editorial/r2', () => ({
  r2Config: () => ({ bucket: 'test' }),
  r2Read: mocks.read,
  r2Delete: mocks.remove,
  r2PutVerified: mocks.verifiedPut,
}));
import {
  expectedMediaEtag,
  get,
  del,
  put,
} from '@/lib/editorial/media-storage';
function location(row: unknown, references: unknown[] = []) {
  const limit = vi
    .fn()
    .mockResolvedValueOnce(row ? [row] : [])
    .mockResolvedValue(references);
  const chain = { from: () => chain, where: () => chain, limit };
  const db = { select: () => chain, insert: vi.fn(), delete: vi.fn() };
  mocks.db.mockReturnValue(db);
  return db;
}
const row = {
  pathname: 'editorial/video.mp4',
  objectKey: 'editorial/video.mp4',
  provider: 'r2',
  size: 100,
  contentType: 'video/mp4',
  etag: '"r2-copy-etag"',
  verifiedAt: new Date(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MEDIA_STORAGE_DUAL_READ', 'true');
  vi.stubEnv('MEDIA_STORAGE_PROVIDER', 'blob');
});
afterEach(() => vi.unstubAllEnvs());
describe('media location compatibility', () => {
  it('keeps unmapped legacy assets on Blob while new writes can remain disabled', async () => {
    location(null);
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response('old').body,
      blob: { etag: 'blob' },
    });
    expect(await get('editorial/old.png')).toMatchObject({
      ranged: false,
      blob: { etag: 'blob' },
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('uses the R2 ETag after migration instead of comparing it to the old Blob ETag', async () => {
    location(row);
    expect(await expectedMediaEtag(row.pathname, 'legacy-blob-etag')).toBe(
      row.etag,
    );
  });
  it('streams actual R2 ranges without downloading the complete MP4', async () => {
    location(row);
    mocks.read.mockResolvedValue({
      ETag: row.etag,
      Body: { transformToWebStream: () => new Response('range').body },
    });
    expect(
      await get(row.pathname, { range: { start: 1, end: 5 } }),
    ).toMatchObject({ ranged: true, blob: { size: 100 } });
    expect(mocks.read).toHaveBeenCalledWith(row.objectKey, {
      range: { start: 1, end: 5 },
      etag: row.etag,
    });
  });
  it('rejects a replaced R2 object before exposing it', async () => {
    location(row);
    mocks.read.mockResolvedValue({ ETag: 'other', Body: {} });
    await expect(get(row.pathname)).rejects.toThrow('thay đổi');
  });
  it('does not remove a just-uploaded image once a committed revision references it', async () => {
    const key = 'editorial/image.png';
    const db = location({ ...row, pathname: key, objectKey: key }, [
      { id: 'revision' },
    ]);
    await del('r2://test/' + key);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
  it('preserves the legacy private upload protocol during staged rollout', async () => {
    mocks.put.mockResolvedValue({ pathname: 'key' });
    await put('editorial/image.png', Buffer.from('bytes'), {
      contentType: 'image/png',
    });
    expect(mocks.put).toHaveBeenCalledWith(
      'editorial/image.png',
      expect.any(Buffer),
      expect.objectContaining({ access: 'private' }),
    );
    expect(mocks.verifiedPut).not.toHaveBeenCalled();
  });
});
