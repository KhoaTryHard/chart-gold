// Rebuild the current production source with only the approved validator changes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const evidence = path.resolve('outputs/source-expansion-20261009');
fs.mkdirSync(evidence, { recursive: true });
const project = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8'));
const auth = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json'), 'utf8'));
const headers = { Authorization: `Bearer ${auth.token}` };
async function get(url) {
  const r = await fetch(`https://api.vercel.com${url}${url.includes('?') ? '&' : '?'}teamId=${project.orgId}`, { headers });
  if (!r.ok) throw new Error(`Vercel source read failed: HTTP ${r.status}`);
  return r;
}
const alias = await (await get('/v4/aliases/www.vanghomnay.online')).json();
const deployment = alias.deployment.id;
const tree = await (await get(`/v6/deployments/${deployment}/files`)).json();
const src = tree.find((item) => item.name === 'src');
if (!src) throw new Error('Production source archive is unavailable');
const files = [];
function flatten(items, prefix = '') {
  for (const item of items) {
    const name = prefix + item.name;
    if (item.type === 'directory') flatten(item.children || [], name + '/');
    else if (item.type === 'file' && !name.startsWith('.env') && !name.startsWith('.vercel/') && !name.endsWith('.log')) files.push({ name, uid: item.uid });
  }
}
flatten(src.children || []);
const root = path.join(os.tmpdir(), 'chart-gold-source-expansion-20261009-' + Date.now());
fs.mkdirSync(root, { recursive: true });
let next = 0;
const hashes = {};
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < files.length) {
    const item = files[next++];
    const target = path.resolve(root, item.name);
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid source archive path');
    const response = await get(`/v7/deployments/${deployment}/files/${item.uid}`);
    let bytes = Buffer.from(await response.arrayBuffer());
    // Vercel's source endpoint may return a base64 envelope.
    if ((response.headers.get('content-type') || '').includes('json')) {
      const value = JSON.parse(bytes.toString());
      if (value.data && typeof value.data === 'string') bytes = Buffer.from(value.data, 'base64');
      else throw new Error('Unexpected source envelope: ' + item.name);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    hashes[item.name] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
}));
const admin = path.join(root, 'lib/editorial/admin.ts');
let text = fs.readFileSync(admin, 'utf8');
if (!text.includes("  'kitco.com',") || !text.includes("if (!allowed || !['http:', 'https:'].includes(url.protocol)) return null;")) throw new Error('Production validator differs; inspect before modifying');
text = text.replace("  'kitco.com',", "  'kitco.com',\n  'reuters.com',\n  'bloomberg.com',\n  'apnews.com',\n  'businessinsider.com',");
text = text.replace("if (!allowed || !['http:', 'https:'].includes(url.protocol)) return null;", "if (!allowed || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || Array.from(candidate.url).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 92)) return null;");
fs.writeFileSync(admin, text);
fs.mkdirSync(path.join(root, '.vercel'), { recursive: true });
fs.copyFileSync('.vercel/project.json', path.join(root, '.vercel/project.json'));
fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
fs.copyFileSync('tests/editorial-source-expansion.test.ts', path.join(root, 'tests/editorial-source-expansion.test.ts'));
fs.writeFileSync(path.join(evidence, 'package.json'), JSON.stringify({ root, baselineDeployment: deployment, projectId: project.projectId, files: hashes, changes: ['lib/editorial/admin.ts', 'tests/editorial-source-expansion.test.ts'] }, null, 2));
console.log(JSON.stringify({ root, baselineDeployment: deployment, sourceFiles: files.length }));
