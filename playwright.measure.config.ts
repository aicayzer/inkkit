import { defineConfig } from '@playwright/test'
import normal from './playwright.config'

// On-demand measurements (`pnpm measure:browser`). They record timings and
// assert nothing, so no workflow runs them.
export default defineConfig(normal, {
  testDir: './scripts/measure-browser',
  testIgnore: [],
  outputDir: '_local/playwright/measure/results',
  reporter: [['list']],
})
