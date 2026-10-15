import type { Locator, Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Mod is Command on Apple platforms and Control elsewhere, as in keymaps.
const source =
  '[Site](https://example.com/a)\n\n[[Travel plan]]\n\n[Blanked](javascript:alert(1))\n\n[Empty]()\n'

async function open(
  page: Page,
  openFixture: (fixture: string) => Promise<void>,
) {
  await openFixture('linked-files')
  await operation(page, 'reload', { text: source })
  await expect(page.getByRole('link', { name: 'Site' })).toBeVisible()
}

const wikiOpens = async (page: Page) =>
  ((await operation(page, 'fileEvents')) as { operation: string }[]).filter(
    (event) => event.operation === 'wikiOpen',
  ).length

const cursor = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).cursor)

async function expectOpens(
  page: Page,
  mod: 'Meta' | 'Control' | 'ControlOrMeta',
  other: 'Meta' | 'Control',
) {
  const site = page.getByRole('link', { name: 'Site' })
  const wiki = page.getByRole('link', { name: 'Travel plan', exact: true })

  await site.click()
  await site.click({ modifiers: [other] })
  await wiki.click()
  await wiki.click({ modifiers: [other] })
  expect((await observe(page)).lastResult).toBeNull()
  expect(await wikiOpens(page)).toBe(0)

  await site.click({ modifiers: [mod] })
  expect((await observe(page)).lastResult).toBe('https://example.com/a')
  await wiki.click({ modifiers: [mod] })
  expect(await wikiOpens(page)).toBe(1)

  // A link whose address the renderer blanked is never handed to the host.
  await site.click({ modifiers: [mod] })
  await page.getByRole('link', { name: 'Blanked' }).click({ modifiers: [mod] })
  await page.getByRole('link', { name: 'Empty' }).click({ modifiers: [mod] })
  expect((await observe(page)).lastResult).toBe('https://example.com/a')
  expect(page.url()).toContain('fixture=linked-files')
  expect((await observe(page)).snapshot!.text).toBe(source)
}

test('links open on a primary click with Mod, and only then @smoke', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await expectOpens(
    page,
    'ControlOrMeta',
    process.platform === 'darwin' ? 'Control' : 'Meta',
  )
})

test('read-only editors open links, and relative addresses arrive as written', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await operation(page, 'reload', {
    text: '[Intro](#intro) and [Note](notes/a%20b.md?x=1)\n\n[[Travel plan]]\n',
  })
  await operation(page, 'editable', { editable: false })
  await page.getByRole('link', { name: 'Intro' }).click({
    modifiers: ['ControlOrMeta'],
  })
  expect((await observe(page)).lastResult).toBe('#intro')
  await page.getByRole('link', { name: 'Note' }).click({
    modifiers: ['ControlOrMeta'],
  })
  expect((await observe(page)).lastResult).toBe('notes/a%20b.md?x=1')
  await page
    .getByRole('link', { name: 'Travel plan', exact: true })
    .click({ modifiers: ['ControlOrMeta'] })
  expect(await wikiOpens(page)).toBe(1)
  expect(page.url()).toContain('fixture=linked-files')
})

test('Mod follows the platform the page reports', async ({
  page,
  openFixture,
  browserName,
}) => {
  // Report the platform other than the one the test runs on, so both rules run
  // on every machine.
  const apple = process.platform !== 'darwin'
  test.skip(
    !apple && browserName === 'chromium',
    'Chromium on macOS turns Control-click into a context menu, whatever the page reports.',
  )
  await page.addInitScript((apple) => {
    Object.defineProperty(Navigator.prototype, 'platform', {
      get: () => (apple ? 'MacIntel' : 'Win32'),
    })
  }, apple)
  await open(page, openFixture)
  await expectOpens(
    page,
    apple ? 'Meta' : 'Control',
    apple ? 'Control' : 'Meta',
  )
})

test('holding Mod over the editor shows the link cursor', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const site = page.getByRole('link', { name: 'Site' })
  const wiki = page.getByRole('link', { name: 'Travel plan', exact: true })
  const blanked = page.getByRole('link', { name: 'Blanked' })
  await expect.poll(() => cursor(site)).not.toBe('pointer')
  await expect.poll(() => cursor(wiki)).not.toBe('pointer')

  // Focus stays on a host control outside the editor root.
  await page.locator('#fixture').focus()
  await site.hover()
  await page.keyboard.down('ControlOrMeta')
  await expect.poll(() => cursor(site)).toBe('pointer')
  await expect.poll(() => cursor(wiki)).toBe('pointer')
  await expect.poll(() => cursor(blanked)).not.toBe('pointer')
  await page.keyboard.up('ControlOrMeta')
  await expect.poll(() => cursor(site)).not.toBe('pointer')

  // Pressed outside the editor, Mod shows the cursor once the pointer enters.
  await page.mouse.move(1, 1)
  await page.keyboard.down('ControlOrMeta')
  await expect.poll(() => cursor(site)).not.toBe('pointer')
  await site.hover()
  await expect.poll(() => cursor(site)).toBe('pointer')
  // Leaving the editor forgets the key, so a key released elsewhere cannot
  // leave the cursor behind.
  await page.mouse.move(1, 1)
  await expect.poll(() => cursor(site)).not.toBe('pointer')
  await page.keyboard.up('ControlOrMeta')

  // Focus in the editor, Mod pressed with the caret in text.
  await site.click()
  await page.keyboard.down('ControlOrMeta')
  await expect.poll(() => cursor(site)).toBe('pointer')
  await page.keyboard.up('ControlOrMeta')
  await expect.poll(() => cursor(site)).not.toBe('pointer')
  expect((await observe(page)).snapshot!.text).toBe(source)
})

for (const editable of [true, false])
  test(`${editable ? 'editable' : 'read-only'} links never navigate the page without Mod`, async ({
    page,
    openFixture,
  }) => {
    await open(page, openFixture)
    if (!editable) await operation(page, 'editable', { editable: false })
    const url = page.url()
    // A reload or navigation clears this.
    await page.evaluate(() => {
      ;(window as unknown as { stayed?: boolean }).stayed = true
    })
    for (const name of ['Site', 'Blanked', 'Empty']) {
      const link = page.getByRole('link', { name })
      await link.click()
      await link.click({ modifiers: ['Shift'] })
      await link.click({ button: 'middle' })
    }
    // A new window or tab opens asynchronously.
    await page.waitForTimeout(300)
    expect(page.url()).toBe(url)
    expect(page.context().pages()).toHaveLength(1)
    expect(
      await page.evaluate(
        () => (window as unknown as { stayed?: boolean }).stayed,
      ),
    ).toBe(true)
    expect((await observe(page)).lastResult).toBeNull()
    if (!editable) expect((await observe(page)).snapshot!.text).toBe(source)
  })

// A wiki link takes focus when clicked, so the key reaches neither it nor
// the text; a Markdown link leaves the caret in the text.
for (const [name, expected] of [
  ['Site', source.replace('Site', 'SiZte')],
  ['Travel plan', source],
])
  test(`Mod-click on ${name} leaves the selection where it was`, async ({
    page,
    openFixture,
  }) => {
    await open(page, openFixture)
    const site = page.getByRole('link', { name: 'Site' })
    await site.click()
    await page
      .getByRole('link', { name, exact: true })
      .click({ modifiers: ['ControlOrMeta'] })
    await page.keyboard.type('Z')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(expected)
  })
