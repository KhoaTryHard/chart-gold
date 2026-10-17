import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async (original) => ({
  ...(await original<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = mocks.send;
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.sign }));
import {
  r2Config,
  r2PutVerified,
  r2Read,
  r2UploadGrant,
  mediaSha256,
} from '@/lib/editorial/r2';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv(
    'R2_ENDPOINT',
    'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com',
  );
  vi.stubEnv('R2_BUCKET', 'chart-gold-media-staging');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-access');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
});
afterEach(() => vi.unstubAllEnvs());
const bytes = Buffer.from('immutable-approved-media');
const stored = (body = bytes) => ({
  ETag: '"r2-etag"',
  ContentType: 'image/png',
  Body: { transformToByteArray: async () => body },
});

describe('R2 immutable media storage', () => {
  it.each([
    'http://localhost',
    'https://example.com',
    'https://user:password@' + 'a'.repeat(32) + '.r2.cloudflarestorage.com',
    'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com/bucket',
  ])(
    'rejects unexpected endpoint %s before sending credentials',
    (endpoint) => {
      vi.stubEnv('R2_ENDPOINT', endpoint);
      expect(() => r2Config()).toThrow('Endpoint R2');
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
  it('writes Standard with create-only condition and verifies the downloaded bytes', async () => {
    mocks.send.mockResolvedValueOnce({}).mockResolvedValueOnce(stored());
    expect(
      await r2PutVerified('editorial/test.png', bytes, 'image/png'),
    ).toMatchObject({
      sha256: mediaSha256(bytes),
      etag: '"r2-etag"',
      size: bytes.length,
    });
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      IfNoneMatch: '*',
      StorageClass: 'STANDARD',
      ContentType: 'image/png',
      ContentLength: bytes.length,
    });
  });
  it('recovers an uncertain immutable PUT only when remote bytes match', async () => {
    mocks.send
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } })
      .mockResolvedValueOnce(stored());
    await expect(
      r2PutVerified('editorial/test.png', bytes, 'image/png'),
    ).resolves.toMatchObject({ sha256: mediaSha256(bytes) });
  });
  it('does not overwrite or accept a colliding object', async () => {
    mocks.send
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } })
      .mockResolvedValueOnce(stored(Buffer.from('different')));
    await expect(
      r2PutVerified('editorial/test.png', bytes, 'image/png'),
    ).rejects.toThrow('xác minh');
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it('does not treat metadata supplied by the uploader as checksum proof', async () => {
    mocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(stored(Buffer.alloc(bytes.length)));
    await expect(
      r2PutVerified('editorial/test.png', bytes, 'image/png'),
    ).rejects.toThrow('xác minh');
  });
  it('requests only the requested video bytes, pinned to provider ETag', async () => {
    mocks.send.mockResolvedValue({});
    await r2Read('editorial/video.mp4', {
      range: { start: 10, end: 20 },
      etag: '"new-provider-etag"',
    });
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      Range: 'bytes=10-20',
      IfMatch: '"new-provider-etag"',
    });
  });
  it('scopes a 15-minute upload grant to immutable MP4 with the registered length', async () => {
    mocks.sign.mockResolvedValue('https://r2.example/signed');
    const result = await r2UploadGrant('editorial/video.mp4', 123);
    expect(result.headers).toEqual({
      'content-type': 'video/mp4',
      'content-length': '123',
      'if-none-match': '*',
    });
    expect(mocks.sign.mock.calls[0][1].input).toMatchObject({
      Key: 'editorial/video.mp4',
      ContentLength: 123,
      IfNoneMatch: '*',
    });
    expect(mocks.sign.mock.calls[0][2].expiresIn).toBe(900);
  });
  it.each(['../secret', '/absolute', 'editorial/../secret', 'editorial\\file'])(
    'rejects invalid object key %s',
    async (key) => {
      await expect(r2Read(key)).rejects.toThrow('media');
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
});
