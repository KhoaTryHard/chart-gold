import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { get, head } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '@/db';
import {
  articles,
  editorialIntegrationPackages,
  editorialVideoAssets,
} from '@/db/schema';
import { siteUrl } from '@/lib/seo';
import {
  IntegrationError,
  integrationClient,
  sha256,
} from './integration-auth';
import { inspectEditorialMp4, MAX_VIDEO_BYTES } from './video-mp4';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const externalId = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);
export const videoDescriptorSchema = z
  .object({
    sha256: digest,
    scriptSha256: digest,
    audioSha256: digest,
    sceneSha256: digest,
    voiceId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
    modelId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
    duration: z.number().min(60).max(90),
    width: z.literal(1080),
    height: z.literal(1920),
    fps: z.literal(30),
    bytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
  })
  .strict();
export const readyVideoDescriptorSchema = videoDescriptorSchema.extend({
  assetId: z.uuid(),
});
export type VideoDescriptor = z.infer<typeof videoDescriptorSchema>;
export type ReadyVideoDescriptor = z.infer<typeof readyVideoDescriptorSchema>;
const uploadSchema = z
  .object({
    rootId: externalId,
    draftId: externalId,
    externalRevision: z.number().int().min(1),
    video: videoDescriptorSchema,
  })
  .strict();

export function requireHermesVideo() {
  if (process.env.HERMES_VIDEO_ENABLED !== 'true')
    throw new IntegrationError('Tạo video chưa bật.', 503);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new IntegrationError('Metadata video không hợp lệ.');
  return result.data;
}
async function findAsset(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new IntegrationError('Mã video không hợp lệ.');
  const [asset] = await getDatabase()
    .select()
    .from(editorialVideoAssets)
    .where(
      and(
        eq(editorialVideoAssets.id, id),
        eq(editorialVideoAssets.clientId, integrationClient),
      ),
    )
    .limit(1);
  if (!asset) throw new IntegrationError('Không tìm thấy video.', 404);
  return asset;
}
type Asset = Awaited<ReturnType<typeof findAsset>>;
function assetResponse(asset: Asset) {
  return {
    assetId: asset.id,
    status: asset.status,
    video: {
      ...parse(videoDescriptorSchema, asset.descriptor),
      assetId: asset.id,
    },
  };
}

