import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const origin = (process.env.OPTIMIZATION_BASE_URL || 'https://www.vanghomnay.online').replace(/\/$/, '');
const stage = process.env.OPTIMIZATION_STAGE || 'final';
const output = join(process.cwd(), 'outputs', 'optimization-20261004', `verification-${stage}.json`);
const results = [];
let failed = false;

async function read(path, attempts = 2) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const start = performance.now();
    try {
      const response = await fetch(origin + path, {
        headers: { 'user-agent': 'ChartGoldOptimizationVerification/1.0' },
        signal: AbortSignal.timeout(20_000),
      });
      const ttfbMs = Math.round(performance.now() - start);
      const body = await response.text();
      let json;
      try { json = JSON.parse(body); } catch { /* HTML is inspected separately. */ }
      const item = {
        path, attempt, status: response.status, ttfbMs,
        totalMs: Math.round(performance.now() - start), bytes: Buffer.byteLength(body),
        cache: response.headers.get('x-vercel-cache'),
        cacheControl: response.headers.get('cache-control'),
        age: response.headers.get('age'),
        region: response.headers.get('x-vercel-id')?.split('::')[0],
        mode: json?.mode, availability: json?.availability,
        freshness: json?.freshness, sourcePublishedAt: json?.sourcePublishedAt,
        historyStatus: json?.status, recordCount: json?.records?.length,
        rowCount: json?.rows?.length,
      };
      results.push(item);
      last = { response, body, json, item };
    } catch (error) {
      failed = true;
      results.push({ path, attempt, error: error instanceof Error ? error.message : 'Request failed' });
    }
  }
  return last;
}

function check(name, passed) {
  results.push({ check: name, passed: Boolean(passed) });
  if (!passed) failed = true;
}

const home = await read('/');
check('home HTTP 200', home?.response.status === 200);
const hub = await read('/nhip-vang');
check('editorial hub HTTP 200', hub?.response.status === 200);
const articlePath = hub?.body.match(/href="(\/nhip-vang\/[^"?#]+)"/)?.[1];
if (articlePath) {
  const article = await read(articlePath);
  check('published article HTTP 200', article?.response.status === 200);
  if (stage !== 'polling-log') {
    check('published article uses public cache', Boolean(article?.item.cacheControl) && !article.item.cacheControl.includes('no-store'));
    check('published article cache HIT after warming', results.some(item => item.path === articlePath && item.cache === 'HIT'));
  }
}
if (stage !== 'polling-log') {
  check('home uses public cache', Boolean(home?.item.cacheControl) && !home.item.cacheControl.includes('no-store'));
  check('home cache HIT after warming', results.some(item => item.path === '/' && item.cache === 'HIT'));
}

const quote = await read('/api/sjc?company=sjc&product=bar-1l&view=quote');
check('quote HTTP 200 and additive freshness', quote?.response.status === 200 && typeof quote?.json?.freshness?.evaluatedAt === 'string');
check('quote identity retained', quote?.json?.company?.id === 'sjc' && quote?.json?.product?.id === 'bar-1l');
const history = await read('/api/market-history?company=sjc&product=bar-1l&range=1N');
check('annual history HTTP 200', history?.response.status === 200);

for (const period of ['month', 'all']) {
  const donations = await read(`/api/donations/public?period=${period}`);
  check(`public donations ${period} compatible and uncached`, donations?.response.status === 200
    && donations?.json?.period === period && Array.isArray(donations?.json?.rows)
    && 'summary' in donations.json && donations.item.cacheControl?.includes('no-store'));
}
const invalidPeriod = await read('/api/donations/public?period=invalid', 1);
check('invalid donation period rejected', invalidPeriod?.response.status === 400);
for (const path of ['/api/donations/summary', '/api/donations/leaderboard?period=month']) {
  const legacy = await read(path, 1);
  check(`legacy ${path} retained`, legacy?.response.status === 200);
}
const privateRoute = await read('/api/admin/articles', 1);
check('guest admin API remains protected', privateRoute?.response.status === 401);
const missingArticle = await read('/nhip-vang/optimization-no-such-article-20261004', 1);
// Next can stream the layout before discovering a missing article. In that
// case notFound() returns 200 and injects noindex; both documented modes apply.
check('missing article stays unindexable', missingArticle?.response.status === 404
  || (missingArticle?.response.status === 200 && /<meta[^>]*name="robots"[^>]*content="noindex"/.test(missingArticle.body)));

await mkdir(join(process.cwd(), 'outputs', 'optimization-20261004'), { recursive: true });
await writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), origin, stage, passed: !failed,
  method: 'Read-only HTTP; no donation orders, webhooks or editorial mutations', results }, null, 2));
console.log(JSON.stringify({ output, passed: !failed, results }, null, 2));
if (failed) process.exitCode = 1;
