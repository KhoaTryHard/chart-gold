import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  head: vi.fn(),
  get: vi.fn(),
  generateClientTokenFromReadWriteToken: vi.fn(),
}));
vi.mock('@/db', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('@vercel/blob', () => ({ head: mocks.head, get: mocks.get }));
vi.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken:
    mocks.generateClientTokenFromReadWriteToken,
}));
import { sha256 } from '@/lib/editorial/integration-auth';
import {
  assertReadyVideo,
  completeVideoUpload,
  createVideoUploadToken,
  issueVideoMediaUrl,
  parseVideoRange,
  serveVideoMedia,
  videoDescriptorSchema,
  videoMediaSignature,
} from '@/lib/editorial/video-assets';
import { inspectEditorialMp4 } from '@/lib/editorial/video-mp4';

const id = '3a2bd72f-d045-4218-9c87-1b82a0cbac27',
  packageId = '43580fb3-d98e-4aee-ac0e-2b888958dc64';
const key = 'editorial-test-secret-at-least-32-chars';
const ffmpegFixture = readFileSync(
  new URL('./fixtures/editorial-video.mp4', import.meta.url),
);
function codecConfig(type: string) {
  const typeOffset = ffmpegFixture.indexOf(Buffer.from(type));
  const end = typeOffset - 4 + ffmpegFixture.readUInt32BE(typeOffset - 4);
  return ffmpegFixture.subarray(typeOffset + 4, end);
}
function box(type: string, ...data: Buffer[]) {
  const payload = Buffer.concat(data),
    header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}
function integers(...values: number[]) {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => data.writeUInt32BE(value, i * 4));
  return data;
}
/** Minimal structural export with constant frame timing and in-file samples. */
function fixture(
  duration = 60,
  fps = 30,
  width = 1080,
  audio = true,
  faststart = true,
) {
  const videoSamples = duration * fps,
    audioSamples = duration * 50;
  const track = (kind: string, offset: number) => {
    const isVideo = kind === 'vide',
      count = isVideo ? videoSamples : audioSamples;
    const tkhd = Buffer.alloc(84);
    tkhd.writeUInt32BE(isVideo ? width * 65536 : 0, 76);
    tkhd.writeUInt32BE(isVideo ? 1920 * 65536 : 0, 80);
    const mdhd = Buffer.alloc(24);
    mdhd.writeUInt32BE(isVideo ? fps * 3000 : 48000, 12);
    mdhd.writeUInt32BE(isVideo ? videoSamples * 3000 : audioSamples * 960, 16);
    const handler = Buffer.alloc(12);
    handler.write(kind, 8, 'ascii');
    const sampleHeader = Buffer.alloc(isVideo ? 78 : 28);
    if (isVideo) {
      sampleHeader.writeUInt16BE(width, 24);
      sampleHeader.writeUInt16BE(1920, 26);
    } else {
      sampleHeader.writeUInt16BE(1, 16);
      sampleHeader.writeUInt32BE(48000 * 65536, 24);
    }
    const config = isVideo
      ? box('avcC', codecConfig('avcC'))
      : box('esds', codecConfig('esds'));
    return box(
      'trak',
      box('tkhd', tkhd),
      box(
        'mdia',
        box('mdhd', mdhd),
        box('hdlr', handler),
        box(
          'minf',
          box(
            'stbl',
            box(
              'stsd',
              integers(0, 1),
              box(isVideo ? 'avc1' : 'mp4a', sampleHeader, config),
            ),
            box('stts', integers(0, 1, count, isVideo ? 3000 : 960)),
            box('stsz', integers(0, 1, count)),
            box('stsc', integers(0, 1, 1, count, 1)),
            box('stco', integers(0, 1, offset)),
          ),
        ),
      ),
    );
  };
  const ftyp = box(
    'ftyp',
    Buffer.from('isom'),
    integers(0),
    Buffer.from('isom'),
  );
  const moov0 = box(
    'moov',
    track('vide', 0),
    ...(audio ? [track('soun', 0)] : []),
  );
  const mdatStart = faststart
    ? ftyp.length + moov0.length + 8
    : ftyp.length + 8;
  const moov = box(
    'moov',
    track('vide', mdatStart),
    ...(audio ? [track('soun', mdatStart + videoSamples)] : []),
  );
  const mdat = box(
    'mdat',
    Buffer.alloc(videoSamples + (audio ? audioSamples : 0), 1),
  );
  return Buffer.concat(faststart ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}
function descriptor(bytes = fixture()) {
  return {
    sha256: sha256(bytes),
    scriptSha256: 'a'.repeat(64),
    audioSha256: 'b'.repeat(64),
    sceneSha256: 'c'.repeat(64),
    voiceId: 'viet_voice',
    modelId: 'eleven_flash_v2_5',
    duration: 60,
    width: 1080 as const,
    height: 1920 as const,
    fps: 30 as const,
    bytes: bytes.length,
  };
}
function asset(status = 'ready', bytes = fixture()) {
  const input = {
    rootId: 'ROOT',
    draftId: 'DRAFT',
    externalRevision: 2,
    video: descriptor(bytes),
  };
  return {
    id,
    clientId: 'kim-tuyen-newsroom',
    ...input,
    descriptor: input.video,
    descriptorDigest: sha256(JSON.stringify(input)),
    pathname: `editorial/videos/${id}/${input.video.sha256}.mp4`,
    blobEtag: 'immutable-etag',
    status,
    validatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
function fakeDb(selectResults: unknown[]) {
  const result = [...selectResults];
  const limit = vi.fn(async () => [result.shift()]);
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit,
  };
  const returning = vi.fn(async () => [asset()]);
  const mutations = {
    values: vi.fn(() => mutations),
    set: vi.fn(() => mutations),
    where: vi.fn(() => mutations),
    returning,
  };
  const db = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => mutations),
    update: vi.fn(() => mutations),
    execute: vi.fn(),
    transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(db)),
  };
  mocks.getDatabase.mockReturnValue(db);
  return { db, mutations, returning, limit };
}
function published() {
  const video = { ...descriptor(), assetId: id };
  const canonical = JSON.stringify({
    schemaVersion: 3,
    facebookMode: 'video',
    video,
  });
  return {
    pack: {
      id: packageId,
      rootId: 'ROOT',
      draftId: 'DRAFT',
      externalRevision: 2,
      state: 'published',
      approvalProvenance: { actorId: 'owner' },
      revisionId: 'revision',
      reviewPackage: canonical,
      reviewDigest: sha256(canonical),
    },
    article: { status: 'published', publishedRevisionId: 'revision' },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('HERMES_VIDEO_ENABLED', 'true');
  vi.stubEnv('HERMES_EDITORIAL_ENABLED', 'true');
  vi.stubEnv('HERMES_EDITORIAL_SECRET', key);
});
afterEach(() => vi.unstubAllEnvs());

