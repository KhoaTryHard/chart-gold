// Administrative migration tool. No article edits, approval writes or publication.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { list, get as blobGet, del as blobDel } from '@vercel/blob';
import { HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  r2Config,
  r2Client,
  r2Delete,
  r2PutVerified,
  r2Read,
  mediaSha256,
} from '../lib/editorial/r2';

const command = process.argv[2] || 'inventory';
const apply = process.argv.includes('--apply');
const local = process.argv.includes('--local');
const evidence = path.resolve('outputs/r2-migration-20261017');
fs.mkdirSync(evidence, { recursive: true });
const save = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2));
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function preflight() {
  const config = r2Config();
  const client = r2Client();
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  const objects = await client.send(
    new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 5 }),
  );
  let roundTrip = false,
    privateAccess = false;
  if (apply) {
    const key = `ops/probes/${randomUUID()}.bin`;
    await r2PutVerified(
      key,
      Buffer.from('chart-gold-r2-private-probe-v1'),
      'application/octet-stream',
    );
    try {
      const response = await fetch(
        `${config.endpoint}/${config.bucket}/${key}`,
        { redirect: 'error' },
      );
      privateAccess = [400, 401, 403].includes(response.status);
      if (!privateAccess)
        throw new Error('Anonymous R2 access unexpectedly succeeded.');
      roundTrip = true;
    } finally {
      await r2Delete(key);
    }
  }
  const report = {
    at: new Date().toISOString(),
    bucket: config.bucket,
    connected: true,
    credentialFingerprint: mediaSha256(Buffer.from(config.accessKeyId)),
    listed: objects.KeyCount,
    roundTrip,
    anonymousS3Denied: privateAccess,
  };
  save(`preflight-${config.bucket}.json`, report);
  console.log(JSON.stringify(report));
}

