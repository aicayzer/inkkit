import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 30_000,
  grepInvert: /@intentional-failure/,
  outputDir: '_local/playwright/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '_local/playwright/report', open: 'never' }],
    ['json', { outputFile: '_local/playwright/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4178',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command:
      'pnpm exec vite playground --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
