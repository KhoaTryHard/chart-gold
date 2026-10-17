// Signed operations execute inside Vercel; Sensitive credentials never leave it.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
const config = JSON.parse(
  fs.readFileSync('C:/Users/LENOVO/kim-tuyen-ai/bridge-secret.json', 'utf8'),
);
if (config.origin !== 'https://www.vanghomnay.online')
  throw new Error('Unexpected bridge origin');
const route = '/api/editorial/integrations/hermes/storage';
const operation = process.argv[2] || 'inventory';
const evidence = 'outputs/r2-migration-20261017';
fs.mkdirSync(evidence, { recursive: true });
async function send(body) {
  const raw = JSON.stringify(body),
    timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', config.secret)
    .update(
      [
        'POST',
        route,
        timestamp,
        createHash('sha256').update(raw).digest('hex'),
      ].join('\n'),
    )
    .digest('hex');
  const response = await fetch(config.origin + route, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
    headers: {
      'Content-Type': 'application/json',
      'x-editorial-client': 'kim-tuyen-newsroom',
      'x-editorial-timestamp': timestamp,
      'x-editorial-signature': signature,
    },
    body: raw,
  });
  if (!response.ok) throw new Error(`Remote operation HTTP ${response.status}`);
  return response.json();
}
if (operation === 'migrate' || operation === 'verify-all') {
  const inventory = await send({ operation: 'inventory' });
  fs.writeFileSync(
    path.join(evidence, 'remote-inventory.json'),
    JSON.stringify(inventory, null, 2),
  );
  const baseline = await send({ operation: 'identities' });
  const baselinePath = path.join(evidence, 'remote-identities-before.json');
  if (!fs.existsSync(baselinePath))
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  const keys =
    operation === 'migrate'
      ? inventory.objects.map((row) => row.pathname)
      : inventory.locations
          .filter((row) => row.provider === 'r2' && row.verifiedAt)
          .map((row) => row.pathname);
  const results = [];
  for (const pathname of keys) {
    try {
      results.push(
        await send({
          operation: operation === 'migrate' ? 'copy' : 'verify',
          pathname,
        }),
      );
    } catch (error) {
      results.push({ pathname, state: 'error', message: error.message });
    }
    fs.writeFileSync(
      path.join(evidence, `remote-${operation}-results.json`),
      JSON.stringify(results, null, 2),
    );
  }
  const after = await send({ operation: 'identities' });
  const before = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const changed = Object.entries(before).flatMap(([type, rows]) =>
    Object.entries(rows)
      .filter(([id, value]) => after[type]?.[id] !== value)
      .map(([id]) => `${type}:${id}`),
  );
  const report = {
    operation,
    count: results.length,
    verified: results.filter((row) => row.state === 'verified').length,
    errors: results.filter((row) => row.state === 'error').length,
    missingReferences: inventory.missingReferences,
    identityChanges: changed,
  };
  fs.writeFileSync(
    path.join(evidence, `remote-${operation}-report.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (report.errors || changed.length || inventory.missingReferences.length)
    process.exitCode = 1;
} else {
  const value = await send({
    operation,
    ...(process.argv[3] ? { pathname: process.argv[3] } : {}),
  });
  fs.writeFileSync(
    path.join(evidence, `remote-${operation}.json`),
    JSON.stringify(value, null, 2),
  );
  console.log(
    JSON.stringify(
      operation === 'inventory'
        ? {
            objects: value.objects.length,
            bytes: value.objects.reduce((sum, object) => sum + object.size, 0),
            references: value.references.length,
            mapped: value.locations.length,
            missingReferences: value.missingReferences,
          }
        : value,
    ),
  );
}
