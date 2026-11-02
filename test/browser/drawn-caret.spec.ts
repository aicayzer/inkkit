import { test, expect, operation } from './fixtures'
import type { Page } from '@playwright/test'

const paragraph =
  'It recently came to my attention that a site of mine did not have the right stuff in place for agents. Can you look at my companies-house.uk website and ensure that it does have the right stuff in place? Also, can you make the other address redirect to it?'

interface Line {
  top: number
  bottom: number
  left: number
  right: number
  start: number
  end: number
}

// A loose line height, as hosts set, and a narrow column so the paragraph wraps.
async function open(
  page: Page,
  openFixture: (fixture?: string, query?: string) => Promise<void>,
  query = '',
) {
  await openFixture('everyday', query)
  await page.addStyleTag({
    content:
      '.inkkit-root { --inkkit-line-height: 1.55; --inkkit-reading-width: 360px }',
  })
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    `${paragraph}\n\nAfter.\n`,
  )
  // Room for the whole editor, so the page never scrolls and the measured lines stay put.
  await page.setViewportSize({ width: 1280, height: 1400 })
  await page
    .locator('.inkkit-root .ProseMirror p')
    .first()
    .evaluate((p) => p.scrollIntoView({ block: 'center', behavior: 'instant' }))
}

/** The visual lines of the first paragraph, from its characters' rectangles. */
const lines = (page: Page) =>
  page
    .locator('.inkkit-root .ProseMirror p')
    .first()
    .evaluate((p): Line[] => {
      const text = p.firstChild as Text
      const range = document.createRange()
      const out: Line[] = []
      for (let i = 0; i < text.length; i++) {
        range.setStart(text, i)
        range.setEnd(text, i + 1)
        const rect = [...range.getClientRects()].find((r) => r.width > 0)
        if (!rect) continue
        const line = out.find((l) => Math.abs(l.top - rect.top) < 2)
        if (line) {
          line.end = i
          line.right = Math.max(line.right, rect.right)
        } else
          out.push({
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            start: i,
            end: i,
          })
      }
      return out
    })

const bar = (page: Page) =>
  page.locator('.inkkit-caret').evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left + rect.width / 2,
      shown: style.display !== 'none' && style.visibility !== 'hidden',
      colour: style.backgroundColor,
    }
  })

const surface = (page: Page) =>
  page.locator('.inkkit-root .ProseMirror').evaluate((node) => ({
    drawn: node.classList.contains('inkkit-drawn-caret'),
    caretColor: getComputedStyle(node).caretColor,
  }))

/** Waits until the bar stands on `line`, at `x` when given. */
async function expectOn(page: Page, line: Line, x?: number) {
  await expect
    .poll(async () => {
      const b = await bar(page)
      return (
        b.shown &&
        Math.abs(b.top - line.top) <= 1 &&
        Math.abs(b.bottom - line.bottom) <= 1 &&
        (x === undefined || Math.abs(b.left - x) <= 2)
      )
    })
    .toBe(true)
}

async function expectNative(page: Page) {
  await expect
    .poll(async () => {
      const state = await surface(page)
      const b = await bar(page)
      return !state.drawn && !b.shown
    })
    .toBe(true)
  expect((await surface(page)).caretColor).toBe('rgb(0, 105, 209)')
}

const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
const documentEnd =
  process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'

/**
 * Which line the engine's own caret is on at a soft wrap: extending to the line start moves
 * only from the end of the upper line. Collapsing back resets the engine's choice, so call this
 * last before a click.
 */
const engineOnUpperLine = (page: Page) =>
  page.evaluate(() => {
    const selection = getSelection()!
    const node = selection.focusNode!
    const offset = selection.focusOffset
    selection.modify('extend', 'backward', 'lineboundary')
    const moved =
      selection.focusNode !== node || selection.focusOffset !== offset
    selection.collapse(node, offset)
    return moved
  })

