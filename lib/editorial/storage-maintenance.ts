import 'server-only';
import { randomUUID } from 'node:crypto';
import { eq, and, lt, isNotNull } from 'drizzle-orm';
import { get as blobGet, list, del as blobDelete } from '@vercel/blob';
import { z } from 'zod';
import { getDatabase } from '@/db';
import {
  articleRevisions,
  editorialIntegrationPackages,
  editorialVideoAssets,
  mediaStorageLocations,
} from '@/db/schema';
import { IntegrationError } from './integration-auth';
import {
  r2Config,
  r2Delete,
  r2Head,
  r2PutVerified,
  r2Read,
  mediaSha256,
} from './r2';

const schema = z
  .object({
    operation: z.enum([
      'probe',
      'inventory',
      'identities',
      'copy',
      'verify',
      'retire',
      'status',
    ]),
    pathname: z.string().min(1).max(1024).optional(),
  })
  .strict();
async function readBytes(stream: ReadableStream<Uint8Array>, max: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new IntegrationError('Media vượt kích thước đăng ký.', 409);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function canRetireBlob(
  location: {
    provider: string;
    verifiedAt: Date | null;
    sourceBlobUrl: string | null;
    sha256: string | null;
    etag: string | null;
  },
  now = Date.now(),
) {
  return (
    location.provider === 'r2' &&
    Boolean(
      location.sourceBlobUrl &&
      location.sha256 &&
      location.etag &&
      location.verifiedAt &&
      now - location.verifiedAt.getTime() >= 30 * 86_400_000,
    )
  );
}

export async function storageMaintenance(value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new IntegrationError('Yêu cầu chuyển kho không hợp lệ.');
  const { operation, pathname } = parsed.data;
  if (operation === 'status') {
    const config = r2Config();
    return {
      provider: process.env.MEDIA_STORAGE_PROVIDER || 'blob',
      dualRead: process.env.MEDIA_STORAGE_DUAL_READ === 'true',
      migrationEnabled: process.env.HERMES_STORAGE_MIGRATION_ENABLED === 'true',
      retireBlob: process.env.MEDIA_STORAGE_RETIRE_BLOB === 'true',
      bucket: config.bucket,
      credentialFingerprint: mediaSha256(Buffer.from(config.accessKeyId)),
    };
  }
  if (operation === 'retire') {
    if (
      process.env.MEDIA_STORAGE_RETIRE_BLOB !== 'true' ||
      process.env.MEDIA_STORAGE_PROVIDER !== 'r2'
    )
      throw new IntegrationError('Chưa bật dọn bản Blob cũ.', 503);
    const db = getDatabase();
    const candidates = await db
      .select()
      .from(mediaStorageLocations)
      .where(
        and(
          eq(mediaStorageLocations.provider, 'r2'),
          isNotNull(mediaStorageLocations.sourceBlobUrl),
          lt(
            mediaStorageLocations.verifiedAt,
            new Date(Date.now() - 30 * 86_400_000),
          ),
        ),
      )
      .limit(16);
    const retired: string[] = [];
    for (const location of candidates) {
      if (!canRetireBlob(location)) continue;
      const [video] = await db
        .select()
        .from(editorialVideoAssets)
        .where(eq(editorialVideoAssets.pathname, location.pathname))
        .limit(1);
      if (video?.status === 'uploading') continue;
      const remote = await r2Read(location.objectKey, { etag: location.etag! });
      if (!remote.Body)
        throw new Error('Cloud copy unavailable; Blob retained.');
      const bytes = await readBytes(
        remote.Body.transformToWebStream(),
        location.size,
      );
      if (
        bytes.length !== location.size ||
        mediaSha256(bytes) !== location.sha256
      )
        throw new Error('Cloud checksum mismatch; Blob retained.');
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(mediaStorageLocations)
          .where(eq(mediaStorageLocations.pathname, location.pathname))
          .for('update');
        // A rollback or another maintenance process may have changed this row
        // while bytes were verified. The lock serializes deletion with rollback.
        if (
          !current ||
          !canRetireBlob(current) ||
          current.sourceBlobUrl !== location.sourceBlobUrl ||
          current.etag !== location.etag ||
          current.sha256 !== location.sha256
        )
          return;
        let original;
        try {
          original = await blobGet(current.pathname, {
            access: 'private',
            useCache: false,
          });
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'BlobNotFoundError')
            throw error;
        }
        if (original && original.statusCode === 200) {
          await original.stream.cancel();
          if (original.blob.etag !== current.sourceBlobEtag)
            throw new Error('Blob source changed; reconcile manually.');
          await blobDelete(current.sourceBlobUrl!);
        }
        await tx
          .update(mediaStorageLocations)
          .set({ sourceBlobUrl: null, updatedAt: new Date() })
          .where(eq(mediaStorageLocations.pathname, current.pathname));
        retired.push(current.pathname);
      });
    }
    return { retired, checked: candidates.length, retentionDays: 30 };
  }
  if (process.env.HERMES_STORAGE_MIGRATION_ENABLED !== 'true')
    throw new IntegrationError('Công cụ chuyển kho chưa bật.', 503);
  const config = r2Config();
  if (operation === 'probe') {
    const key = `ops/probes/${randomUUID()}.bin`;
    const bytes = Buffer.from('chart-gold-r2-private-probe-v1');
    const result = await r2PutVerified(key, bytes, 'application/octet-stream');
    try {
      const head = await r2Head(key);
      const response = await fetch(
        `${config.endpoint}/${config.bucket}/${key}`,
        { redirect: 'error', cache: 'no-store' },
      );
      if (![400, 401, 403].includes(response.status))
        throw new Error('Anonymous S3 request unexpectedly succeeded.');
      return {
        bucket: config.bucket,
        verified: true,
        sha256: result.sha256,
        storageClass: head.StorageClass || 'STANDARD',
        anonymousS3Status: response.status,
      };
    } finally {
      await r2Delete(key);
    }
  }
  const db = getDatabase();
  if (operation === 'identities') {
    const revisions = await db.select().from(articleRevisions);
    const packages = await db.select().from(editorialIntegrationPackages);
    const videos = await db.select().from(editorialVideoAssets);
    return {
      revisions: Object.fromEntries(
        revisions.map((row) => [
          row.id,
          mediaSha256(
            Buffer.from(
              JSON.stringify([
                row.title,
                row.excerpt,
                row.contentMarkdown,
                row.coverImageStorageKey,
                row.coverImageUrl,
                row.coverImageProvider,
                row.coverImageModel,
                row.reviewNote,
              ]),
            ),
          ),
        ]),
      ),
      packages: Object.fromEntries(
        packages.map((row) => [
          row.id,
          mediaSha256(
            Buffer.from(
              JSON.stringify([
                row.reviewPackage,
                row.reviewDigest,
                row.websiteVersion,
                row.approvalProvenance,
                row.receipt,
              ]),
            ),
          ),
        ]),
      ),
      videos: Object.fromEntries(
        videos.map((row) => [
          row.id,
          mediaSha256(
            Buffer.from(
              JSON.stringify([
                row.descriptor,
                row.descriptorDigest,
                row.blobEtag,
                row.status,
              ]),
            ),
          ),
        ]),
      ),
    };
  }
  if (operation === 'inventory') {
    const objects: { pathname: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 1000, cursor });
      objects.push(
        ...page.blobs.map((item) => ({
          pathname: item.pathname,
          size: item.size,
        })),
      );
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const revisions = await db
      .select({
        id: articleRevisions.id,
        key: articleRevisions.coverImageStorageKey,
        url: articleRevisions.coverImageUrl,
      })
      .from(articleRevisions);
    const videos = await db
      .select({
        id: editorialVideoAssets.id,
        key: editorialVideoAssets.pathname,
        status: editorialVideoAssets.status,
      })
      .from(editorialVideoAssets);
    const locations = await db.select().from(mediaStorageLocations);
    const references = [
      ...new Set(
        [
          ...revisions.map((row) => row.key),
          ...videos.map((row) => row.key),
        ].filter((key): key is string => Boolean(key)),
      ),
    ];
    return {
      bucket: config.bucket,
      objects,
      locations,
      references,
      videos,
      missingReferences: references.filter(
        (key) =>
          !objects.some((object) => object.pathname === key) &&
          !locations.some(
            (location) => location.pathname === key && location.verifiedAt,
          ),
      ),
      publicImages: revisions
        .filter((row) => row.key)
        .map((row) => ({
          revisionId: row.id,
          pathname: row.key,
          url: row.url,
        })),
    };
  }
  if (!pathname?.startsWith('editorial/'))
    throw new IntegrationError('Chỉ chuyển media biên tập.');
  const [video] = await db
    .select()
    .from(editorialVideoAssets)
    .where(eq(editorialVideoAssets.pathname, pathname))
    .limit(1);
  if (video?.status === 'uploading') return { pathname, state: 'in-flight' };
  const [location] = await db
    .select()
    .from(mediaStorageLocations)
    .where(eq(mediaStorageLocations.pathname, pathname))
    .limit(1);
  if (operation === 'verify') {
    if (
      location?.provider !== 'r2' ||
      !location.verifiedAt ||
      !location.sha256 ||
      !location.etag
    )
      throw new IntegrationError('Chưa có bản R2 đã xác minh.', 409);
    const remote = await r2Read(location.objectKey, { etag: location.etag });
    if (!remote.Body) throw new Error('R2 media unreadable.');
    const bytes = await readBytes(
      remote.Body.transformToWebStream(),
      location.size,
    );
    if (
      bytes.length !== location.size ||
      mediaSha256(bytes) !== location.sha256
    )
      throw new Error('R2 media verification failed.');
    return {
      pathname,
      state: 'verified',
      sha256: location.sha256,
      bytes: bytes.length,
    };
  }
  const source = await blobGet(pathname, {
    access: 'private',
    useCache: false,
  });
  if (
    !source ||
    source.statusCode !== 200 ||
    source.blob.size > 256 * 1024 * 1024
  )
    throw new IntegrationError(
      'Không đọc được media nguồn trong giới hạn.',
      409,
    );
  const bytes = await readBytes(source.stream, source.blob.size);
  const sha256 = mediaSha256(bytes);
  if (
    bytes.length !== source.blob.size ||
    (location?.sha256 && location.sha256 !== sha256)
  )
    throw new IntegrationError('File nguồn khác bản đã ghi nhận.', 409);
  if (video?.status === 'ready') {
    const descriptor = video.descriptor as { sha256?: string };
    if (descriptor.sha256 !== sha256 || video.blobEtag !== source.blob.etag)
      throw new IntegrationError('Video nguồn khác bản đã duyệt.', 409);
  }
  const result = await r2PutVerified(pathname, bytes, source.blob.contentType);
  await db
    .insert(mediaStorageLocations)
    .values({
      pathname,
      objectKey: pathname,
      provider: 'r2',
      size: bytes.length,
      contentType: source.blob.contentType,
      sha256,
      etag: result.etag,
      sourceBlobUrl: source.blob.url,
      sourceBlobEtag: source.blob.etag,
      verifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: mediaStorageLocations.pathname,
      set: {
        provider: 'r2',
        sha256,
        etag: result.etag,
        sourceBlobUrl: source.blob.url,
        sourceBlobEtag: source.blob.etag,
        verifiedAt: location?.verifiedAt || new Date(),
        updatedAt: new Date(),
      },
    });
  return { pathname, state: 'verified', sha256, bytes: bytes.length };
}
