import { defineConfig } from '@playwright/test';

// Judge mode end to end (§7.2 exit criterion as a regression test): a fresh short-epoch demo
// deployment, every service as its own process, the built console, and a real browser.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 40 * 60_000,
  globalSetup: './global-setup.ts',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../test-artifacts/e2e-report' }]],
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: '../../test-artifacts/e2e-results',
});