test('the caret is the height of the text on the first and on wrapped lines', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const wrapped = await lines(page)
  expect(wrapped.length).toBeGreaterThanOrEqual(3)
  // The engine's own caret on a wrapped line would start at the previous line's text.
  for (const line of wrapped.slice(0, 3)) {
    await page.mouse.click(
      (line.left + line.right) / 2,
      (line.top + line.bottom) / 2,
    )
    await expectOn(page, line)
  }
  expect(await surface(page)).toEqual({
    drawn: true,
    caretColor: 'rgba(0, 0, 0, 0)',
  })
  const drawn = await bar(page)
  expect(drawn.colour).toBe('rgb(0, 105, 209)')
  // Moving by keyboard keeps it on the text.
  await page.keyboard.press('ArrowUp')
  await expectOn(page, wrapped[1]!)
})

test('at a soft wrap the caret stands on the line the input chose', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const [first, second] = await lines(page)
  const box = (await page.locator('.inkkit-root .ProseMirror').boundingBox())!
  const middleOfFirst = () =>
    page.mouse.click(
      (first!.left + first!.right) / 2,
      (first!.top + first!.bottom) / 2,
    )
  // Past the end of the first line: the end of that line, not the start of the next.
  await page.mouse.click(
    box.x + box.width - 4,
    (first!.top + first!.bottom) / 2,
  )
  await expectOn(page, first!)
  expect(await engineOnUpperLine(page)).toBe(true)
  // Before the start of the second line: the same position, drawn on the second line.
  await page.mouse.click(second!.left - 2, (second!.top + second!.bottom) / 2)
  await expectOn(page, second!, second!.left)
  expect(await engineOnUpperLine(page)).toBe(false)
  // The line-end command from the middle of the first line.
  await middleOfFirst()
  await page.keyboard.press(lineEnd)
  await expectOn(page, first!)
  expect(await engineOnUpperLine(page)).toBe(true)
  // Down from the start of the first line lands on the start of the second.
  await middleOfFirst()
  await page.keyboard.press(lineStart)
  await expectOn(page, first!, first!.left)
  await page.keyboard.press('ArrowDown')
  await expectOn(page, second!, second!.left)
  expect(await engineOnUpperLine(page)).toBe(false)
})

test('the engine caret returns where the drawn caret cannot stand in', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture)
  const [first] = await lines(page)
  // Each click lands somewhere new, so the engine doesn't count a double or triple click.
  let clicks = 0
  const clickFirstLine = () =>
    page.mouse.click(
      first!.left + 20 + 25 * clicks++,
      (first!.top + first!.bottom) / 2,
    )
  await clickFirstLine()
  await expectOn(page, first!)

  // A range selection.
  await page.keyboard.press('Shift+ArrowRight')
  await expectNative(page)
  await page.keyboard.press('ArrowLeft')
  await expectOn(page, first!)

  // Composition: the input method's marked text keeps the engine caret.
  await page
    .locator('.inkkit-root .ProseMirror')
    .evaluate((node) =>
      node.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true, data: '' }),
      ),
    )
  await expectNative(page)
  await page
    .locator('.inkkit-root .ProseMirror')
    .evaluate((node) =>
      node.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '' }),
      ),
    )
  await expectOn(page, first!)

  // An empty block: the engine's caret already matches its line.
  await page.keyboard.press(documentEnd)
  await page.keyboard.press('Enter')
  await expectNative(page)

  await clickFirstLine()
  await expectOn(page, first!)
  await operation(page, 'blur')
  await expect.poll(async () => (await bar(page)).shown).toBe(false)

  await clickFirstLine()
  await expectOn(page, first!)
  await operation(page, 'editable', { editable: false })
  await expect.poll(async () => (await surface(page)).drawn).toBe(false)
  await expect.poll(async () => (await bar(page)).shown).toBe(false)
  await operation(page, 'editable', { editable: true })

  await clickFirstLine()
  await expectOn(page, first!)
  expect(await operation(page, 'editingMode', { mode: 'source' })).toBe(true)
  await expect.poll(async () => (await bar(page)).shown).toBe(false)
})

test('rendering.drawnCaret false keeps the engine caret', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture, '&drawnCaret=false')
  const [first] = await lines(page)
  await page.mouse.click(
    (first!.left + first!.right) / 2,
    (first!.top + first!.bottom) / 2,
  )
  await expect(page.locator('.inkkit-caret')).toHaveCount(0)
  expect(await surface(page)).toEqual({
    drawn: false,
    caretColor: 'rgb(0, 105, 209)',
  })
})
