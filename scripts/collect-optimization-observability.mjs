import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const deploymentId = process.argv[2];
if (!deploymentId?.startsWith('dpl_')) throw new Error('Specify the deployment ID to inspect.');
const cache = path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx');
const candidates = fs.readdirSync(cache).flatMap(directory => {
  const manifest = path.join(cache, directory, 'node_modules', 'vercel', 'package.json');
  if (!fs.existsSync(manifest)) return [];
  const item = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return [{ version: item.version, cli: path.join(path.dirname(manifest), item.bin.vercel) }];
}).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
if (!candidates.length) throw new Error('No installed Vercel CLI found; run npx vercel --version first.');
const events = [];
for (const query of ['market_origin', 'market_history_sync']) {
  const output = execFileSync(process.execPath, [candidates[0].cli, 'logs', '--deployment', deploymentId,
    '--query', query, '--since', '1h', '--limit', '100', '--json'],
  { encoding: 'utf8', maxBuffer: 4_000_000 });
  for (const line of output.split('\n')) {
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    for (const log of request.logs ?? []) {
      let data;
      try { data = JSON.parse(log.message); } catch { continue; }
      if (!['market_origin', 'market_history_sync'].includes(data.event)) continue;
      const uniqueKey = `${request.id}:${log.message}`;
      if (events.some(item => item.uniqueKey === uniqueKey)) continue;
      // Select application-controlled telemetry only. Do not retain request
      // addresses, identities, raw errors, payloads, headers, or bank details.
      events.push({ uniqueKey, data: {
        timestamp: request.timestamp, responseStatusCode: request.responseStatusCode,
        event: data.event, route: data.route, companyId: data.companyId,
        productId: data.productId, view: data.view, provider: data.provider,
        mode: data.mode, availability: data.availability, durationMs: data.durationMs,
        sourceAgeSeconds: data.sourceAgeSeconds, recordAgeSeconds: data.recordAgeSeconds,
        networkRequests: data.networkRequests, cacheHits: data.cacheHits,
        deduplicatedRequests: data.deduplicatedRequests,
        upstreamHttpErrors: data.upstreamHttpErrors, failures: data.failures,
        outcome: data.outcome,
        outcomes: data.outcomes?.map(item => ({ companyId: item.companyId, status: item.status,
          okDays: item.okDays, missingDays: item.missingDays, errorDays: item.errorDays })),
      } });
    }
  }
}
const records = events.map(item => item.data);
const origins = records.filter(item => item.event === 'market_origin');
const modes = {};
for (const item of origins) modes[item.mode ?? 'failed'] = (modes[item.mode ?? 'failed'] ?? 0) + 1;
const timestamp = new Date().toISOString();
const record = { checkedAt: timestamp, deploymentId, window: 'Retained logs within last 1h, limit 100 per query',
  measurementScope: 'Origin executions only; excludes CDN HIT requests and is not a full-project error-rate estimate',
  originExecutions: origins.length, modes, events: records };
const output = `outputs/optimization-20261004/observability-${timestamp.replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(output, JSON.stringify(record, null, 2));
console.log(JSON.stringify({ output, originExecutions: origins.length, modes }));