export async function createVideoUploadToken(value: unknown) {
  requireHermesVideo();
  const input = parse(uploadSchema, value);
  const descriptorDigest = sha256(JSON.stringify(input));
  const asset = await getDatabase().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${'hermes:video:' + input.draftId}))`,
    );
    const [existing] = await tx
      .select()
      .from(editorialVideoAssets)
      .where(
        and(
          eq(editorialVideoAssets.clientId, integrationClient),
          eq(editorialVideoAssets.draftId, input.draftId),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.descriptorDigest !== descriptorDigest ||
        existing.status === 'rejected'
      )
        throw new IntegrationError(
          'Mã video đã có nội dung khác hoặc bị từ chối; tạo phiên bản mới.',
          409,
        );
      return existing;
    }
    const id = randomUUID();
    const [created] = await tx
      .insert(editorialVideoAssets)
      .values({
        id,
        clientId: integrationClient,
        rootId: input.rootId,
        draftId: input.draftId,
        externalRevision: input.externalRevision,
        descriptor: input.video,
        descriptorDigest,
        pathname: `editorial/videos/${id}/${input.video.sha256}.mp4`,
      })
      .returning();
    return created;
  });
  if (asset.status === 'ready')
    return {
      ...assetResponse(asset),
      pathname: asset.pathname,
      clientToken: null,
      validUntil: null,
    };
  const validUntil = Date.now() + 15 * 60_000;
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname: asset.pathname,
    allowedContentTypes: ['video/mp4'],
    maximumSizeInBytes: input.video.bytes,
    validUntil,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
  });
  return {
    ...assetResponse(asset),
    pathname: asset.pathname,
    clientToken,
    validUntil,
    upload: {
      access: 'private' as const,
      contentType: 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: false,
      multipart: true,
    },
  };
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new IntegrationError('Video vượt kích thước đã đăng ký.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function completeVideoUpload(id: string) {
  requireHermesVideo();
  const asset = await findAsset(id);
  if (asset.status === 'ready') return assetResponse(asset);
  if (asset.status !== 'uploading')
    throw new IntegrationError('Video bị từ chối; cần phiên bản mới.', 409);
  const descriptor = parse(videoDescriptorSchema, asset.descriptor);
  // Do not accept a URL supplied by the client: only the scoped registered pathname.
  const metadata = await head(asset.pathname);
  try {
    if (
      metadata.contentType !== 'video/mp4' ||
      metadata.size !== descriptor.bytes ||
      metadata.size > MAX_VIDEO_BYTES
    )
      throw new IntegrationError('File tải lên khác metadata đã đăng ký.');
    const file = await get(asset.pathname, {
      access: 'private',
      useCache: false,
    });
    if (
      !file ||
      file.statusCode !== 200 ||
      !file.blob.etag ||
      file.blob.size !== descriptor.bytes
    )
      throw new IntegrationError('Chưa đọc được video.', 503);
    const bytes = await readBounded(file.stream, descriptor.bytes);
    if (
      bytes.length !== descriptor.bytes ||
      sha256(bytes) !== descriptor.sha256
    )
      throw new IntegrationError('Checksum video không khớp.');
    const inspected = inspectEditorialMp4(bytes);
    if (Math.abs(inspected.duration - descriptor.duration) > 0.1)
      throw new IntegrationError('Thời lượng video khác metadata đã đăng ký.');
    const [updated] = await getDatabase()
      .update(editorialVideoAssets)
      .set({
        status: 'ready',
        blobUrl: metadata.url,
        // Store the HTTP read ETag, avoiding control-API quoting differences.
        blobEtag: file.blob.etag,
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(editorialVideoAssets.id, id),
          eq(editorialVideoAssets.status, 'uploading'),
        ),
      )
      .returning();
    return assetResponse(updated ?? (await findAsset(id)));
  } catch (error) {
    if (error instanceof IntegrationError && error.status === 400)
      await getDatabase()
        .update(editorialVideoAssets)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(
          and(
            eq(editorialVideoAssets.id, id),
            eq(editorialVideoAssets.status, 'uploading'),
          ),
        );
    throw error;
  }
}

/** Bind the validated immutable asset to exactly this external revision. */
export async function assertReadyVideo(
  video: ReadyVideoDescriptor,
  binding: { rootId: string; draftId: string; externalRevision: number },
) {
  requireHermesVideo();
  const asset = await findAsset(video.assetId);
  const { assetId: _assetId, ...descriptor } = video;
  if (
    asset.status !== 'ready' ||
    !asset.validatedAt ||
    !asset.blobEtag ||
    asset.rootId !== binding.rootId ||
    asset.draftId !== binding.draftId ||
    asset.externalRevision !== binding.externalRevision ||
    JSON.stringify(parse(videoDescriptorSchema, asset.descriptor)) !==
      JSON.stringify(videoDescriptorSchema.parse(descriptor))
  )
    throw new IntegrationError(
      'Video chưa xác minh hoặc không thuộc phiên bản bài này.',
      409,
    );
}

async function assertPublishedAsset(asset: Asset, packageId: string) {
  if (!z.uuid().safeParse(packageId).success)
    throw new IntegrationError('Mã gói không hợp lệ.');
  const [row] = await getDatabase()
    .select({ pack: editorialIntegrationPackages, article: articles })
    .from(editorialIntegrationPackages)
    .innerJoin(
      articles,
      eq(articles.id, editorialIntegrationPackages.articleId),
    )
    .where(
      and(
        eq(editorialIntegrationPackages.id, packageId),
        eq(editorialIntegrationPackages.clientId, integrationClient),
      ),
    )
    .limit(1);
  const pack = row?.pack;
  const canonical = pack
    ? (JSON.parse(pack.reviewPackage) as {
        schemaVersion?: number;
        facebookMode?: string;
        video?: unknown;
      })
    : null;
  const video = readyVideoDescriptorSchema.safeParse(canonical?.video);
  if (
    !row ||
    pack?.state !== 'published' ||
    !pack.approvalProvenance ||
    pack.reviewDigest !== sha256(pack.reviewPackage) ||
    row.article.status !== 'published' ||
    row.article.publishedRevisionId !== pack.revisionId ||
    canonical?.schemaVersion !== 3 ||
    canonical.facebookMode !== 'video' ||
    !video.success ||
    video.data.assetId !== asset.id
  )
    throw new IntegrationError(
      'Video chưa có bản duyệt đã xuất bản còn hiệu lực.',
      409,
    );
  await assertReadyVideo(video.data, {
    rootId: pack.rootId,
    draftId: pack.draftId,
    externalRevision: pack.externalRevision,
  });
}
function signingKeys() {
  return [
    process.env.HERMES_EDITORIAL_SECRET,
    process.env.HERMES_EDITORIAL_NEXT_SECRET,
  ].filter((key): key is string => Boolean(key && key.length >= 32));
}
export function videoMediaSignature(
  key: string,
  assetId: string,
  packageId: string,
  expires: string,
) {
  return createHmac('sha256', key)
    .update(
      [
        'hermes-video-media-v1',
        integrationClient,
        assetId,
        packageId,
        expires,
      ].join('\n'),
    )
    .digest('hex');
}

export async function issueVideoMediaUrl(assetId: string, value: unknown) {
  requireHermesVideo();
  const { packageId } = parse(
    z.object({ packageId: z.uuid() }).strict(),
    value,
  );
  const asset = await findAsset(assetId);
  await assertPublishedAsset(asset, packageId);
  const key = signingKeys()[0];
  if (!key) throw new IntegrationError('Khóa ký video chưa cấu hình.', 503);
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const url = new URL(
    `/api/editorial/integrations/hermes/videos/${assetId}/media`,
    siteUrl,
  );
  url.searchParams.set('packageId', packageId);
  url.searchParams.set('expires', expires);
  url.searchParams.set(
    'signature',
    videoMediaSignature(key, assetId, packageId, expires),
  );
  return {
    assetId,
    url: url.href,
    expiresAt: new Date(Number(expires) * 1000).toISOString(),
  };
}

export function parseVideoRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]))
    throw new IntegrationError('Range không hợp lệ.', 416);
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      throw new IntegrationError('Range không hợp lệ.', 416);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= size ||
      end < start
    )
      throw new IntegrationError('Range không hợp lệ.', 416);
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function sliceStream(
  source: ReadableStream<Uint8Array>,
  start: number,
  end: number,
) {
  const reader = source.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) {
            controller.error(new Error('Video stream ended early.'));
            reader.releaseLock();
            return;
          }
          const nextOffset = offset + next.value.length;
          const from = Math.max(0, start - offset),
            to = Math.min(next.value.length, end + 1 - offset);
          offset = nextOffset;
          if (from < to) controller.enqueue(next.value.subarray(from, to));
          if (offset > end) {
            await reader.cancel();
            reader.releaseLock();
            controller.close();
            return;
          }
          if (from < to) return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await reader.cancel();
      reader.releaseLock();
    },
  });
}

export async function serveVideoMedia(request: Request, assetId: string) {
  requireHermesVideo();
  if (process.env.HERMES_EDITORIAL_ENABLED !== 'true')
    throw new IntegrationError('Tích hợp chưa bật.', 503);
  const url = new URL(request.url),
    params = url.searchParams;
  const packageId = params.get('packageId') ?? '',
    expires = params.get('expires') ?? '',
    signature = params.get('signature') ?? '';
  const now = Date.now() / 1000;
  if (
    [...params.keys()].length !== 3 ||
    !z.uuid().safeParse(assetId).success ||
    !z.uuid().safeParse(packageId).success ||
    !/^\d{10}$/.test(expires) ||
    Number(expires) < now ||
    Number(expires) > now + 6 * 3600 ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !signingKeys().some((key) =>
      timingSafeEqual(
        Buffer.from(
          videoMediaSignature(key, assetId, packageId, expires),
          'hex',
        ),
        Buffer.from(signature, 'hex'),
      ),
    )
  )
    throw new IntegrationError(
      'Liên kết video không hợp lệ hoặc đã hết hạn.',
      401,
    );
  const asset = await findAsset(assetId);
  await assertPublishedAsset(asset, packageId);
  const descriptor = parse(videoDescriptorSchema, asset.descriptor);
  const range = parseVideoRange(request.headers.get('range'), descriptor.bytes);
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Content-Length': String(
      range ? range.end - range.start + 1 : descriptor.bytes,
    ),
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'X-Video-Sha256': descriptor.sha256,
    'Content-Disposition': 'inline; filename="kim-tuyen.mp4"',
  });
  if (range)
    headers.set(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${descriptor.bytes}`,
    );
  if (request.method === 'HEAD')
    return new Response(null, { status: range ? 206 : 200, headers });
  const file = await get(asset.pathname, {
    access: 'private',
    useCache: false,
  });
  if (
    !file ||
    file.statusCode !== 200 ||
    file.blob.etag !== asset.blobEtag ||
    file.blob.size !== descriptor.bytes
  )
    throw new IntegrationError(
      'Asset video đã thay đổi hoặc chưa đọc được.',
      503,
    );
  return new Response(
    range ? sliceStream(file.stream, range.start, range.end) : file.stream,
    { status: range ? 206 : 200, headers },
  );
}
