import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/docs-demo',
  workers: 1,
  retries: 0,
  outputDir: '_local/playwright/docs-demo',
  reporter: 'list',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
