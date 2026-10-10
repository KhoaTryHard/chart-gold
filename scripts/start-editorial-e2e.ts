import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import config from '../playwright.editorial.config';

const server = config.webServer;
if (!server || Array.isArray(server))
  throw new Error('Missing isolated E2E configuration');
const port = Number(process.env.EDITORIAL_E2E_PORT ?? 3011);
const out = openSync('outputs/editorial-implementation/e2e-server.log', 'a');
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, ...server.env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  },
);
child.unref();
writeFileSync(
  'outputs/editorial-implementation/e2e-server-pid.json',
  JSON.stringify({ pid: child.pid, port }),
);
console.log('Local E2E server started on port', port);