async function main() {
  if (command === 'preflight') return preflight();
  const connectionString = local
    ? 'postgresql://postgres@127.0.0.1:55432/editorial_test'
    : process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Database configuration missing.');
  if (!local && apply && !process.argv.includes('--production'))
    throw new Error('Specify --production for deployment database mutations.');
  const db = new Client({ connectionString });
  await db.connect();
  try {
    if (command === 'schema') {
      if (!apply) {
        console.log('Dry run: create independent media storage mapping table.');
        return;
      }
      await db.query('begin');
      await db.query(
        "select pg_advisory_xact_lock(hashtext('media-storage-migration'))",
      );
      const ddl = fs.readFileSync('drizzle/0018_media_storage.sql', 'utf8');
      await db.query(ddl);
      const journal = await db.query(
        "select to_regclass('drizzle.__drizzle_migrations') as name",
      );
      if (journal.rows[0].name)
        await db.query(
          'insert into drizzle.__drizzle_migrations(hash,created_at) select $1,$2 where not exists(select 1 from drizzle.__drizzle_migrations where created_at=$2)',
          [createHash('sha256').update(ddl).digest('hex'), 1792198800000],
        );
      await db.query('commit');
      console.log('Media mapping schema ready.');
      return;
    }
    const revisions = (
      await db.query(
        'select id,cover_image_storage_key,cover_image_url,cover_image_provider,cover_image_model,content_markdown from article_revisions order by id',
      )
    ).rows;
    const packages = (
      await db.query(
        'select id,review_package,review_digest,website_version,approval_provenance,receipt from editorial_integration_packages order by id',
      )
    ).rows;
    const videos = (
      await db.query(
        'select id,pathname,descriptor,descriptor_digest,blob_etag,status from editorial_video_assets order by id',
      )
    ).rows;
    const identities = {
      revisions: Object.fromEntries(
        revisions.map((row) => [row.id, hash(row)]),
      ),
      packages: Object.fromEntries(packages.map((row) => [row.id, hash(row)])),
      videos: Object.fromEntries(videos.map((row) => [row.id, hash(row)])),
    };
    const baseline = path.join(evidence, 'approval-identities.json');
    if (!fs.existsSync(baseline)) save('approval-identities.json', identities);
    const originals = JSON.parse(fs.readFileSync(baseline, 'utf8'));
    const identityChanged = Object.entries(identities).flatMap(([type, rows]) =>
      Object.entries(rows)
        .filter(
          ([id, value]) =>
            originals[type]?.[id] && originals[type][id] !== value,
        )
        .map(([id]) => `${type}:${id}`),
    );
    if (identityChanged.length)
      throw new Error(
        `Approval baseline changed (${identityChanged.length}); inspect before continuing.`,
      );
    if (command === 'identities') {
      console.log(
        JSON.stringify({
          preserved: true,
          revisions: revisions.length,
          packages: packages.length,
          videos: videos.length,
        }),
      );
      return;
    }

    const objects: {
      pathname: string;
      url: string;
      size: number;
      uploadedAt?: Date;
    }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 1000, cursor });
      objects.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const referenceKeys = new Set<string>([
      ...revisions.map((row) => row.cover_image_storage_key).filter(Boolean),
      ...videos.map((row) => row.pathname),
    ]);
    const uploading = new Set(
      videos
        .filter((row) => row.status === 'uploading')
        .map((row) => row.pathname),
    );
    const inventory = {
      at: new Date().toISOString(),
      bucket: r2Config().bucket,
      count: objects.length,
      bytes: objects.reduce((sum, object) => sum + object.size, 0),
      objects: objects.map((object) => ({
        ...object,
        referenced: referenceKeys.has(object.pathname),
        uploading: uploading.has(object.pathname),
      })),
      missingReferences: [...referenceKeys].filter(
        (key) => !objects.some((object) => object.pathname === key),
      ),
    };
    save('blob-inventory.json', inventory);
    if (command === 'inventory') {
      console.log(
        JSON.stringify({
          count: inventory.count,
          bytes: inventory.bytes,
          missingReferences: inventory.missingReferences.length,
          uploading: uploading.size,
        }),
      );
      return;
    }
    if (!['migrate', 'retire', 'rollback'].includes(command))
      throw new Error('Unknown media operation.');
    const results: Record<string, unknown>[] = [];
    for (const object of objects) {
      if (uploading.has(object.pathname)) {
        results.push({ pathname: object.pathname, state: 'in-flight' });
        continue;
      }
      if (!apply) {
        results.push({
          pathname: object.pathname,
          state: 'dry-run',
          operation: command,
        });
        continue;
      }
      try {
        const location = (
          await db.query(
            'select * from media_storage_locations where pathname=$1',
            [object.pathname],
          )
        ).rows[0];
        if (command === 'rollback') {
          if (location?.source_blob_url)
            await db.query(
              "update media_storage_locations set provider='blob',updated_at=now() where pathname=$1 and source_blob_url is not null",
              [object.pathname],
            );
          results.push({
            pathname: object.pathname,
            state: location?.source_blob_url ? 'blob-restored' : 'unchanged',
          });
          continue;
        }
        const source = await blobGet(object.pathname, {
          access: 'private',
          useCache: false,
        });
        if (!source || source.statusCode !== 200)
          throw new Error('Source unreadable.');
        const bytes = Buffer.from(
          await new Response(source.stream).arrayBuffer(),
        );
        if (bytes.length !== object.size)
          throw new Error('Source size mismatch.');
        const sha256 = mediaSha256(bytes);
        const video = videos.find((row) => row.pathname === object.pathname);
        if (
          video?.status === 'ready' &&
          (video.descriptor.sha256 !== sha256 ||
            video.blob_etag !== source.blob.etag)
        )
          throw new Error('Validated video source identity mismatch.');
        if (command === 'retire') {
          const eligible =
            location?.provider === 'r2' &&
            location.verified_at &&
            Date.now() - new Date(location.verified_at).getTime() >=
              30 * 86_400_000 &&
            location.sha256 === sha256 &&
            location.source_blob_etag === source.blob.etag;
          if (!eligible) {
            results.push({
              pathname: object.pathname,
              state: 'retained-rollback-window',
            });
            continue;
          }
          const remote = await r2Read(location.object_key, {
            etag: location.etag,
          });
          const recovered = await remote.Body?.transformToByteArray();
          if (!recovered || mediaSha256(recovered) !== sha256)
            throw new Error('Destination verification failed.');
          await blobDel(object.url);
          results.push({ pathname: object.pathname, state: 'retired', sha256 });
          continue;
        }
        const destination = await r2PutVerified(
          object.pathname,
          bytes,
          source.blob.contentType,
        );
        await db.query(
          `insert into media_storage_locations(pathname,provider,object_key,size,content_type,sha256,etag,source_blob_url,source_blob_etag,verified_at)
          values($1,'r2',$1,$2,$3,$4,$5,$6,$7,now())
          on conflict(pathname) do update set provider='r2',object_key=excluded.object_key,size=excluded.size,content_type=excluded.content_type,sha256=excluded.sha256,etag=excluded.etag,source_blob_url=excluded.source_blob_url,source_blob_etag=excluded.source_blob_etag,verified_at=coalesce(media_storage_locations.verified_at,excluded.verified_at),updated_at=now()`,
          [
            object.pathname,
            bytes.length,
            source.blob.contentType,
            sha256,
            destination.etag,
            object.url,
            source.blob.etag,
          ],
        );
        results.push({
          pathname: object.pathname,
          state: 'verified',
          bytes: bytes.length,
          sha256,
          referenced: referenceKeys.has(object.pathname),
        });
      } catch (error) {
        results.push({
          pathname: object.pathname,
          state: 'error',
          error: (error as { name?: string }).name || 'Error',
        });
      }
      save(`${command}-results.json`, results);
    }
    save(`${command}-results.json`, results);
    console.log(
      JSON.stringify({
        operation: command,
        apply,
        count: results.length,
        states: results.reduce<Record<string, number>>((counts, row) => {
          const state = String(row.state);
          counts[state] = (counts[state] || 0) + 1;
          return counts;
        }, {}),
        missingReferences: inventory.missingReferences.length,
        approvalIdentitiesPreserved: true,
      }),
    );
    if (
      results.some((result) => result.state === 'error') ||
      inventory.missingReferences.length
    )
      process.exitCode = 1;
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      operation: command,
      error: error.name,
      code: error.code || error.$metadata?.httpStatusCode || null,
    }),
  );
  process.exitCode = 1;
});
