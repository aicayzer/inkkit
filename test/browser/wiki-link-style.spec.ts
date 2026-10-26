import type { Page } from '@playwright/test'
import { test, expect, operation } from './fixtures'

const source =
  'A [a link](https://example.com), [[Notes/Trip|Trip]] and [[Missing note]].\n'

const line = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true }).evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      color: style.color,
      line: style.textDecorationLine,
      style: style.textDecorationStyle,
    }
  })

test.beforeEach(async ({ page, openFixture }) => {
  await openFixture('linked-files')
  await operation(page, 'reload', { text: source })
  await expect(page.locator('.inkkit-wiki-link')).toHaveCount(2)
})

test('wiki links use the link color, and a missing one is also dashed @linked-files', async ({
  page,
}) => {
  const link = await line(page, 'a link')
  const present = await line(page, 'Trip')
  const missing = await line(page, 'Missing note')
  expect(present.color).toBe(link.color)
  expect(missing.color).toBe(link.color)
  expect(present.line).toBe('none')
  expect(missing).toMatchObject({ line: 'underline', style: 'dashed' })
})

test('hovering underlines a present link and leaves a missing link dashed @linked-files', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Trip', exact: true }).hover()
  expect(await line(page, 'Trip')).toMatchObject({
    line: 'underline',
    style: 'solid',
  })
  await page.getByRole('link', { name: 'Missing note', exact: true }).hover()
  expect(await line(page, 'Missing note')).toMatchObject({
    line: 'underline',
    style: 'dashed',
  })
})

test('the missing cue survives forced colors @linked-files', async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  expect(
    await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
    'this engine does not emulate forced colors',
  ).toBe(true)
  const link = await line(page, 'a link')
  const present = await line(page, 'Trip')
  const missing = await line(page, 'Missing note')
  // Only Chromium's emulation forces the colors, so only there do the two kinds of link compare.
  if (browserName === 'chromium') {
    expect(present.color).toBe(link.color)
    expect(missing.color).toBe(link.color)
  }
  expect(present.line).toBe('none')
  expect(missing).toMatchObject({ line: 'underline', style: 'dashed' })
})

test('a missing link is described, not disabled, and a present one is not @linked-files', async ({
  page,
}) => {
  const missing = page.getByRole('link', { name: 'Missing note', exact: true })
  const present = page.getByRole('link', { name: 'Trip', exact: true })
  await expect(missing).toHaveAttribute('aria-description', 'Link unavailable')
  await expect(missing).toHaveAttribute('title', 'Link unavailable')
  await expect(missing).not.toHaveAttribute('aria-disabled', /.*/)
  await expect(present).not.toHaveAttribute('aria-description', /.*/)
  await expect(present).not.toHaveAttribute('title', /.*/)
  // Enter still opens a missing target, so the host can offer to create it.
  await missing.focus()
  await page.keyboard.press('Enter')
  const events = (await operation(page, 'fileEvents')) as {
    operation: string
    reference?: string
  }[]
  expect(events).toContainEqual(
    expect.objectContaining({
      operation: 'wikiOpen',
      reference: 'Missing note',
    }),
  )
})

test('Chromium exposes the missing description in its accessibility tree @linked-files', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'The DevTools protocol is Chromium only',
  )
  const client = await page.context().newCDPSession(page)
  const { nodes } = (await client.send('Accessibility.getFullAXTree')) as {
    nodes: {
      role?: { value: string }
      name?: { value: string }
      description?: { value: string }
    }[]
  }
  const named = nodes.filter(
    (node) =>
      node.role?.value === 'link' && node.name?.value === 'Missing note',
  )
  expect(named).toHaveLength(1)
  expect(named[0]!.description?.value).toBe('Link unavailable')
  expect(
    nodes.find((node) => node.name?.value === 'Trip')?.description?.value,
  ).toBeUndefined()
})
