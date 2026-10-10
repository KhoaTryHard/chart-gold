import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3000';
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL?.trim() ?? '';
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim() ?? '';

if (
  e2eDatabaseUrl &&
  configuredDatabaseUrl &&
  e2eDatabaseUrl === configuredDatabaseUrl
)
  throw new Error(
    'E2E_DATABASE_URL must be an isolated database and cannot equal DATABASE_URL.',
  );

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['line']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run build && npm run start -- --hostname 127.0.0.1',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      DONATIONS_ENABLED: 'true',
      AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? 'e2e-auth-secret',
      AUTH_TRUST_HOST: 'true',
      ADMIN_EMAILS: process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test',
      SEPAY_WEBHOOK_SECRET:
        process.env.E2E_SEPAY_WEBHOOK_SECRET ?? 'e2e-webhook-secret',
      SEPAY_ACCOUNT_NUMBER: process.env.E2E_SEPAY_ACCOUNT_NUMBER ?? '123456789',
      SEPAY_BANK_CODE: process.env.E2E_SEPAY_BANK_CODE ?? 'MBBank',
      SEPAY_ACCOUNT_HOLDER: process.env.E2E_SEPAY_ACCOUNT_HOLDER ?? 'E2E TEST',
      AI_PROVIDER: 'hermes',
      HERMES_BASE_URL: 'http://127.0.0.1:4317',
      HERMES_API_KEY: 'e2e-hermes-key',
      HERMES_MODEL: 'e2e-hermes-model',
      B2C_AI_ENABLED: 'true',
      AI_EXPERIENCE_V2_ENABLED: 'true',
    },
  },
});
