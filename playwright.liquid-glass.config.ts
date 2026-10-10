import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:3000';

// These are intentionally deterministic E2E values. Do not copy values from
// .env.local into this config: Next can still read its normal local settings,
// while the test server receives only the non-secret defaults it needs.
const e2eEnvironment = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
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
};

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'liquid-glass.spec.ts',
  outputDir: 'test-results/liquid-glass',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['line']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: 'webkit-iphone',
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
        // Keep the iPhone user agent, touch input and scale factor, while
        // exposing a full 390 x 844 visual viewport for safe-area checks.
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run start -- --hostname localhost --port 3000',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: e2eEnvironment,
  },
});
