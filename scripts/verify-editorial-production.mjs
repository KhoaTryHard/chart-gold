import { writeFile } from 'node:fs/promises';

const origin = 'https://www.vanghomnay.online';
const paths = ['/nhip-vang', '/bien-tap', '/admin/bai-viet', '/api/admin/articles',
  '/api/admin/articles/00000000-0000-4000-8000-000000000001', '/api/cron/editorial', '/api/editorial/worker', '/news-sitemap.xml'];
const results = await Promise.all(paths.map(async path => {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent':'ChartGoldReadOnlyVerification/1.0' } });
  const body = await response.text();
  return { path, status: response.status, title: body.match(/<title>([^<]+)<\/title>/i)?.[1] ?? null,
    articles: path === '/nhip-vang' ? [...new Set([...body.matchAll(/href="(\/nhip-vang\/[^"?#]+)"/g)].map(match=>match[1]))].slice(0,2) : undefined,
    loginRequired: path === '/admin/bai-viet' ? /Vui lòng đăng nhập bằng tài khoản quản trị/.test(body) : undefined,
    cacheControl: response.headers.get('cache-control') };
}));
for (const path of results[0].articles ?? []) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(20_000) });
  results.push({ path, status:response.status, title:(await response.text()).match(/<title>([^<]+)<\/title>/i)?.[1]??null, cacheControl:response.headers.get('cache-control') });
}
const ok = results.every(result => result.status === (result.path.startsWith('/api/admin/') || result.path === '/api/cron/editorial' ? 401 : result.path === '/api/editorial/worker' ? 405 : 200));
const output = { checkedAt:new Date().toISOString(), origin, method:'Unauthenticated GET only', ok, results,
  adminLimitation:'Production browser has no Google Admin session. Authenticated workflow was verified using the local E2E database and real HTTP routes; no production content was mutated.' };
await writeFile('outputs/editorial-implementation/production-verification.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
if(!ok)process.exitCode=1;
