import { defineConfig } from '@playwright/test'
import normal from './playwright.config'

export default defineConfig(normal, {
  testMatch: 'diagnostics.spec.ts',
  grepInvert: [],
  outputDir: '_local/playwright/controlled-failure/results',
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: '_local/playwright/controlled-failure/report',
        open: 'never',
      },
    ],
    [
      'json',
      { outputFile: '_local/playwright/controlled-failure/results.json' },
    ],
  ],
})
