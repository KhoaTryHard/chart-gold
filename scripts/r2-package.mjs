// Preserve the current production source and overlay only this migration's files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const project = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8'));
const auth = JSON.parse(
  fs.readFileSync(
    path.join(process.env.APPDATA, 'com.vercel.cli/Data/auth.json'),
    'utf8',
  ),
);
const evidence = path.resolve('outputs/r2-migration-20261017');
fs.mkdirSync(evidence, { recursive: true });
async function get(route) {
  const response = await fetch(
    `https://api.vercel.com${route}${route.includes('?') ? '&' : '?'}teamId=${project.orgId}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  if (!response.ok)
    throw new Error(`Production source read HTTP ${response.status}`);
  return response;
}
const alias = await (await get('/v4/aliases/www.vanghomnay.online')).json();
const deploymentId = alias.deployment.id;
const tree = await (await get(`/v6/deployments/${deploymentId}/files`)).json();
const source = tree.find((item) => item.name === 'src');
if (!source) throw new Error('Production source archive missing');
const files = [];
function flatten(items, prefix = '') {
  for (const item of items) {
    const name = prefix + item.name;
    if (item.type === 'directory') flatten(item.children || [], name + '/');
    else if (
      item.type === 'file' &&
      !name.startsWith('.env') &&
      !name.startsWith('.vercel/') &&
      !name.endsWith('.log')
    )
      files.push({ name, uid: item.uid });
  }
}
flatten(source.children || []);
const root = path.join(process.env.TEMP, 'chart-gold-r2-release-' + Date.now());
fs.mkdirSync(root, { recursive: true });
let next = 0;
const hashes = {};
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < files.length) {
      const item = files[next++],
        destination = path.resolve(root, item.name);
      if (!destination.startsWith(root + path.sep))
        throw new Error('Invalid archive path');
      const response = await get(
        `/v7/deployments/${deploymentId}/files/${item.uid}`,
      );
      let bytes = Buffer.from(await response.arrayBuffer());
      if ((response.headers.get('content-type') || '').includes('json')) {
        const payload = JSON.parse(bytes.toString());
        if (!payload.data || typeof payload.data !== 'string')
          throw new Error('Unknown source envelope');
        bytes = Buffer.from(payload.data, 'base64');
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
      hashes[item.name] = crypto
        .createHash('sha256')
        .update(bytes)
        .digest('hex');
    }
  }),
);
const changes = [
  'lib/editorial/r2.ts',
  'lib/editorial/media-storage.ts',
  'lib/editorial/storage-maintenance.ts',
  'lib/editorial/images.ts',
  'lib/editorial/hermes-integration.ts',
  'lib/editorial/video-assets.ts',
  'app/api/admin/articles/[id]/cover/route.ts',
  'app/api/editorial/media/[revisionId]/route.ts',
  'app/api/editorial/integrations/hermes/videos/upload-token/route.ts',
  'app/api/editorial/integrations/hermes/storage/route.ts',
  'db/schema.ts',
  'drizzle/0018_media_storage.sql',
  'drizzle/meta/_journal.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
];
const differences = [];
for (const file of changes) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (hashes[file]) {
    const baselineDir = path.join(
      evidence,
      'production-baseline',
      path.dirname(file),
    );
    fs.mkdirSync(baselineDir, { recursive: true });
    fs.copyFileSync(
      destination,
      path.join(evidence, 'production-baseline', file),
    );
    differences.push(file);
  }
  fs.copyFileSync(file, destination);
}
fs.mkdirSync(path.join(root, '.vercel'), { recursive: true });
fs.copyFileSync(
  '.vercel/project.json',
  path.join(root, '.vercel/project.json'),
);
fs.cpSync('tests', path.join(root, 'tests'), { recursive: true });
for (const file of [
  'vitest.config.ts',
  'playwright.config.ts',
  'playwright.editorial.config.ts',
])
  fs.copyFileSync(file, path.join(root, file));
// Turbopack rejects node_modules junctions outside this release's filesystem
// root. Install dependencies in the release directory before local checks.
fs.writeFileSync(
  path.join(evidence, 'release-package.json'),
  JSON.stringify(
    { root, baselineDeployment: deploymentId, changes, baselineHashes: hashes },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    root,
    baselineDeployment: deploymentId,
    sourceFiles: files.length,
    overlaid: changes.length,
    nextStep:
      'Run npm ci, tests and npm run build in the release directory before deployment.',
  }),
);
