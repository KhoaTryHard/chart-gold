import fs from 'node:fs';
import path from 'node:path';
const project = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8'));
const auth = JSON.parse(
  fs.readFileSync(
    path.join(process.env.APPDATA, 'com.vercel.cli/Data/auth.json'),
    'utf8',
  ),
);
const mode = process.argv[2];
async function set(key, value, target, type = 'plain') {
  const response = await fetch(
    `https://api.vercel.com/v10/projects/${project.projectId}/env?upsert=true&teamId=${project.orgId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, value, target, type }),
    },
  );
  if (!response.ok)
    throw new Error(`Environment update ${key}: HTTP ${response.status}`);
  const result = await response.json();
  if (result.failed?.length)
    throw new Error(`Environment update ${key} rejected.`);
  console.log(JSON.stringify({ key, target, updated: true }));
}
if (mode === 'staging') {
  if (process.env.R2_BUCKET !== 'chart-gold-media-staging')
    throw new Error('Staging credential required');
  for (const key of [
    'R2_ACCOUNT_ID',
    'R2_ENDPOINT',
    'R2_REGION',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ]) {
    const value = process.env[key];
    if (!value) throw new Error(`Missing ${key}`);
    // Development credentials remain encrypted but can be pulled for local tests.
    await set(
      key,
      value,
      ['preview'],
      key.includes('KEY') ? 'sensitive' : 'plain',
    );
    await set(
      key,
      value,
      ['development'],
      key.includes('KEY') ? 'encrypted' : 'plain',
    );
  }
  await set('MEDIA_STORAGE_PROVIDER', 'r2', ['preview', 'development']);
  await set('MEDIA_STORAGE_DUAL_READ', 'true', ['preview', 'development']);
} else if (['compatibility', 'r2', 'locked'].includes(mode)) {
  await set(
    'MEDIA_STORAGE_PROVIDER',
    mode === 'compatibility' ? 'blob' : 'r2',
    ['production'],
  );
  await set('MEDIA_STORAGE_DUAL_READ', 'true', ['production']);
  await set(
    'HERMES_STORAGE_MIGRATION_ENABLED',
    mode === 'locked' ? 'false' : 'true',
    ['production'],
  );
  await set('MEDIA_STORAGE_RETIRE_BLOB', mode === 'locked' ? 'true' : 'false', [
    'production',
  ]);
} else throw new Error('Specify staging, compatibility, r2 or locked');
