import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const webServer = base.webServer;
const port = Number(process.env.EDITORIAL_E2E_PORT ?? 3011);
if (!Number.isInteger(port) || port < 3011 || port > 3020)
  throw new Error(
    'Editorial E2E port must be a local test port from 3011 to 3020.',
  );
const baseURL = `http://127.0.0.1:${port}`;
if (!webServer || Array.isArray(webServer))
  throw new Error('Expected the isolated local E2E server configuration.');
export default defineConfig({
  ...base,
  testMatch: ['admin-review.spec.ts', 'editorial.spec.ts', 'editorial-cache.spec.ts'],
  workers: 1,
  use: { ...base.use, baseURL },
  webServer: {
    ...webServer,
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: process.env.EDITORIAL_REUSE_SERVER === 'true',
    env: {
      ...webServer.env,
      HERMES_EDITORIAL_ENABLED: 'true',
      HERMES_EDITORIAL_TEST_LOCAL: 'true',
      HERMES_EDITORIAL_SECRET: 'e2e-hermes-bridge-signature-secret-32',
      HERMES_EDITORIAL_OWNER_ID: '1758923792',
      HERMES_EDITORIAL_CHAT_ID: '-1003759063639',
      BLOB_READ_WRITE_TOKEN: '',
      BLOB_STORE_ID: '',
      VERCEL_OIDC_TOKEN: '',
    },
  },
});
