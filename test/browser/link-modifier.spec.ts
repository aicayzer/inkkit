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
    const navigations: string[] = []
    const openedPages: Page[] = []
    page.on('framenavigated', (frame) => navigations.push(frame.url()))
    page.context().on('page', (opened) => openedPages.push(opened))
    // Observe after the editor's handler, without cancelling anything in the test.
    await page.evaluate(() => {
      const probe = { stayed: true, prevented: [] as boolean[] }
      Object.assign(window, { navigationProbe: probe })
      for (const type of ['click', 'auxclick'])
        document.addEventListener(type, (event) => {
          if ((event.target as Element).closest('a[href]'))
            probe.prevented.push(event.defaultPrevented)
        })
    })
    for (const name of ['Site', 'Blanked', 'Empty']) {
      const link = page.getByRole('link', { name })
      await link.click()
      await link.click({ modifiers: ['Shift'] })
      await link.click({ button: 'middle' })
    }
    const probe = await page.evaluate(
      () =>
        (
          window as unknown as {
            navigationProbe: { stayed: boolean; prevented: boolean[] }
          }
        ).navigationProbe,
    )
    // A cancelled default action cannot schedule a navigation or a new tab.
    expect(probe.prevented).toEqual(Array<boolean>(9).fill(true))
    expect(probe.stayed).toBe(true)
    expect(navigations).toEqual([])
    expect(openedPages).toEqual([])
    expect(page.url()).toBe(url)
    expect(page.context().pages()).toHaveLength(1)
    // An editor with nothing to edit opens on a plain click, never a blanked address.
    expect((await observe(page)).lastResult).toBe(
      editable ? null : 'https://example.com/a',
    )
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

const style = (locator: Locator, property: string) =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  )

test('hover, and the ready-to-open look, come from tokens', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await page.addStyleTag({
    content: `#editor {
      --inkkit-link-hover-background: rgb(10, 20, 30);
      --inkkit-link-open-background: rgb(40, 50, 60);
      --inkkit-link-open-underline: line-through;
      --inkkit-link-open-cursor: crosshair;
    }`,
  })
  for (const link of [
    page.getByRole('link', { name: 'Site' }),
    page.getByRole('link', { name: 'Travel plan', exact: true }),
  ]) {
    await page.mouse.move(1, 1)
    await expect
      .poll(() => style(link, 'background-image'))
      .not.toContain('rgb(10, 20, 30)')
    await link.hover()
    await expect
      .poll(() => style(link, 'background-image'))
      .toContain('rgb(10, 20, 30)')
    expect(await style(link, 'cursor')).not.toBe('crosshair')
    await page.keyboard.down('ControlOrMeta')
    await expect
      .poll(() => style(link, 'background-image'))
      .toContain('rgb(40, 50, 60)')
    expect(await style(link, 'text-decoration-line')).toBe('line-through')
    expect(await style(link, 'cursor')).toBe('crosshair')
    await page.keyboard.up('ControlOrMeta')
    await expect
      .poll(() => style(link, 'background-image'))
      .toContain('rgb(10, 20, 30)')
  }
  expect((await observe(page)).snapshot!.text).toBe(source)
})

test('a read-only editor shows the pointer and the ready look on hover alone', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const site = page.getByRole('link', { name: 'Site' })
  const wiki = page.getByRole('link', { name: 'Travel plan', exact: true })
  await operation(page, 'editable', { editable: false })
  await site.hover()
  await expect.poll(() => style(site, 'cursor')).toBe('pointer')
  await wiki.hover()
  await expect.poll(() => style(wiki, 'cursor')).toBe('pointer')
  await operation(page, 'editable', { editable: true })
  await site.hover()
  await expect.poll(() => style(site, 'cursor')).not.toBe('pointer')
})

const hint = (page: Page) => page.locator('#editor .inkkit-link-hint')

test('a link the pointer rests on says how to open it, outside the document', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const site = page.getByRole('link', { name: 'Site' })
  const wiki = page.getByRole('link', { name: 'Travel plan', exact: true })
  await site.hover()
  await expect(hint(page)).toBeVisible()
  await expect(hint(page)).toHaveText(/^(⌘|Ctrl)-click to open$/)
  await expect(hint(page)).toHaveAttribute('role', 'tooltip')
  // It is not part of the text, and it leaves the markup untouched.
  expect(
    await page.locator('#editor .ProseMirror .inkkit-link-hint').count(),
  ).toBe(0)
  await expect(site).not.toHaveAttribute('title', /.+/)
  const link = await site.boundingBox()
  const box = await hint(page).boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(link!.y + link!.height - 1)
  await page.mouse.move(1, 1)
  await expect(hint(page)).toHaveCount(0)

  await wiki.hover()
  await expect(hint(page)).toBeVisible()
  await page.keyboard.down('ControlOrMeta')
  await expect(hint(page)).toHaveCount(0)
  await page.keyboard.up('ControlOrMeta')
  expect((await observe(page)).snapshot!.text).toBe(source)

  await operation(page, 'editable', { editable: false })
  await site.hover()
  await page.waitForTimeout(900)
  await expect(hint(page)).toHaveCount(0)
})

test('a context menu on a link selects it and tells the host', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const site = page.getByRole('link', { name: 'Site' })
  await site.click({ button: 'right' })
  let { lastLinkMenu, textSnapshot } = (await observe(page)) as {
    lastLinkMenu: {
      link: { kind: string; href?: string; text: string; range: unknown }
      point: { clientX: number; clientY: number }
    } | null
    textSnapshot: { selection: unknown } | null
  }
  expect(lastLinkMenu?.link).toMatchObject({
    kind: 'web',
    href: 'https://example.com/a',
    text: 'Site',
    openable: true,
  })
  expect(lastLinkMenu!.point.clientX).toBeGreaterThan(0)
  expect(textSnapshot!.selection).toEqual(lastLinkMenu!.link.range)

  await page
    .getByRole('link', { name: 'Travel plan', exact: true })
    .click({ button: 'right' })
  lastLinkMenu = (await observe(page)).lastLinkMenu as typeof lastLinkMenu
  expect(lastLinkMenu?.link).toMatchObject({
    kind: 'wiki',
    text: 'Travel plan',
  })
  expect((await observe(page)).snapshot!.text).toBe(source)
})
