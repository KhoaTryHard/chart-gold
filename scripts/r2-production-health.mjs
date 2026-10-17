// Read-only production verification: never approve, publish, comment, or generate.
import fs from 'node:fs';
import { Client } from 'pg';
import { createHash, createHmac } from 'node:crypto';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const db = new Client({
  connectionString:
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
});
const origin = 'https://www.vanghomnay.online';
const report = {
  at: new Date().toISOString(),
  pages: [],
  images: [],
  privateDraft: null,
  video: [],
  identityChanges: [],
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bridge = JSON.parse(
  fs.readFileSync('C:/Users/LENOVO/kim-tuyen-ai/bridge-secret.json', 'utf8'),
);
async function signed(path, body) {
  const raw = JSON.stringify(body),
    ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', bridge.secret)
    .update(['POST', path, ts, sha(Buffer.from(raw))].join('\n'))
    .digest('hex');
  return fetch(origin + path, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'x-editorial-client': 'kim-tuyen-newsroom',
      'x-editorial-timestamp': ts,
      'x-editorial-signature': signature,
    },
    body: raw,
    signal: AbortSignal.timeout(60000),
  });
}
await db.connect();
try {
  for (const path of ['/', '/nhip-vang']) {
    const r = await fetch(origin + path, {
      signal: AbortSignal.timeout(30000),
    });
    report.pages.push({ path, status: r.status });
    if (r.status !== 200) throw Error('Public page unavailable');
  }
  const published = (
    await db.query(`select a.slug,r.id,r.cover_image_storage_key as pathname,m.sha256,m.provider from articles a join article_revisions r on r.id=a.published_revision_id
    join media_storage_locations m on m.pathname=r.cover_image_storage_key where a.status='published'`)
  ).rows;
  for (const row of published) {
    const response = await fetch(
      `${origin}/api/editorial/media/${row.id}?r2-verify=${Date.now()}`,
      { signal: AbortSignal.timeout(30000) },
    );
    const digest =
      response.status === 200
        ? sha(Buffer.from(await response.arrayBuffer()))
        : null;
    const passed =
      response.status === 200 && row.provider === 'r2' && digest === row.sha256;
    report.images.push({
      revisionId: row.id,
      status: response.status,
      sha256: digest,
      provider: row.provider,
      passed,
    });
    if (!passed) throw Error('Published image verification failed');
  }
  const [draft] = (
    await db.query(
      `select r.id from article_revisions r join articles a on a.id=r.article_id where r.cover_image_storage_key is not null and (a.status<>'published' or a.published_revision_id is distinct from r.id) limit 1`,
    )
  ).rows;
  if (draft) {
    const response = await fetch(
      `${origin}/api/editorial/media/${draft.id}?r2-verify=${Date.now()}`,
    );
    report.privateDraft = {
      revisionId: draft.id,
      status: response.status,
      passed: [401, 403].includes(response.status),
    };
    if (!report.privateDraft.passed) throw Error('Draft privacy failed');
  }
  const videos = (
    await db.query('select id,status,descriptor from editorial_video_assets')
  ).rows;
  for (const asset of videos) {
    const pack = (
      await db.query(
        "select id from editorial_integration_packages where review_package::jsonb->'video'->>'assetId'=$1 and state='published' limit 1",
        [asset.id],
      )
    ).rows[0];
    const path = `/api/editorial/integrations/hermes/videos/${asset.id}/url`;
    const response = await signed(path, {
      packageId: pack?.id || '00000000-0000-4000-8000-000000000000',
    });
    if (!pack) {
      report.video.push({
        assetId: asset.id,
        publishedPackage: false,
        unapprovedUrlStatus: response.status,
        passed: response.status === 409,
      });
      if (response.status !== 409) throw Error('Video approval gate failed');
      continue;
    }
    if (response.status !== 200) throw Error('Published video URL unavailable');
    const grant = await response.json();
    const whole = await fetch(grant.url, {
      signal: AbortSignal.timeout(60000),
    });
    const bytes = Buffer.from(await whole.arrayBuffer());
    const head = await fetch(grant.url, { method: 'HEAD' });
    const ranged = await fetch(grant.url, {
      headers: { Range: 'bytes=10-99' },
    });
    const piece = Buffer.from(await ranged.arrayBuffer());
    const suffix = await fetch(grant.url, { headers: { Range: 'bytes=-10' } });
    const invalid = await fetch(grant.url, {
      headers: { Range: 'bytes=999999999-' },
    });
    const tampered = new URL(grant.url);
    tampered.searchParams.set('signature', '0'.repeat(64));
    const denied = await fetch(tampered);
    const passed =
      whole.status === 200 &&
      sha(bytes) === asset.descriptor.sha256 &&
      head.status === 200 &&
      ranged.status === 206 &&
      piece.equals(bytes.subarray(10, 100)) &&
      suffix.status === 206 &&
      invalid.status === 416 &&
      denied.status === 401;
    report.video.push({
      assetId: asset.id,
      publishedPackage: true,
      sha256: sha(bytes),
      head: head.status,
      range: ranged.status,
      suffix: suffix.status,
      invalid: invalid.status,
      tampered: denied.status,
      passed,
    });
    if (!passed) throw Error('Production video contract failed');
  }
  const before = JSON.parse(
    fs.readFileSync(
      'outputs/r2-migration-20261017/remote-identities-before.json',
      'utf8',
    ),
  );
  const revisions = (
    await db.query(
      'select id,title,excerpt,content_markdown,cover_image_storage_key,cover_image_url,cover_image_provider,cover_image_model,review_note from article_revisions',
    )
  ).rows;
  const packages = (
    await db.query(
      'select id,review_package,review_digest,website_version,approval_provenance,receipt from editorial_integration_packages',
    )
  ).rows;
  for (const row of revisions) {
    const digest = sha(
      Buffer.from(
        JSON.stringify([
          row.title,
          row.excerpt,
          row.content_markdown,
          row.cover_image_storage_key,
          row.cover_image_url,
          row.cover_image_provider,
          row.cover_image_model,
          row.review_note,
        ]),
      ),
    );
    if (before.revisions[row.id] && before.revisions[row.id] !== digest)
      report.identityChanges.push('revision:' + row.id);
  }
  for (const row of packages) {
    const digest = sha(
      Buffer.from(
        JSON.stringify([
          row.review_package,
          row.review_digest,
          row.website_version,
          row.approval_provenance,
          row.receipt,
        ]),
      ),
    );
    if (before.packages[row.id] && before.packages[row.id] !== digest)
      report.identityChanges.push('package:' + row.id);
  }
  if (report.identityChanges.length)
    throw Error('Existing approval identity changed');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await db.end();
  fs.writeFileSync(
    'outputs/r2-migration-20261017/production-health.json',
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      pages: report.pages.length,
      images: report.images.length,
      draftPrivacy: report.privateDraft,
      video: report.video,
      identityChanges: report.identityChanges,
      error: report.error,
    }),
  );
}
