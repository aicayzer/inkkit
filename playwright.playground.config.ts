import { defineConfig } from '@playwright/test'
import normal from './playwright.config'

// The playground controls and the docs demo, which only playground, demo and
// preset changes can break.
export default defineConfig(normal, {
  testIgnore: [],
  testMatch: [/playground-(tools|themes)\.spec/, /docs-demo-themes/],
  outputDir: '_local/playwright/playground/results',
  reporter: [['list']],
})
