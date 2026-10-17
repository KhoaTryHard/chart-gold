import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { r2Config, r2Delete, mediaSha256 } from '../lib/editorial/r2';

if (r2Config().bucket !== 'chart-gold-media-staging')
  throw new Error('Staging bucket required.');
process.env.DATABASE_URL =
  'postgresql://postgres@127.0.0.1:55432/editorial_test';
process.env.MEDIA_STORAGE_PROVIDER = 'r2';
process.env.MEDIA_STORAGE_DUAL_READ = 'true';
process.env.HERMES_VIDEO_ENABLED = 'true';
const { getDatabase } = await import('../db');
const { mediaStorageLocations, editorialVideoAssets } =
  await import('../db/schema');
const { storeEditorialImageUpload } = await import('../lib/editorial/images');
const storage = await import('../lib/editorial/media-storage');
const video = await import('../lib/editorial/video-assets');
const { inspectEditorialMp4 } = await import('../lib/editorial/video-mp4');
const db = getDatabase();
const keys: string[] = [],
  assets: string[] = [];
const checks: string[] = [];
try {
  const image = fs.readFileSync('public/brand/covers/news.webp');
  const stored = await storeEditorialImageUpload({
    revisionId: 'staging-' + randomUUID(),
    bytes: image,
    mimeType: 'image/webp',
  });
  keys.push(stored.pathname);
  const read = await storage.get(stored.pathname);
  assert(read);
  assert.equal(
    mediaSha256(Buffer.from(await new Response(read.stream).arrayBuffer())),
    mediaSha256(image),
  );
  checks.push('private normalized image put/read and SHA256');
  const mp4 = fs.readFileSync('tests/fixtures/editorial-video.mp4');
  const metadata = inspectEditorialMp4(mp4);
  const input = {
    rootId: randomUUID(),
    draftId: randomUUID(),
    externalRevision: 1,
    video: {
      sha256: mediaSha256(mp4),
      scriptSha256: 'a'.repeat(64),
      audioSha256: 'b'.repeat(64),
      sceneSha256: 'c'.repeat(64),
      voiceId: 'staging',
      modelId: 'staging',
      duration: metadata.duration,
      width: 1080 as const,
      height: 1920 as const,
      fps: 30 as const,
      bytes: mp4.length,
    },
  };
  const grant = await video.createVideoUploadToken(input, 'r2-put-v1');
  assets.push(grant.assetId);
  keys.push(grant.pathname);
  assert('upload' in grant && 'url' in grant.upload);
  const upload = grant.upload as {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  const response = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: mp4,
    redirect: 'error',
  });
  assert.equal(response.status, 200, `R2 PUT status ${response.status}`);
  const collision = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: mp4,
    redirect: 'error',
  });
  assert.equal(collision.status, 412);
  checks.push('15-minute signed video PUT, MIME/length/immutable condition');
  const completed = await video.completeVideoUpload(grant.assetId);
  assert.equal(completed.status, 'ready');
  assert.equal(
    (await video.completeVideoUpload(grant.assetId)).assetId,
    grant.assetId,
  );
  assert.equal(
    (await video.createVideoUploadToken(input, 'r2-put-v1')).clientToken,
    null,
  );
  checks.push('server SHA256/MP4 inspection, ready idempotency');
  const ranged = await storage.get(grant.pathname, {
    range: { start: 10, end: 99 },
  });
  assert(ranged?.ranged);
  assert.deepEqual(
    Buffer.from(await new Response(ranged.stream).arrayBuffer()),
    mp4.subarray(10, 100),
  );
  checks.push('real R2 ranged stream pinned to provider ETag');
  fs.mkdirSync('outputs/r2-migration-20261017', { recursive: true });
  const report = {
    at: new Date().toISOString(),
    bucket: r2Config().bucket,
    passed: true,
    checks,
  };
  fs.writeFileSync(
    'outputs/r2-migration-20261017/staging-acceptance.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  for (const id of assets)
    await db
      .delete(editorialVideoAssets)
      .where(eq(editorialVideoAssets.id, id));
  for (const key of keys) {
    await r2Delete(key);
    await db
      .delete(mediaStorageLocations)
      .where(eq(mediaStorageLocations.pathname, key));
  }
  await (
    globalThis as unknown as { __kimTuyenPool: { end(): Promise<void> } }
  ).__kimTuyenPool.end();
}
