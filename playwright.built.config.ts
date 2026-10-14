import { defineConfig, devices } from '@playwright/test'

// Runs against the offline page that `pnpm build:playground` writes, opened
// as a file, so there is no web server.
export default defineConfig({
  testDir: './test/browser',
  testMatch: 'built-playground.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: '_local/playwright/built/results',
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
