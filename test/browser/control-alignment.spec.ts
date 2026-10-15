import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'

// The geometry a person sees: an icon sits in the middle of its button, and a
// task checkbox sits level with the first line of its text. The checkbox is a
// pseudo-element, so its box comes from computed style.

const table = ['| A | B |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |', ''].join(
  '\n',
)

async function iconOffset(button: Locator) {
  return button.evaluate((element) => {
    const svg = element.querySelector('svg')!.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return {
      x: svg.left + svg.width / 2 - (box.left + box.width / 2),
      y: svg.top + svg.height / 2 - (box.top + box.height / 2),
    }
  })
}

async function expectCentered(button: Locator, name: string) {
  const { x, y } = await iconOffset(button)
  expect(Math.abs(x), `${name} horizontal offset`).toBeLessThanOrEqual(0.5)
  expect(Math.abs(y), `${name} vertical offset`).toBeLessThanOrEqual(0.5)
}

async function setDocument(page: Page, text: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    text,
  )
}

test('table grabbers and menu buttons hold their icon in the middle', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await setDocument(page, table)
  const block = page.locator('.inkkit-table-block')
  await expect(block.locator('td')).toHaveCount(4)
  await block.locator('td').first().hover()
  for (const axis of ['column', 'row']) {
    const grip = block.locator(`.inkkit-table-grip[data-inkkit-axis=${axis}]`)
    await expect(grip).toBeVisible()
    await expectCentered(grip, `${axis} grabber`)
  }
  for (const [name, count] of [
    ['Move column', 5],
    ['Move row', 2],
  ] as const) {
    await block.getByRole('button', { name }).click()
    const menu = block.locator('.inkkit-table-menu:not([hidden])')
    await expect(menu.locator('button')).toHaveCount(count)
    for (const button of await menu.locator('button').all())
      await expectCentered(button, `${name} menu button`)
    await page.keyboard.press('Escape')
  }
})

test('the code block Copy button and the file Open button hold their icon in the middle @linked-files', async ({
  page,
  openFixture,
}) => {
  await openFixture('linked-files')
  await setDocument(page, '```js\nconst a = 1\n```\n\n![[Document#page=1]]\n')
  const copy = page.locator('.inkkit-copy')
  await expect(copy).toHaveCount(1)
  await expectCentered(copy, 'copy button')
  const open = page.getByRole('button', { name: /^Open Document/ })
  await expect(open).toHaveCount(1)
  await expectCentered(open, 'file Open button')
})

// Where the first line of a task item's text sits, and where its checkbox is,
// both measured from the top of the item.
async function geometry(item: Locator) {
  return item.evaluate((li) => {
    const item = li.getBoundingClientRect()
    const box = getComputedStyle(li, '::before')
    const paragraph = li.querySelector(':scope > p')!
    const style = getComputedStyle(paragraph)
    // A line box is the line height; `normal` is measured on a probe that
    // has the paragraph's font.
    let line = parseFloat(style.lineHeight)
    if (Number.isNaN(line)) {
      const probe = document.createElement('div')
      probe.style.cssText = `position:absolute;visibility:hidden;font:${style.font};line-height:normal`
      probe.textContent = 'x'
      document.body.append(probe)
      line = probe.getBoundingClientRect().height
      probe.remove()
    }
    const top = paragraph.getBoundingClientRect().top
    // The box of the first text, when there is some.
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode()
    let glyph: number | null = null
    if (text) {
      const range = document.createRange()
      range.selectNodeContents(text)
      const rect = range.getBoundingClientRect()
      glyph = rect.top + rect.height / 2
    }
    const lineBreak = paragraph.querySelector('br')?.getBoundingClientRect()
    const caret = lineBreak?.height
      ? lineBreak.top + lineBreak.height / 2
      : null
    const checkbox = item.top + parseFloat(box.top) + parseFloat(box.height) / 2
    return {
      checkbox,
      line: top + line / 2,
      glyph,
      caret,
    }
  })
}

const tasks = [
  '- [ ] First',
  '- [x] A long second item that goes on and on and on and on, so that it wraps over several lines in a narrow editor and shows where the box sits against the first line',
  '- [ ] Parent',
  '  - [ ] Child',
  '    - [x] Grandchild',
  '',
  '> - [ ] In a quote',
  '',
  '> [!note]',
  '> - [ ] In a callout',
  '',
  '1. A numbered item',
  '',
  '- [ ] Last',
  '',
].join('\n')

async function expectLevel(page: Page, label: string) {
  const items = page.locator('li[data-item-type="task"]')
  const count = await items.count()
  expect(count, label).toBeGreaterThanOrEqual(9)
  for (let index = 0; index < count; index++) {
    const item = items.nth(index)
    const at = await geometry(item)
    const text = (await item.innerText()).slice(0, 20) || 'empty item'
    expect(
      Math.abs(at.checkbox - at.line),
      `${label}: "${text}" checkbox ${at.checkbox} against line ${at.line}`,
    ).toBeLessThanOrEqual(1)
  }
}

for (const size of [12, 15, 18, 24]) {
  for (const lineHeight of ['normal', '1.5', '2']) {
    test(`task checkboxes sit level with the first line at ${size}px and line height ${lineHeight}`, async ({
      page,
      openFixture,
    }) => {
      await openFixture('everyday')
      await page.addStyleTag({
        content: `#editor { --inkkit-font-size: ${size}px; --inkkit-line-height: ${lineHeight}; }`,
      })
      await setDocument(page, tasks)
      // Enter after the last item makes an empty task item.
      await page
        .locator('li[data-item-type="task"] p', { hasText: 'Last' })
        .click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await expect(page.locator('li[data-item-type="task"]')).toHaveCount(9)
      await expectLevel(page, `${size}px / ${lineHeight}`)
    })
  }
}

test('a checkbox follows the first line of an item typed into an empty task, with the caret level', async ({
  page,
  openFixture,
}) => {
  await openFixture('everyday')
  await page.addStyleTag({
    content: '#editor { --inkkit-font-size: 15px; --inkkit-line-height: 1.2; }',
  })
  await setDocument(page, '- [ ] First\n')
  await page.locator('li[data-item-type="task"] p').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  const items = page.locator('li[data-item-type="task"]')
  await expect(items).toHaveCount(2)
  const empty = items.nth(1)
  const at = await geometry(empty)
  expect(Math.abs(at.checkbox - at.line)).toBeLessThanOrEqual(1)
  // The caret of an empty item has no rectangle of its own in either engine;
  // the break that holds the line open has the height the caret takes.
  expect(at.caret).not.toBeNull()
  expect(Math.abs(at.caret! - at.checkbox)).toBeLessThanOrEqual(1.5)
  await page.keyboard.type('x')
  const typed = await geometry(empty)
  expect(Math.abs(typed.checkbox - typed.line)).toBeLessThanOrEqual(1)
  // The text's own box is centered within 1.5px of the checkbox.
  expect(typed.glyph).not.toBeNull()
  expect(Math.abs(typed.glyph! - typed.checkbox)).toBeLessThanOrEqual(1.5)
})
