import * as blob from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { mediaStorageLocations } from '@/db/schema';
import { r2Config, r2Delete, r2Head, r2PutVerified, r2Read } from './r2';

export function mediaWriteProvider() {
  const provider = process.env.MEDIA_STORAGE_PROVIDER || 'blob';
  if (provider !== 'blob' && provider !== 'r2')
    throw new Error('Nhà cung cấp media không hợp lệ.');
  return provider;
}
export const mediaDualRead = () =>
  mediaWriteProvider() === 'r2' ||
  process.env.MEDIA_STORAGE_DUAL_READ === 'true';
async function database() {
  return (await import('@/db')).getDatabase();
}

export async function mediaLocation(pathname: string) {
  if (!mediaDualRead()) return null;
  const [row] = await (
    await database()
  )
    .select()
    .from(mediaStorageLocations)
    .where(eq(mediaStorageLocations.pathname, pathname))
    .limit(1);
  return row ?? null;
}

export async function put(
  pathname: string,
  bytes: Buffer,
  options: {
    contentType?: string;
    access?: string;
    addRandomSuffix?: boolean;
    cacheControlMaxAge?: number;
  },
) {
  if (mediaWriteProvider() === 'blob')
    return blob.put(pathname, bytes, { ...options, access: 'private' });
  const result = await r2PutVerified(
    pathname,
    bytes,
    options.contentType || 'application/octet-stream',
  );
  const url = `r2://${r2Config().bucket}/${pathname}`;
  await (await database()).insert(mediaStorageLocations).values({
    pathname,
    provider: 'r2',
    objectKey: pathname,
    size: result.size,
    contentType: result.contentType,
    sha256: result.sha256,
    etag: result.etag,
    verifiedAt: new Date(),
  });
  return { pathname, url, contentType: result.contentType };
}

export async function head(pathname: string) {
  const location = await mediaLocation(pathname);
  if (!location || location.provider === 'blob') return blob.head(pathname);
  const metadata = await r2Head(location.objectKey);
  return {
    url: `r2://${r2Config().bucket}/${location.objectKey}`,
    pathname,
    size: metadata.ContentLength ?? 0,
    contentType: metadata.ContentType ?? 'application/octet-stream',
    etag: metadata.ETag,
  };
}

export async function get(
  pathname: string,
  options: {
    access?: string;
    useCache?: boolean;
    range?: { start: number; end: number };
    expectedEtag?: string;
  } = {},
) {
  const location = await mediaLocation(pathname);
  if (!location || location.provider === 'blob') {
    const result = await blob.get(pathname, {
      access: 'private',
      useCache: options.useCache,
    });
    if (!result || result.statusCode !== 200) return null;
    return {
      statusCode: result.statusCode,
      stream: result.stream,
      blob: result.blob,
      ranged: false,
    };
  }
  if (!location.verifiedAt && options.range)
    throw new Error('Media chưa xác minh.');
  const result = await r2Read(location.objectKey, {
    range: options.range,
    etag: location.etag ?? undefined,
  });
  if (
    !result.Body ||
    !result.ETag ||
    (location.etag && result.ETag !== location.etag)
  )
    throw new Error('Media R2 đã thay đổi.');
  return {
    statusCode: 200,
    stream: result.Body.transformToWebStream(),
    ranged: Boolean(options.range),
    blob: {
      contentType: result.ContentType || location.contentType,
      size: location.size,
      etag: result.ETag,
    },
  };
}

export async function expectedMediaEtag(
  pathname: string,
  legacyEtag: string | null,
) {
  const location = await mediaLocation(pathname);
  return location?.provider === 'r2' ? location.etag : legacyEtag;
}

// This is only for just-created, unreferenced uploads, never shared article assets.
export async function del(url: string) {
  if (!url.startsWith('r2://')) return blob.del(url);
  const prefix = `r2://${r2Config().bucket}/`;
  if (!url.startsWith(prefix)) throw new Error('Bucket cleanup không hợp lệ.');
  const key = url.slice(prefix.length);
  const db = await database();
  const location = await mediaLocation(key);
  if (!location || location.provider !== 'r2' || location.objectKey !== key)
    throw new Error('Không xác định được upload cần dọn.');
  // Do not remove an object now shared by any committed revision.
  const { articleRevisions } = await import('@/db/schema');
  const references = await db
    .select({ id: articleRevisions.id })
    .from(articleRevisions)
    .where(eq(articleRevisions.coverImageStorageKey, key))
    .limit(1);
  if (references.length) return;
  await r2Delete(key);
  await db
    .delete(mediaStorageLocations)
    .where(eq(mediaStorageLocations.pathname, key));
}
