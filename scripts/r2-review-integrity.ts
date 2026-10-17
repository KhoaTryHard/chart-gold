import fs from 'node:fs';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { revisionVersion } from '../lib/editorial/review';
import { videoDescriptorSchema } from '../lib/editorial/video-assets';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const db = new Client({
  connectionString:
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
});
await db.connect();
try {
  const packages = (
    await db.query('select * from editorial_integration_packages')
  ).rows;
  const revisions = (await db.query('select * from article_revisions')).rows;
  const camel = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_m, char: string) => char.toUpperCase()),
        value,
      ]),
    );
  const failures: string[] = [];
  for (const pack of packages) {
    const revision = revisions.find((row) => row.id === pack.revision_id);
    if (
      !revision ||
      revisionVersion(
        camel(revision) as unknown as Parameters<typeof revisionVersion>[0],
      ) !== pack.website_version ||
      sha(pack.review_package) !== pack.review_digest
    )
      failures.push(pack.id);
  }
  const videos = (await db.query('select * from editorial_video_assets')).rows;
  for (const video of videos) {
    const canonical = {
      rootId: video.root_id,
      draftId: video.draft_id,
      externalRevision: video.external_revision,
      video: videoDescriptorSchema.parse(video.descriptor),
    };
    if (sha(JSON.stringify(canonical)) !== video.descriptor_digest)
      failures.push(video.id);
  }
  const report = {
    passed: failures.length === 0,
    packages: packages.length,
    videoDescriptors: videos.length,
    failures,
    fullRevisionVersionChecked: true,
  };
  fs.writeFileSync(
    'outputs/r2-migration-20261017/full-review-integrity.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await db.end();
}