describe('MP4 server inspection', () => {
  it('accepts a real 60-second FFmpeg H.264/AAC export', () =>
    expect(inspectEditorialMp4(ffmpegFixture)).toMatchObject({
      duration: 60,
      videoCodec: 'h264',
      audioCodec: 'aac',
    }));
  it('accepts the exact H.264/AAC portrait contract', () =>
    expect(inspectEditorialMp4(fixture())).toMatchObject({
      duration: 60,
      width: 1080,
      height: 1920,
      fps: 30,
    }));
  it.each([59, 91])('blocks %i seconds', (duration) =>
    expect(() => inspectEditorialMp4(fixture(duration))).toThrow('60–90'),
  );
  it('blocks a wrong frame rate', () =>
    expect(() => inspectEditorialMp4(fixture(60, 29))).toThrow('30 fps'));
  it('blocks incorrect dimensions', () =>
    expect(() => inspectEditorialMp4(fixture(60, 30, 720))).toThrow('1080'));
  it('blocks missing audio', () =>
    expect(() => inspectEditorialMp4(fixture(60, 30, 1080, false))).toThrow(
      'một track',
    ));
  it('requires faststart', () =>
    expect(() =>
      inspectEditorialMp4(fixture(60, 30, 1080, true, false)),
    ).toThrow('faststart'));
  it('rejects truncated input rather than trusting client metadata', () =>
    expect(() => inspectEditorialMp4(fixture().subarray(0, -3))).toThrow(
      'MP4 bị cắt',
    ));
  it('rejects non-AAC audio', () => {
    const bytes = fixture();
    const found = bytes.indexOf(Buffer.from([0x40, 0x15]));
    bytes[found] = 0x6b;
    expect(() => inspectEditorialMp4(bytes)).toThrow('AAC');
  });
  it('requires the sample-to-chunk map', () => {
    const bytes = fixture();
    bytes.write('free', bytes.indexOf(Buffer.from('stsc')), 'ascii');
    expect(() => inspectEditorialMp4(bytes)).toThrow('stsc');
  });
  it('rejects chunks extending beyond mdat despite in-bounds start offsets', () => {
    const bytes = fixture();
    const offset = bytes.indexOf(Buffer.from('stco'));
    bytes.writeUInt32BE(bytes.length - 1, offset + 12);
    expect(() => inspectEditorialMp4(bytes)).toThrow('ngoài dữ liệu');
  });
  it.each([-1, 1])(
    'rejects a sample-to-chunk total differing by %i',
    (delta) => {
      const bytes = fixture();
      const offset = bytes.indexOf(Buffer.from('stsc'));
      bytes.writeUInt32BE(1800 + delta, offset + 16);
      expect(() => inspectEditorialMp4(bytes)).toThrow('theo chunk');
    },
  );
  it('rejects overlapping chunks across the video and audio tracks', () => {
    const bytes = fixture();
    const first = bytes.indexOf(Buffer.from('stco'));
    const second = bytes.indexOf(Buffer.from('stco'), first + 4);
    bytes.writeUInt32BE(bytes.readUInt32BE(first + 12), second + 12);
    expect(() => inspectEditorialMp4(bytes)).toThrow('chồng lấn');
  });
  it('rejects missing or truncated H.264 parameter sets', () => {
    for (const missing of [true, false]) {
      const bytes = fixture();
      const offset = bytes.indexOf(Buffer.from('avcC')) + 4;
      if (missing) bytes[offset + 5] = 0xe0;
      else bytes.writeUInt16BE(65535, offset + 6);
      expect(() => inspectEditorialMp4(bytes)).toThrow('H.264');
    }
  });
  it('rejects a stray AAC marker outside the decoder descriptor', () => {
    const bytes = fixture();
    const offset = bytes.indexOf(Buffer.from('esds')) + 4;
    bytes[offset + 4] = 0x7f;
    expect(() => inspectEditorialMp4(bytes)).toThrow('AAC');
  });
  it('rejects descriptor lengths outside their parent and unsupported audio configs', () => {
    const truncated = fixture();
    const offset = truncated.indexOf(Buffer.from('esds')) + 4;
    truncated[offset + 8] = 0x7f;
    expect(() => inspectEditorialMp4(truncated)).toThrow('AAC');
    const notLc = fixture();
    const config = notLc.indexOf(Buffer.from([0x11, 0x88, 0x56, 0xe5]));
    notLc[config] = 0x29;
    expect(() => inspectEditorialMp4(notLc)).toThrow('AAC-LC');
  });
});
describe('bounded private upload and published download', () => {
  it('feature flag prevents upload and credit-independent work', async () => {
    vi.stubEnv('HERMES_VIDEO_ENABLED', 'false');
    await expect(createVideoUploadToken({})).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });
  it('reuses validated assets without issuing another upload token', async () => {
    fakeDb([asset()]);
    expect(
      await createVideoUploadToken({
        rootId: 'ROOT',
        draftId: 'DRAFT',
        externalRevision: 2,
        video: descriptor(),
      }),
    ).toMatchObject({ assetId: id, status: 'ready', clientToken: null });
    expect(mocks.generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
  });
  it('scopes client tokens to one immutable path and exact byte cap', async () => {
    fakeDb([asset('uploading')]);
    mocks.generateClientTokenFromReadWriteToken.mockResolvedValue(
      'scoped-token',
    );
    const response = await createVideoUploadToken({
      rootId: 'ROOT',
      draftId: 'DRAFT',
      externalRevision: 2,
      video: descriptor(),
    });
    expect(response.clientToken).toBe('scoped-token');
    expect(mocks.generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: asset().pathname,
        allowedContentTypes: ['video/mp4'],
        maximumSizeInBytes: fixture().length,
        allowOverwrite: false,
        addRandomSuffix: false,
      }),
    );
  });
  it('rejects a reused draft with different video', async () => {
    fakeDb([asset('uploading')]);
    await expect(
      createVideoUploadToken({
        rootId: 'ROOT',
        draftId: 'DRAFT',
        externalRevision: 2,
        video: { ...descriptor(), scriptSha256: 'd'.repeat(64) },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('validates downloaded bytes and MP4 before marking ready', async () => {
    const bytes = fixture();
    const { mutations } = fakeDb([asset('uploading')]);
    mocks.head.mockResolvedValue({
      contentType: 'video/mp4',
      size: bytes.length,
      url: 'private-url',
      etag: 'immutable-etag',
    });
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(bytes).body,
      blob: { etag: 'immutable-etag', size: bytes.length },
    });
    expect(await completeVideoUpload(id)).toMatchObject({
      status: 'ready',
      assetId: id,
    });
    expect(mutations.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', blobEtag: 'immutable-etag' }),
    );
  });
  it('rejects changed bytes, not a self-reported checksum', async () => {
    const bytes = fixture();
    const { mutations } = fakeDb([asset('uploading')]);
    mocks.head.mockResolvedValue({
      contentType: 'video/mp4',
      size: bytes.length,
    });
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(changed).body,
      blob: { etag: 'immutable-etag', size: bytes.length },
    });
    await expect(completeVideoUpload(id)).rejects.toThrow('Checksum');
    expect(mutations.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected' }),
    );
  });
  it('binds asset to the exact article revision', async () => {
    fakeDb([asset()]);
    await expect(
      assertReadyVideo(
        { ...descriptor(), assetId: id },
        { rootId: 'ROOT', draftId: 'OTHER', externalRevision: 2 },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('issues media URL only after website publication and approval', async () => {
    fakeDb([
      asset(),
      {
        ...published(),
        article: { status: 'draft', publishedRevisionId: null },
      },
    ]);
    await expect(issueVideoMediaUrl(id, { packageId })).rejects.toMatchObject({
      status: 409,
    });
  });
  it('issues an expiring URL separate from canonical metadata', async () => {
    fakeDb([asset(), published(), asset()]);
    const result = await issueVideoMediaUrl(id, { packageId });
    const url = new URL(result.url);
    expect(url.searchParams.get('signature')).toBe(
      videoMediaSignature(key, id, packageId, url.searchParams.get('expires')!),
    );
    expect(result).not.toHaveProperty('clientToken');
  });
  it('rejects expired or tampered media links before reading database', async () => {
    const expires = String(Math.floor(Date.now() / 1000) - 1);
    const signature = videoMediaSignature(key, id, packageId, expires);
    await expect(
      serveVideoMedia(
        new Request(
          `https://example.test/media?packageId=${packageId}&expires=${expires}&signature=${signature}`,
        ),
        id,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });
  it('serves range bytes without exposing private Blob credentials', async () => {
    fakeDb([asset(), published(), asset()]);
    const bytes = fixture(),
      expires = String(Math.floor(Date.now() / 1000) + 100);
    const signature = videoMediaSignature(key, id, packageId, expires);
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(bytes).body,
      blob: { etag: 'immutable-etag', size: bytes.length },
    });
    const response = await serveVideoMedia(
      new Request(
        `https://example.test/media?packageId=${packageId}&expires=${expires}&signature=${signature}`,
        { headers: { Range: 'bytes=5-15' } },
      ),
      id,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 5-15/${bytes.length}`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      bytes.subarray(5, 16),
    );
    expect(response.headers.get('authorization')).toBeNull();
  });
  it('rejects out-of-file, multiple and malformed ranges', () => {
    for (const value of [
      'bytes=100-101',
      'bytes=1-2,4-5',
      'bytes=-',
      'bytes=-0',
    ])
      expect(() => parseVideoRange(value, 100)).toThrow();
    expect(parseVideoRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  });
  it('rejects descriptors outside export contract or containing download URLs', () => {
    expect(
      videoDescriptorSchema.safeParse({ ...descriptor(), width: 720 }).success,
    ).toBe(false);
    expect(
      videoDescriptorSchema.safeParse({
        ...descriptor(),
        url: 'https://example.test',
      }).success,
    ).toBe(false);
  });
});
