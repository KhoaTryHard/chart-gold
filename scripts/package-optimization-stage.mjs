import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const stage = process.argv[2];
if (!['polling-log', 'cache', 'final'].includes(stage)) throw new Error('Specify polling-log, cache or final');
const evidenceRoot = 'outputs/optimization-20261004';
const baseline = `${evidenceRoot}/baseline`;
const cacheFiles = [
  'lib/request-locale.ts', 'app/page.tsx', 'app/nhip-vang/[slug]/page.tsx',
  'lib/editorial/content.ts', 'components/editorial/editorial-section.tsx',
  'lib/editorial/admin.ts', 'lib/editorial/workflow.ts', 'app/api/admin/articles/route.ts',
];
const restore = new Set(stage === 'polling-log' ? [...cacheFiles, 'components/market/market-dashboard.tsx']
  : stage === 'cache' ? ['components/market/market-dashboard.tsx'] : []);
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString().split('\0').filter(Boolean);
const root = path.join(os.tmpdir(), 'chart-gold-optimization-20261004', `${stage}-${Date.now()}`);
fs.mkdirSync(root, { recursive: true });
const hashes = {};
for (const file of files) {
  if (file.startsWith('.env') || file.endsWith('.log') || file.startsWith('outputs/') || file.startsWith('work/')) continue;
  if (stage === 'polling-log' && file === 'lib/editorial/public-cache.ts') continue;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  let bytes;
  if (restore.has(file)) {
    const saved = path.join(baseline, 'files', file + (/\.(ts|tsx|mts)$/.test(file) ? '.baseline' : ''));
    bytes = fs.existsSync(saved) ? fs.readFileSync(saved) : execFileSync('git', ['show', `HEAD:${file}`]);
  } else bytes = fs.readFileSync(file);
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  hashes[file] = crypto.createHash('sha256').update(bytes).digest('hex');
}
fs.mkdirSync(path.join(root, '.vercel'), { recursive: true });
fs.copyFileSync('.vercel/project.json', path.join(root, '.vercel/project.json'));
const manifest = { stage, root, createdAt: new Date().toISOString(), restoredBaselineFiles: [...restore], files: hashes };
fs.writeFileSync(`${evidenceRoot}/package-${stage}.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ stage, root, files: Object.keys(hashes).length }));
