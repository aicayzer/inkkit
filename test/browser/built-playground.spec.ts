import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from '@playwright/test'

const built = resolve('_local/playground/index.html')

// The built page drops Mermaid if package.json `sideEffects` omits the entry
// that registers it, and diagrams then render as plain code.
test('the built playground renders a diagram over file:// @built', async ({
  page,
}) => {
  expect(existsSync(built), 'Run pnpm build:playground first').toBe(true)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${pathToFileURL(built).href}?fixture=mermaid`)
  const preview = page.locator('.inkkit-mermaid-preview')
  await expect(preview).toHaveCount(1)
  await expect(preview).toHaveAttribute('data-state', 'ready')
  await expect(preview.locator('svg')).toBeVisible()
  expect(errors).toEqual([])
})

test('the built playground keeps its address shareable over file:// @built', async ({
  page,
}) => {
  expect(existsSync(built), 'Run pnpm build:playground first').toBe(true)
  await page.goto(`${pathToFileURL(built).href}?fixture=tables`)
  await page.getByLabel('Configuration').selectOption('minimal')
  await expect
    .poll(() => new URL(page.url()).searchParams.get('configuration'))
    .toBe('minimal')
})
