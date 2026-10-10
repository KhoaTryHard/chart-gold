import { defineConfig } from '@playwright/test';
import base from './playwright.config';

if (!base.webServer || Array.isArray(base.webServer))
  throw new Error('Expected the isolated local test server configuration.');

export default defineConfig({
  ...base,
  testMatch: [
    'donate-realtime.spec.ts',
    'donate-production-contract.spec.ts',
    'editorial-cache.spec.ts',
    'market-chart.spec.ts',
    'editorial.spec.ts',
    'site-footer.spec.ts',
  ],
  workers: 1,
  outputDir: 'test-results/optimization',
  reporter: [
    ['line'],
    ['json', { outputFile: 'outputs/optimization-20261004/e2e-results.json' }],
  ],
  webServer: {
    ...base.webServer,
    reuseExistingServer: process.env.OPTIMIZATION_REUSE_SERVER === 'true',
  },
});
