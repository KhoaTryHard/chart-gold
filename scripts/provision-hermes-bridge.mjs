import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = 'C:/Users/LENOVO/kim-tuyen-ai';
const config = JSON.parse(await readFile(root + '/config.json', 'utf8'));
let current;
try {
  current = JSON.parse(await readFile(root + '/bridge-secret.json', 'utf8'));
} catch {
  current = {
    origin: 'https://www.vanghomnay.online',
    secret: randomBytes(32).toString('hex'),
    enabled: false,
  };
  await writeFile(
    root + '/bridge-secret.json',
    JSON.stringify(current, null, 2),
  );
  await chmod(root + '/bridge-secret.json', 0o600);
}
const enabled = process.argv.includes('--enable');
const vars = process.argv.includes('--flag-only')
  ? { HERMES_EDITORIAL_ENABLED: enabled ? 'true' : 'false' }
  : {
      HERMES_EDITORIAL_ENABLED: enabled ? 'true' : 'false',
      HERMES_EDITORIAL_SECRET: current.secret,
      HERMES_EDITORIAL_OWNER_ID: String(config.owner_id),
      HERMES_EDITORIAL_CHAT_ID: String(config.chat_id),
      HERMES_EDITORIAL_PAGE_ID: String(config.page_id),
    };
for (const [name, value] of Object.entries(vars)) {
  const result = spawnSync(
    process.execPath,
    [
      'outputs/npm-cache/_npx/69f9afb961c37556/node_modules/vercel/dist/index.js',
      'env',
      'add',
      name,
      'production',
      '--force',
    ],
    {
      input: value + '\n',
      encoding: 'utf8',
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    console.error(
      'Could not provision ' + name + '; check Vercel authentication.',
    );
    process.exit(1);
  }
  console.log('Provisioned ' + name + ' (value hidden).');
}
if (enabled) {
  current.enabled = true;
  await writeFile(
    root + '/bridge-secret.json',
    JSON.stringify(current, null, 2),
  );
}
