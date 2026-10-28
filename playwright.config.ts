import { defineConfig, devices } from '@playwright/test'

const fixtureMode = process.env.INKKIT_BROWSER_FIXTURE
if (fixtureMode && !['dev', 'built'].includes(fixtureMode))
  throw Error('INKKIT_BROWSER_FIXTURE must be dev or built')

// Worktrees running tests at the same time need different ports.
const port = Number(process.env.INKKIT_PLAYGROUND_PORT ?? 4178)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error(
    `INKKIT_PLAYGROUND_PORT must be a port number, not ${process.env.INKKIT_PLAYGROUND_PORT}`,
  )

export default defineConfig({
  testDir: './test/browser',
  testIgnore: /built-playground/,
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
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: process.env.INKKIT_EXTERNAL_PLAYGROUND
    ? undefined
    : {
        command: fixtureMode
          ? 'node scripts/browser-fixture.mjs'
          : `pnpm exec vite playground --host 127.0.0.1 --port ${port} --strictPort`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
        timeout: 30_000,
      },
})
