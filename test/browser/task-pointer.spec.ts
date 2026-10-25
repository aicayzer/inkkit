import type { Locator } from '@playwright/test'
import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

async function marker(item: Locator) {
  return item.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const box = getComputedStyle(element, '::before')
    return {
      x: rect.x + parseFloat(box.left) + parseFloat(box.width) / 2,
      y: rect.y + parseFloat(box.top) + parseFloat(box.height) / 2,
    }
  })
}

const source = 'Before café\r\n\r\n* [ ] First task\r\n* [x] Second task\r\n'

test('toggling a task preserves the writing caret and source outside its marker', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await caretAfterMatch(page, 'café')
  const before = (await observe(page)).textSnapshot!.selection
  const point = await marker(page.locator('li[data-item-type="task"]').first())
  await page.mouse.click(point.x, point.y)
  await expect
    .poll(async () => (await observe(page)).snapshot!.text)
    .toBe(source.replace('[ ]', '[x]'))
  const after = (await observe(page)).textSnapshot!.selection
  expect({ from: after.from, to: after.to }).toEqual({
    from: before.from,
    to: before.to,
  })
  await page.keyboard.type('!')
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('café', 'café!').replace('[ ]', '[x]'),
  )
  await operation(page, 'undo')
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(source)
})

test('toggling a task does not steal focus from a host input', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'host-input'
    document.body.prepend(input)
    input.focus()
  })
  const point = await marker(page.locator('li[data-item-type="task"]').first())
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('#host-input')).toBeFocused()
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('[ ]', '[x]'),
  )
})

test('a checked item keeps a selected range and clicking its text does not toggle it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await operation(page, 'find', { text: 'café' })
  const before = (await observe(page)).textSnapshot!.selection
  const item = page.locator('li[data-item-type="task"]').nth(1)
  const point = await marker(item)
  await page.mouse.click(point.x, point.y)
  const after = (await observe(page)).textSnapshot!.selection
  expect({ from: after.from, to: after.to }).toEqual({
    from: before.from,
    to: before.to,
  })
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('[x]', '[ ]'),
  )
  await item.locator('p').click()
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('[x]', '[ ]'),
  )
})

test('a gap beside a table hides the native text caret and typing restores it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument(
      '| A | B |\n| - | - |\n| 1 | 2 |\n',
      'md',
    ),
  )
  const table = page.locator('.ProseMirror table')
  const rect = (await table.boundingBox())!
  await page.mouse.click(rect.x + 2, rect.y + rect.height + 12)
  const editor = page.locator('#editor .ProseMirror')
  await expect(editor).toHaveClass(/ProseMirror-hideselection/)
  await expect(page.locator('.ProseMirror-gapcursor')).toHaveCSS(
    'display',
    'block',
  )
  expect(
    await page
      .locator('.ProseMirror-gapcursor')
      .evaluate((e) => getComputedStyle(e, '::after').borderTopWidth),
  ).toBe('2px')
  await expect(editor).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)')
  await page.keyboard.type('After')
  await expect(editor).not.toHaveClass(/ProseMirror-hideselection/)
  await expect(editor).not.toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)')
  expect((await observe(page)).snapshot!.text).toContain('\n\nAfter')
})

test('table drag grips show a grab pointer', async ({ page, openFixture }) => {
  await openFixture()
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument(
      '| A | B |\n| - | - |\n| 1 | 2 |\n',
      'md',
    ),
  )
  await page.locator('#editor td').first().hover()
  for (const axis of ['row', 'column']) {
    const grip = page.locator(`.inkkit-table-grip[data-inkkit-axis="${axis}"]`)
    await expect(grip).toBeVisible()
    await expect(grip).toHaveCSS('cursor', 'grab')
  }
})

test('nested tasks toggle only their own marker and read-only clicks change nothing', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const text = '- [ ] Parent\n  - [ ] Child 🐈\n'
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    text,
  )
  const point = await marker(page.locator('li[data-item-type="task"]').nth(1))
  await page.mouse.click(point.x, point.y)
  const expected = text.replace('[ ] Child', '[x] Child')
  expect((await observe(page)).snapshot!.text).toBe(expected)
  await operation(page, 'editable', { editable: false })
  await page.mouse.click(point.x, point.y)
  expect((await observe(page)).snapshot!.text).toBe(expected)
})
