import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ blobPut: vi.fn() }));

vi.mock('@vercel/blob', () => ({ put: mocks.blobPut }));

import {
  EditorialImageError,
  generateEditorialImage,
  getEditorialImageAvailability,
  storeEditorialImageUpload,
} from '@/lib/editorial/images';
import { getBrandCover, listBrandCovers } from '@/lib/editorial/brand-covers';

afterEach(() => {
  mocks.blobPut.mockReset();
  vi.unstubAllEnvs();
});

describe('editorial brand/upload image workflow', () => {
  it('maps each editorial category to a versioned brand cover', () => {
    expect(listBrandCovers()).toHaveLength(3);
    expect(getBrandCover('news').id).toBe('market-v1');
    expect(getBrandCover('practice').url).toContain(
      '/brand/covers/practice.webp',
    );
  });

  it('uses the brand library mode without requiring an image API key', () => {
    expect(getEditorialImageAvailability({})).toEqual({
      provider: 'brand-library',
      model: 'brand-covers-v1',
      configured: true,
      missing: [],
    });
  });

  it('does not call an image provider in brand-upload mode', async () => {
    await expect(
      generateEditorialImage({
        title: 'Giá vàng hôm nay',
        excerpt: 'Tóm tắt có nguồn.',
        category: 'news',
      }),
    ).rejects.toMatchObject({
      name: 'EditorialImageError',
      attempts: [],
    } satisfies Partial<EditorialImageError>);
  });

  it('stores an Admin upload privately with its normalized MIME type', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'blob-token');
    mocks.blobPut.mockResolvedValue({
      pathname: 'editorial/uploads/revision/cover.webp',
      url: 'https://blob.example/cover.webp',
      contentType: 'image/webp',
    });

    const result = await storeEditorialImageUpload({
      revisionId: 'revision',
      bytes: Buffer.from('image'),
      mimeType: 'image/webp',
    });

    expect(result.contentType).toBe('image/webp');
    expect(mocks.blobPut).toHaveBeenCalledWith(
      expect.stringMatching(/^editorial\/uploads\/revision\/.*\.webp$/),
      expect.any(Buffer),
      expect.objectContaining({ access: 'private', contentType: 'image/webp' }),
    );
  });
});
