import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'chart-gold-vercel-ignore-'));
const files = [
  'integrations/kim-tuyen-bot/media_storage.py',
  'app/api/editorial/integrations/hermes/storage/route.ts',
  'app/api/editorial/integrations/hermes/videos/[assetId]/url/route.ts',
  'app/api/editorial/integrations/hermes/prepare/route.ts',
];
beforeAll(() => {
  writeFileSync(join(root, '.vercelignore'), readFileSync('.vercelignore'));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  const git = spawnSync('git', ['init', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(git.status).toBe(0);
});
afterAll(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
    throw new Error('Unexpected test directory');
  rmSync(root, { recursive: true, force: true });
});
it('excludes only the root bot snapshot while keeping website integration routes deployable', () => {
  const result = spawnSync(
    'git',
    [
      '-c',
      'core.excludesFile=.vercelignore',
      'check-ignore',
      '--no-index',
      '--stdin',
    ],
    { cwd: root, input: files.join('\n') + '\n', encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split(/\r?\n/)).toEqual([files[0]]);
});
