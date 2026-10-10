import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect, observe, operation, reset } from './fixtures'
import { linkedSource } from '../../scripts/interop/consumer/fixtures'

test('built playground edits and exports local fixtures without network access @playground-offline', async ({
  page,
  context,
}) => {
  const bundle = resolve('_local/playground/index.html')
  expect(
    existsSync(bundle),
    'Build the offline playground first: pnpm build:playground',
  ).toBe(true)
  const networkRequests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url())
  })
  await context.setOffline(true)
  await page.goto(pathToFileURL(bundle).href)
  await expect.poll(async () => (await observe(page)).lifecycle).toBe('ready')
  const original = (await observe(page)).snapshot!
  await page.getByRole('button', { name: 'Edit source', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Markdown source editor' })
    .fill(`${original.text}\nOffline source edit.\n`)
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toContain('Offline source edit.')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(original.text)
  await reset(page, 'linked-files')
  await expect(page.locator('[data-inkkit-file-kind="image"] img')).toHaveCount(
    3,
  )
  for (const kind of ['audio', 'video']) {
    await expect(page.locator(kind)).toHaveCount(1)
    await expect(page.locator(kind)).toHaveAttribute('src', /^(blob:|data:)/)
    await expect(page.locator(kind)).toHaveJSProperty('controls', true)
  }
  await expect(page.locator('iframe[sandbox=""]')).toHaveCount(1)
  for (let index = 0; index < 3; index++)
    await expect(
      page.locator('[data-inkkit-file-kind="image"] img').nth(index),
    ).toHaveAttribute('src', /^(blob:|data:)/)
  await expect(page.locator('iframe[sandbox=""]')).toHaveAttribute(
    'src',
    /^(blob:|data:)/,
  )
  expect((await observe(page)).snapshot!.text).toBe(linkedSource)
  const printable = (await operation(page, 'printable')) as {
    assets: unknown[]
    html: string
  }
  expect(printable.assets).toHaveLength(3)
  expect(printable.html).not.toMatch(/blob:|<audio|<video|<iframe/)
  expect((await observe(page)).operations.at(-1)?.status).toBe('success')
  expect(networkRequests).toEqual([])
})
