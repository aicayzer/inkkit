import { createRequire } from 'node:module'
import type { Locator, Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

const axePath = createRequire(import.meta.url).resolve('axe-core')

// Escaped pipes, a pipe in code, a link with a title, a hidden author comment
// and a row written without padding.
const lines = [
  'Intro',
  '',
  '| Name   | Value  |  Note  |',
  '| :----- | -----: | :----: |',
  '| a \\| b | `x\\|y` | [l](u "t") |',
  '| c      | 2      | <!-- c --> |',
  '|  d  |3|e|',
  '',
  'After',
  '',
]
const source = lines.join('\n')
const body = 4

async function open(page: Page, openFixture: () => Promise<void>) {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error')
      warnings.push(message.text())
  })
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await expect(page.locator('.inkkit-table-block td')).toHaveCount(9)
  return warnings
}

const cells = (line: string) =>
  line
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((text) => text.trim())
const saved = async (page: Page) =>
  ((await observe(page)).snapshot?.text ?? '').split('\n')
const cell = (page: Page, row: number, column: number) =>
  page.locator('.inkkit-table-block tr').nth(row).locator('th, td').nth(column)
const control = (page: Page, name: string) =>
  page.locator('.inkkit-table-block').getByRole('button', { name })
const editor = (page: Page) =>
  page.getByRole('textbox', { name: 'Formatted Markdown editor' })

async function visible(locator: Locator) {
  return locator.evaluate(
    (element) =>
      getComputedStyle(element).display !== 'none' &&
      getComputedStyle(element).opacity !== '0' &&
      element.getBoundingClientRect().width > 0,
  )
}

/** Drags a grip by the mouse to a point, in steps, as a person would. */
async function drag(page: Page, grip: Locator, to: { x: number; y: number }) {
  const box = (await grip.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

test('a table draws with borders, padding and no controls until it is used', async ({
  page,
  openFixture,
}) => {
  const warnings = await open(page, openFixture)
  const style = await cell(page, 1, 0).evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      border: computed.borderTopWidth,
      style: computed.borderTopStyle,
      padding: parseFloat(computed.paddingLeft),
    }
  })
  expect(style).toEqual({
    border: '1px',
    style: 'solid',
    padding: style.padding,
  })
  expect(style.padding).toBeGreaterThanOrEqual(6)
  await expect(page.locator('.inkkit-table-controls')).toBeHidden()
  // Vue came in with Milkdown's table block, which InkKit no longer uses.
  expect(warnings.filter((text) => /vue|feature flag/i.test(text))).toEqual([])
})

test('a click in a cell places the caret, so typing adds to the cell', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const target = cell(page, 2, 0).locator('p')
  const box = (await target.boundingBox())!
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2)
  await page.keyboard.type('Z')
  const after = await saved(page)
  expect(cells(after[body + 1]!)).toEqual(['cZ', '2', '<!-- c -->'])
  expect([...after.slice(0, body + 1), ...after.slice(body + 2)]).toEqual([
    ...lines.slice(0, body + 1),
    ...lines.slice(body + 2),
  ])
})

test('the pointer aligns, adds and deletes through the controls and keeps authored rows', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await cell(page, 2, 1).hover()
  const column = control(page, 'Move column')
  const row = control(page, 'Move row')
  expect(await visible(column)).toBe(true)
  expect(await visible(row)).toBe(true)

  await column.click()
  await expect(column).toHaveAttribute('aria-expanded', 'true')
  await control(page, 'Align left').click()
  let after = await saved(page)
  expect(after[3]).toMatch(/^\| :-+ \| :-+ \| :-+: \|$/)
  expect(after.slice(0, 2)).toEqual(lines.slice(0, 2))
  await expect(column).toHaveAttribute('aria-expanded', 'false')

  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await cell(page, 2, 0).hover()
  await row.click()
  await control(page, 'Delete row').click()
  expect(await saved(page)).toEqual([
    ...lines.slice(0, body + 1),
    ...lines.slice(body + 2),
  ])

  await cell(page, 1, 2).hover()
  await row.click()
  await control(page, 'Add row').click()
  after = await saved(page)
  expect(after[body + 1]).toMatch(/^\|(?: +\|){3}$/)
  expect([...after.slice(0, body + 1), ...after.slice(body + 2)]).toEqual([
    ...lines.slice(0, body + 1),
    ...lines.slice(body + 2),
  ])
})

