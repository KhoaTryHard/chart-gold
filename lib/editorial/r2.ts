import { createHash } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const mediaSha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export function r2Config() {
  const account = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (account ? `https://${account}.r2.cloudflarestorage.com` : '');
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error('R2 chưa được cấu hình đầy đủ.');
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' ||
    !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/'
  ) {
    throw new Error('Endpoint R2 không hợp lệ.');
  }
  return { endpoint: url.origin, bucket, accessKeyId, secretAccessKey };
}

export function r2Client() {
  const config = r2Config();
  return new S3Client({
    endpoint: config.endpoint,
    region: 'auto',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });
}

export function validateObjectKey(key: string) {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith('/') ||
    key.split('/').some((part) => part === '..' || part === '.') ||
    key.includes('\\') ||
    Array.from(key).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('Khóa media không hợp lệ.');
  return key;
}

export async function r2Head(key: string) {
  return r2Client().send(
    new HeadObjectCommand({
      Bucket: r2Config().bucket,
      Key: validateObjectKey(key),
    }),
  );
}

export async function r2Read(
  key: string,
  options: { range?: { start: number; end: number }; etag?: string } = {},
) {
  return r2Client().send(
    new GetObjectCommand({
      Bucket: r2Config().bucket,
      Key: validateObjectKey(key),
      IfMatch: options.etag,
      ...(options.range
        ? { Range: `bytes=${options.range.start}-${options.range.end}` }
        : {}),
    }),
  );
}

export async function r2PutVerified(
  key: string,
  bytes: Buffer,
  contentType: string,
) {
  const checksum = mediaSha256(bytes);
  try {
    await r2Client().send(
      new PutObjectCommand({
        Bucket: r2Config().bucket,
        Key: validateObjectKey(key),
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.length,
        StorageClass: 'STANDARD',
        IfNoneMatch: '*',
        Metadata: { sha256: checksum },
      }),
    );
  } catch (error) {
    // A retried immutable PUT may find the object written by its first attempt.
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode !== 412
    )
      throw error;
  }
  const read = await r2Read(key);
  const stored = await read.Body?.transformToByteArray();
  if (
    !stored ||
    stored.length !== bytes.length ||
    mediaSha256(stored) !== checksum ||
    read.ContentType !== contentType ||
    !read.ETag
  )
    throw new Error('Không xác minh được file R2.');
  return { sha256: checksum, etag: read.ETag, size: bytes.length, contentType };
}

export async function r2Delete(key: string) {
  await r2Client().send(
    new DeleteObjectCommand({
      Bucket: r2Config().bucket,
      Key: validateObjectKey(key),
    }),
  );
}

export async function r2UploadGrant(key: string, bytes: number) {
  const headers = {
    'content-type': 'video/mp4',
    'if-none-match': '*',
    'content-length': String(bytes),
  };
  const url = await getSignedUrl(
    r2Client(),
    new PutObjectCommand({
      Bucket: r2Config().bucket,
      Key: validateObjectKey(key),
      ContentType: headers['content-type'],
      ContentLength: bytes,
      IfNoneMatch: '*',
      StorageClass: 'STANDARD',
    }),
    {
      expiresIn: 900,
      signableHeaders: new Set([
        'content-type',
        'content-length',
        'if-none-match',
      ]),
    },
  );
  return {
    provider: 'r2' as const,
    method: 'PUT' as const,
    url,
    headers,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  };
}
