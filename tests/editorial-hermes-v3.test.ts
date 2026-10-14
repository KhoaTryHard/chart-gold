import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  assertReadyVideo: vi.fn(),
  getDatabase: vi.fn(),
  put: vi.fn(),
}));
vi.mock('@/db', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('@vercel/blob', () => ({ get: vi.fn(), put: mocks.put, del: vi.fn() }));
vi.mock('@/lib/editorial/admin', () => ({
  createArticleDraft: vi.fn(),
  createEditorialRevision: vi.fn(),
  lockEditorialArticle: vi.fn(),
  publishEditorialRevisionTransaction: vi.fn(),
  revalidateEditorialPublicContent: vi.fn(),
  validateEditorialSource: vi.fn(() => true),
  validateEvidence: vi.fn(),
  validatePublishableRevision: vi.fn(),
}));
vi.mock('@/lib/editorial/video-assets', async (original) => ({
  ...(await original<typeof import('@/lib/editorial/video-assets')>()),
  assertReadyVideo: mocks.assertReadyVideo,
}));
import {
  hermesManifestSchema,
  prepareHermesPackage,
} from '@/lib/editorial/hermes-integration';
import { sha256 } from '@/lib/editorial/integration-auth';
const manifest = {
  rootId: 'GOLD-ROOT',
  draftId: 'GOLD-1',
  externalRevision: 1,
  website: {
    title: 'Chênh lệch mua bán vàng',
    excerpt: 'Chênh lệch mua bán ảnh hưởng đến điểm hòa vốn.',
    contentMarkdown: 'Nội dung giải thích điểm hòa vốn khi mua vàng vật chất.',
    category: 'explain',
    sources: [
      {
        title: 'Nguồn kiểm chứng',
        url: 'https://sjc.com.vn/',
        accessedAt: '2026-10-05T01:00:00Z',
      },
    ],
    evidence: [],
    seoTitle: 'Chênh lệch mua bán vàng',
    seoDescription: 'Tìm hiểu điểm hòa vốn khi mua vàng.',
    coverAlt: 'Hai phần vàng tương đương',
  },
  facebook: {
    pageId: '1262243656966414',
    caption: 'Chênh lệch mua bán vàng tác động thế nào đến hòa vốn?',
    sourceComment: 'Nguồn bài viết được kiểm chứng.',
  },
  verification: {
    verdict: 'PASS',
    websiteDigest: sha256(
      'Nội dung giải thích điểm hòa vốn khi mua vàng vật chất.',
    ),
    captionDigest: sha256(
      'Chênh lệch mua bán vàng tác động thế nào đến hòa vốn?',
    ),
  },
};
const video = {
  assetId: '3a2bd72f-d045-4218-9c87-1b82a0cbac27',
  sha256: 'a'.repeat(64),
  scriptSha256: 'b'.repeat(64),
  audioSha256: 'c'.repeat(64),
  sceneSha256: 'd'.repeat(64),
  voiceId: 'viet_female',
  modelId: 'eleven_flash_v2_5',
  duration: 75,
  width: 1080,
  height: 1920,
  fps: 30,
  bytes: 10000,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('HERMES_VIDEO_ENABLED', 'false');
});
afterEach(() => vi.unstubAllEnvs());
describe('Hermes v2 preservation and explicit v3 video mode', () => {
  it('keeps the v2 parsed manifest and input digest identical', () => {
    const parsed = hermesManifestSchema.parse(manifest);
    expect(parsed).toEqual(manifest);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(manifest));
    expect(sha256(JSON.stringify(parsed))).toBe(
      sha256(JSON.stringify(manifest)),
    );
  });
  it('strips explicit schemaVersion 2 as the legacy parser did', () => {
    expect(
      hermesManifestSchema.parse({ ...manifest, schemaVersion: 2 }),
    ).toEqual(manifest);
  });
  it('retains owner upload provenance in the signed manifest without changing old manifests', () => {
    const uploaded = hermesManifestSchema.parse({
      ...manifest,
      imageOrigin: 'owner_upload',
    });
    expect(uploaded.imageOrigin).toBe('owner_upload');
    expect(sha256(JSON.stringify(uploaded))).not.toBe(sha256(JSON.stringify(manifest)));
    expect(hermesManifestSchema.parse(manifest)).not.toHaveProperty('imageOrigin');
    expect(hermesManifestSchema.safeParse({ ...manifest, imageOrigin: 'unverified' }).success).toBe(false);
  });
  it('retains every video integrity component for approval', () => {
    const parsed = hermesManifestSchema.parse({
      ...manifest,
      schemaVersion: 3,
      facebookMode: 'video',
      video,
    });
    expect(parsed).toMatchObject({
      schemaVersion: 3,
      facebookMode: 'video',
      video,
    });
    expect(sha256(JSON.stringify(parsed))).not.toBe(
      sha256(JSON.stringify(manifest)),
    );
  });
  it('cannot silently drop video metadata to downgrade into v2', () => {
    expect(hermesManifestSchema.safeParse({ ...manifest, video }).success).toBe(
      false,
    );
    expect(
      hermesManifestSchema.safeParse({ ...manifest, schemaVersion: 3, video })
        .success,
    ).toBe(false);
    expect(
      hermesManifestSchema.safeParse({
        ...manifest,
        schemaVersion: 2,
        facebookMode: 'video',
        video,
      }).success,
    ).toBe(false);
  });
  it('rejects v3 photo manifests containing hidden video metadata', () => {
    expect(
      hermesManifestSchema.safeParse({
        ...manifest,
        schemaVersion: 3,
        facebookMode: 'photo',
        video,
      }).success,
    ).toBe(false);
  });
  it('rejects v3 while flag is off before image, database or Blob work', async () => {
    await expect(
      prepareHermesPackage(
        { ...manifest, schemaVersion: 3, facebookMode: 'video', video },
        Buffer.from('unused'),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.assertReadyVideo).not.toHaveBeenCalled();
  });
  it('checks server-validated asset binding before preparing a video package', async () => {
    vi.stubEnv('HERMES_VIDEO_ENABLED', 'true');
    mocks.assertReadyVideo.mockRejectedValue(new Error('not validated'));
    await expect(
      prepareHermesPackage(
        { ...manifest, schemaVersion: 3, facebookMode: 'video', video },
        Buffer.from('unused'),
      ),
    ).rejects.toThrow('not validated');
    expect(mocks.assertReadyVideo).toHaveBeenCalledWith(
      video,
      expect.objectContaining({
        rootId: 'GOLD-ROOT',
        draftId: 'GOLD-1',
        externalRevision: 1,
      }),
    );
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
