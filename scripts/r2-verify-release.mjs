import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const evidence = 'outputs/r2-migration-20261017';
const project = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8'));
const auth = JSON.parse(
  fs.readFileSync(
    path.join(process.env.APPDATA, 'com.vercel.cli/Data/auth.json'),
    'utf8',
  ),
);
async function get(route) {
  const r = await fetch(
    `https://api.vercel.com${route}${route.includes('?') ? '&' : '?'}teamId=${project.orgId}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  if (!r.ok) throw Error(`Release inspection HTTP ${r.status}`);
  return r;
}
const alias = await (await get('/v4/aliases/www.vanghomnay.online')).json();
const deployment = await (
  await get(`/v13/deployments/${alias.deployment.id}`)
).json();
const tree = await (await get(`/v6/deployments/${deployment.id}/files`)).json();
const source = tree.find((row) => row.name === 'src');
if (!source) throw Error('Production source not available');
const files = new Map();
function walk(rows, prefix = '') {
  for (const row of rows) {
    const name = prefix + row.name;
    if (row.type === 'directory') walk(row.children || [], name + '/');
    else files.set(name, row.uid);
  }
}
walk(source.children || []);
const manifest = JSON.parse(
  fs.readFileSync(path.join(evidence, 'release-package.json'), 'utf8'),
);
const hashes = {};
const changed = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const file of manifest.changes) {
  const uid = files.get(file);
  if (!uid) throw Error('Missing deployed source: ' + file);
  const response = await get(`/v7/deployments/${deployment.id}/files/${uid}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if ((response.headers.get('content-type') || '').includes('json')) {
    const body = JSON.parse(bytes.toString());
    if (!body.data) throw Error('Unknown source response');
    bytes = Buffer.from(body.data, 'base64');
  }
  hashes[file] = hash(bytes);
  if (hashes[file] !== hash(fs.readFileSync(file))) changed.push(file);
}
for (const file of [
  'app/globals.css',
  'app/nhip-vang/[slug]/page.tsx',
  'components/editorial/editorial-cover.tsx',
]) {
  const uid = files.get(file);
  const response = await get(`/v7/deployments/${deployment.id}/files/${uid}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if ((response.headers.get('content-type') || '').includes('json'))
    bytes = Buffer.from(JSON.parse(bytes.toString()).data, 'base64');
  if (hash(bytes) !== manifest.baselineHashes[file])
    changed.push('unexpected-change:' + file);
}
const report = {
  at: new Date().toISOString(),
  deploymentId: deployment.id,
  readyState: deployment.readyState,
  target: deployment.target,
  domain: 'www.vanghomnay.online',
  authoredFiles: hashes,
  sourceMismatches: changed,
  passed:
    deployment.readyState === 'READY' &&
    deployment.target === 'production' &&
    !changed.length,
};
fs.writeFileSync(
  path.join(evidence, 'deployed-source-verification.json'),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    deploymentId: report.deploymentId,
    readyState: report.readyState,
    files: Object.keys(hashes).length,
    sourceMismatches: changed,
    passed: report.passed,
  }),
);
if (!report.passed) process.exitCode = 1;