test('dragging a row or column control moves it and keeps every row as authored', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await cell(page, 1, 0).hover()
  const last = (await cell(page, 3, 0).boundingBox())!
  await drag(page, control(page, 'Move row'), {
    x: last.x + 4,
    y: last.y + last.height - 2,
  })
  await expect
    .poll(() => saved(page))
    .toEqual([
      ...lines.slice(0, body),
      lines[body + 1],
      lines[body + 2],
      lines[body],
      ...lines.slice(body + 3),
    ])

  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await cell(page, 1, 2).hover()
  const first = (await cell(page, 0, 0).boundingBox())!
  await drag(page, control(page, 'Move column'), {
    x: first.x + 2,
    y: first.y + 4,
  })
  await expect
    .poll(async () => (await saved(page))[2])
    .toMatch(/^\| +Note +\| Name +\| +Value \|$/)
  const after = await saved(page)
  expect(after[body]).toBe('| [l](u "t") | a \\| b | `x\\|y` |')
  expect(after[body + 1]).toMatch(/^\| <!-- c --> \| c +\| +2 \|$/)
})

test('the keyboard reaches the controls, opens a menu, moves a row and returns to the text', async ({
  page,
  openFixture,
  browserName,
}) => {
  await open(page, openFixture)
  // Safari moves focus to buttons with Option-Tab unless set to Tab to all.
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  await cell(page, 3, 2).click()
  await page.mouse.move(0, 0)
  await page.keyboard.press(next)
  const column = control(page, 'Move column')
  await expect(column).toBeFocused()
  expect(await visible(column)).toBe(true)
  await page.keyboard.press('Enter')
  await expect(column).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press(next)
  await page.keyboard.press(next)
  await page.keyboard.press(next)
  await expect(control(page, 'Align right')).toBeFocused()
  await page.keyboard.press('Space')
  let after = await saved(page)
  expect(after[3]).toMatch(/^\| :-+ \| -+: \| -+: \|$/)
  await expect(editor(page)).toBeFocused()

  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await cell(page, 3, 2).click()
  await page.mouse.move(0, 0)
  await page.keyboard.press(next)
  await page.keyboard.press(next)
  const row = control(page, 'Move row')
  await expect(row).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(row).toBeFocused()
  after = await saved(page)
  expect(after).toEqual([
    ...lines.slice(0, body),
    lines[body + 2],
    lines[body],
    lines[body + 1],
    ...lines.slice(body + 3),
  ])
  await page.keyboard.press('Escape')
  await expect(editor(page)).toBeFocused()
  expect(await saved(page)).toEqual(after)
})

test('a read-only table shows no controls and the keyboard skips them', async ({
  page,
  openFixture,
  browserName,
}) => {
  await open(page, openFixture)
  await cell(page, 3, 2).click()
  await operation(page, 'editable', { editable: false })
  await cell(page, 2, 1).hover()
  await expect(page.locator('.inkkit-table-controls')).toBeHidden()
  await cell(page, 3, 2).click()
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
  await expect(page.locator('.inkkit-table-block button:focus')).toHaveCount(0)
  expect((await observe(page)).snapshot?.text).toBe(source)
})

test('copied HTML and print leave the controls out', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await cell(page, 2, 1).hover()
  await control(page, 'Move column').click()
  await editor(page).focus()
  await page.keyboard.press('ControlOrMeta+A')
  const copied = await page.evaluate(() => {
    const data = new DataTransfer()
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
    return { text: data.getData('text/plain'), html: data.getData('text/html') }
  })
  expect(copied.html).toContain('<table')
  expect(copied.html).not.toMatch(/<button|<svg|Move column|inkkit-table/)
  expect(copied.text).not.toContain('Move column')

  await cell(page, 2, 1).hover()
  await expect(page.locator('.inkkit-table-controls')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.inkkit-table-controls')).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
})

test('axe reports nothing on a table with a menu open', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  await cell(page, 2, 1).hover()
  await control(page, 'Move row').click()
  await expect(control(page, 'Delete row')).toBeVisible()
  await page.addScriptTag({ path: axePath })
  const findings = await page.evaluate(async () => {
    const { axe } = window as unknown as { axe: typeof import('axe-core') }
    const result = await axe.run('.inkkit-root .ProseMirror.editor', {
      rules: { 'color-contrast': { enabled: false } },
    })
    return [...result.violations, ...result.incomplete].map((finding) => ({
      id: finding.id,
      nodes: finding.nodes.map((node) => node.html.slice(0, 120)),
    }))
  })
  expect(findings).toEqual([])
})
