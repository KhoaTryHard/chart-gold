// Exercise the real bot uploader with a private, temporary production object.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  r2Config,
  r2Delete,
  r2Read,
  r2UploadGrant,
  mediaSha256,
} from '../lib/editorial/r2';
if (r2Config().bucket !== 'chart-gold-media-prod')
  throw new Error('Production bucket required');
const folder = 'C:/Users/LENOVO/kim-tuyen-ai/assets/video';
function find(dir: string): string | undefined {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const candidate = dir + '/' + item.name;
    if (item.isDirectory()) {
      const nested = find(candidate);
      if (nested) return nested;
    } else if (candidate.endsWith('.mp4')) return candidate;
  }
}
const file = find(folder);
if (!file) throw new Error('Existing MP4 fixture missing');
const bytes = fs.readFileSync(file),
  key = `ops/probes/${randomUUID()}.mp4`;
const grant = await r2UploadGrant(key, bytes.length);
const input = JSON.stringify({
  path: file,
  pathname: key,
  bytes: bytes.length,
  sha256: mediaSha256(bytes),
  upload: grant,
});
try {
  const call = () =>
    spawnSync(
      process.execPath,
      ['C:/Users/LENOVO/kim-tuyen-ai/video_upload.mjs'],
      { input, encoding: 'utf8', timeout: 180000, windowsHide: true },
    );
  const uploaded = call();
  assert.equal(uploaded.status, 0, 'Bot upload failed');
  assert.equal(JSON.parse(uploaded.stdout).success, true);
  const remote = await r2Read(key);
  const recovered = await remote.Body?.transformToByteArray();
  assert(recovered);
  assert.equal(mediaSha256(recovered), mediaSha256(bytes));
  const duplicate = call();
  assert.notEqual(duplicate.status, 0);
  assert.equal(JSON.parse(duplicate.stdout).success, false);
  const url = new URL(grant.url);
  const report = {
    passed: true,
    bucket: r2Config().bucket,
    bytes: bytes.length,
    sha256: mediaSha256(bytes),
    hostStyle: url.hostname.startsWith('chart-gold-media-prod.')
      ? 'virtual'
      : 'path',
    immutableReplayRejected: true,
    publicationCalls: 0,
  };
  fs.writeFileSync(
    'outputs/r2-migration-20261017/bot-production-upload-acceptance.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await r2Delete(key);
}
