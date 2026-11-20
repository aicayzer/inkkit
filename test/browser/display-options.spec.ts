import { test, expect, observe, operation } from './fixtures'
import type { Page } from '@playwright/test'

const outline = [
  '# One',
  '',
  'one body',
  '',
  '## Two',
  '',
  'two body',
  '',
  '# Three',
  '',
  'three body',
  '',
].join('\n')

const load = (page: Page, text: string) =>
  page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md', 'display'),
    text,
  )

async function open(
  page: Page,
  openFixture: () => Promise<void>,
  text: string,
  preferences: Record<string, boolean>,
) {
  await openFixture()
  await load(page, text)
  await operation(page, 'display', { preferences })
}

test('a heading fold control hides its section, names itself and works from the keyboard', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture, outline, { foldHeadings: true })
  const one = page.getByRole('button', { name: 'Fold section One' })
  await expect(one).toHaveAttribute('aria-expanded', 'true')
  await one.click()
  const folded = page.getByRole('button', { name: 'Unfold section One' })
  await expect(folded).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('one body')).toBeHidden()
  await expect(page.getByText('two body')).toBeHidden()
  await expect(page.getByText('three body')).toBeVisible()
  // The folded control stays visible, left of its heading's text.
  await expect(folded).toHaveCSS('opacity', '1')
  const control = (await folded.boundingBox())!
  const heading = (await page.locator('.ProseMirror h1').first().boundingBox())!
  expect(control.x + control.width).toBeLessThanOrEqual(heading.x + 1)
  // Hidden content is not displayed, so it is out of the accessibility tree too.
  await expect(page.locator('.inkkit-folded-content').first()).toHaveCSS(
    'display',
    'none',
  )
  await folded.focus()
  await expect(folded).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('one body')).toBeVisible()
  await page.getByRole('button', { name: 'Fold section One' }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByText('one body')).toBeHidden()
  // Folding is presentation: the document, its revision and its history stay as they were.
  const state = await observe(page)
  expect(state.snapshot!.text).toBe(outline)
  expect(state.snapshot!.dirty).toBe(false)
})

test('a fold never changes the saved text, revision or history', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '# One\r\n\r\nbody\r\n')
  await operation(page, 'display', { preferences: { foldHeadings: true } })
  const before = (await observe(page)).snapshot!
  await page.getByRole('button', { name: 'Fold section One' }).click()
  await page.getByRole('button', { name: 'Unfold section One' }).click()
  const after = (await observe(page)).snapshot!
  expect(after.text).toBe('# One\r\n\r\nbody\r\n')
  expect(after.revision).toBe(before.revision)
  expect(after.dirty).toBe(before.dirty)
})

test('the control is reached by tab from the editor surface', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture, outline, { foldHeadings: true })
  await page.getByRole('textbox', { name: 'Formatted Markdown editor' }).focus()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Fold section One' }),
  ).toBeFocused()
})

test('arrow keys never leave the caret in hidden content', async ({
  page,
  openFixture,
}) => {
  const text = '# One\n\nhidden words\n\n# Two\n\ntail\n'
  await open(page, openFixture, text, { foldHeadings: true })
  await page.getByRole('button', { name: 'Fold section One' }).click()
  await page.locator('.ProseMirror h1').first().click()
  await page.keyboard.press('End')
  const where = () =>
    page.evaluate(() => {
      const selection = getSelection()!
      const node = selection.anchorNode
      const element = node instanceof Element ? node : node?.parentElement
      return {
        block: element?.closest('h1,h2,p')?.textContent,
        hidden: Boolean(element?.closest('.inkkit-folded-content')),
        collapsed: selection.isCollapsed,
      }
    })
  expect(await where()).toEqual({
    block: 'One',
    hidden: false,
    collapsed: true,
  })
  await page.keyboard.press('ArrowDown')
  // The caret passes the folded paragraph and lands in the next visible heading, section still closed.
  expect(await where()).toEqual({
    block: 'Two',
    hidden: false,
    collapsed: true,
  })
  await expect(
    page.getByRole('button', { name: 'Unfold section One' }),
  ).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowUp')
  expect(await where()).toEqual({
    block: 'One',
    hidden: false,
    collapsed: true,
  })
  expect((await observe(page)).snapshot!.text).toBe(text)
})

test('backspace after a folded section opens it instead of deleting what is hidden', async ({
  page,
  openFixture,
}) => {
  const text = '# One\n\nhidden\n\n# Two\n'
  await open(page, openFixture, text, { foldHeadings: true })
  await page.getByRole('button', { name: 'Fold section One' }).click()
  await expect(page.getByText('hidden')).toBeHidden()
  expect(await operation(page, 'find', { text: 'Two' })).toBe(true)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Backspace')
  await expect(page.getByText('hidden')).toBeVisible()
  expect((await observe(page)).snapshot!.text).toBe(text)
})

test('find in a folded section opens it', async ({ page, openFixture }) => {
  await open(page, openFixture, outline, { foldHeadings: true })
  await page.getByRole('button', { name: 'Fold section One' }).click()
  await expect(page.getByText('two body')).toBeHidden()
  expect(await operation(page, 'find', { text: 'two body' })).toBe(true)
  await expect(page.getByText('two body')).toBeVisible()
})

test('folds and controls are not printed', async ({ page, openFixture }) => {
  await open(page, openFixture, outline, { foldHeadings: true })
  await page.getByRole('button', { name: 'Fold section One' }).click()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByText('one body')).toBeVisible()
  await expect(page.locator('.inkkit-heading-fold').first()).toBeHidden()
})

const long = 'word '.repeat(80).trim()

test('line numbers sit beside the first line of each text line, with and without wrapping', async ({
  page,
  openFixture,
}) => {
  const text = `\`\`\`js\nfirst\n${long}\nlast\n\`\`\`\n`
  await open(page, openFixture, text, { codeLineNumbers: true })
  const geometry = () =>
    page.evaluate(() => {
      const code = document.querySelector('.ProseMirror pre > code')!
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, {
        // The language control's label is not part of the code.
        acceptNode: (node) =>
          node.parentElement?.closest('.inkkit-code-controls')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      })
      const chars: {
        top: number
        bottom: number
        left: number
        text: string
      }[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.textContent ?? ''
        for (let i = 0; i < value.length; i++) {
          const range = document.createRange()
          range.setStart(node, i)
          range.setEnd(node, i + 1)
          const rect = range.getClientRects()[0]
          if (rect)
            chars.push({
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              text: value[i]!,
            })
        }
      }
      const numbers = [
        ...document.querySelectorAll<HTMLElement>('.inkkit-line-number'),
      ].map((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        // The number is drawn on the entry's first line, and a wrapped line makes the entry taller.
        const lineHeight =
          Number.parseFloat(style.lineHeight) ||
          Number.parseFloat(style.fontSize) * 1.5
        return {
          line: element.getAttribute('data-inkkit-line'),
          top: rect.top,
          bottom: rect.top + lineHeight,
          right: rect.left + Number.parseFloat(style.paddingInlineStart),
        }
      })
      // The first character of each text line, found after each newline.
      const flat = chars.map((char) => char.text).join('')
      const starts = [0, ...[...flat.matchAll(/\n/g)].map((m) => m.index + 1)]
      return {
        numbers,
        starts: starts.map((index) => chars[index]).filter(Boolean),
        longLeft: chars[flat.indexOf('word')]!.left,
        // Left edges of every character that begins a visual line in the long line.
        continuation: (() => {
          const from = flat.indexOf('word')
          const to = from + 399
          const lefts = new Set<number>()
          let top = chars[from]!.top
          for (let i = from; i < to; i++) {
            if (chars[i]!.top > top + 2) {
              top = chars[i]!.top
              lefts.add(Math.round(chars[i]!.left))
            }
          }
          return [...lefts]
        })(),
      }
    })
  for (const wrapped of [false, true]) {
    if (wrapped) {
      await page.locator('.ProseMirror pre').hover()
      await page.getByRole('button', { name: 'Code language' }).click()
      await page.getByRole('button', { name: 'Wrap code' }).click()
      await page.keyboard.press('Escape')
      await expect(page.locator('.ProseMirror pre')).toHaveClass(
        /inkkit-code-wrapped/,
      )
    }
    const { numbers, starts, longLeft, continuation } = await geometry()
    expect(numbers.map((number) => number.line)).toEqual(['1', '2', '3'])
    // Each number is level with the first visual line of its text line.
    for (const [index, number] of numbers.entries()) {
      const start = starts[index]!
      const middle = (number.top + number.bottom) / 2
      expect(middle).toBeGreaterThan(start.top - 2)
      expect(middle).toBeLessThan(start.bottom + 2)
      expect(number.right).toBeLessThanOrEqual(start.left + 0.5)
    }
    if (wrapped) {
      // The long line wrapped, so a continuation line exists and aligns with its first line.
      expect(continuation.length).toBeGreaterThan(0)
      expect(continuation.every((left) => Math.abs(left - longLeft) <= 1)).toBe(
        true,
      )
    }
  }
})

test('line numbers stay beside their lines after a font change with no edit and no resize', async ({
  page,
  openFixture,
}) => {
  const longer = 'word '.repeat(300).trim()
  const text = `\`\`\`\nfirst\n${longer}\nmiddle ${long}\nlast\n\`\`\`\n`
  await open(page, openFixture, text, { codeLineNumbers: true })
  await page.locator('.ProseMirror pre').hover()
  await page.getByRole('button', { name: 'Code language' }).click()
  await page.getByRole('button', { name: 'Wrap code' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ProseMirror pre')).toHaveClass(
    /inkkit-code-wrapped/,
  )
  /** How far each entry starts above the first character of its text line. */
  const offsets = () =>
    page.evaluate(() => {
      const code = document.querySelector('.ProseMirror pre > code')!
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest('.inkkit-code-controls')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      })
      const tops: number[] = []
      let starting = true
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = node.textContent ?? ''
        for (let at = 0; at < data.length; at++) {
          if (starting) {
            const range = document.createRange()
            range.setStart(node, at)
            range.setEnd(node, at + 1)
            tops.push(range.getClientRects()[0]!.top)
            starting = false
          }
          if (data[at] === '\n') starting = true
        }
      }
      const entries = [
        ...document.querySelectorAll<HTMLElement>('.inkkit-line-number'),
      ]
      const box = code.getBoundingClientRect()
      return {
        gaps: entries.map(
          (entry, index) =>
            Math.round(
              (entry.getBoundingClientRect().top - tops[index]!) * 10,
            ) / 10,
        ),
        // The line's own height shows whether the swap changed where lines break.
        heights: entries.map((entry) =>
          Math.round(entry.getBoundingClientRect().height),
        ),
        box: [Math.round(box.width), Math.round(box.height)],
      }
    })
  const before = await offsets()
  expect(before.gaps).toHaveLength(4)
  // The gap is the line's half-leading, the same for every line when the numbers are level.
  const level = (gaps: number[]) =>
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1.5)
  level(before.gaps)
  await page.locator('.inkkit-root').evaluate((root) => {
    root.style.setProperty('--inkkit-monospace-font', 'serif')
  })
  await expect(page.locator('.ProseMirror pre > code')).toHaveCSS(
    'font-family',
    'serif',
  )
  // The swap reflows the wrapped lines with no edit and no change to the box's width.
  await expect
    .poll(async () => (await offsets()).heights)
    .not.toEqual(before.heights)
  const after = await offsets()
  // The start margin is in `ch`, so the width moves by a pixel or two with the font and no more.
  expect(Math.abs(after.box[0]! - before.box[0]!)).toBeLessThanOrEqual(2)
  level(after.gaps)
})

test('line numbers are not copied, selected or printed', async ({
  page,
  openFixture,
}) => {
  const text = 'Before\n\n```\na\nb\n```\n'
  await open(page, openFixture, text, { codeLineNumbers: true })
  await expect(page.locator('.inkkit-line-number')).toHaveCount(2)
  await page.locator('.ProseMirror pre code').click()
  await page.keyboard.press('ControlOrMeta+A')
  const copied = await page.evaluate(() => {
    const data = new DataTransfer()
    document.querySelector('.inkkit-root .ProseMirror')!.dispatchEvent(
      new ClipboardEvent('copy', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
    return {
      text: data.getData('text/plain'),
      html: data.getData('text/html'),
    }
  })
  expect(copied.text).toContain('a\nb')
  expect(copied.text).not.toMatch(/[12]/)
  expect(copied.html).not.toContain('inkkit-line-number')
  expect((await observe(page)).snapshot!.text).toBe(text)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.inkkit-line-number').first()).toBeHidden()
  await expect(page.locator('.ProseMirror pre > code')).toHaveCSS(
    'margin-inline-start',
    '0px',
  )
})

test('the line number color follows its token', async ({
  page,
  openFixture,
}) => {
  await open(page, openFixture, '```\na\n```\n', { codeLineNumbers: true })
  await page.locator('.inkkit-root').evaluate((root) => {
    root.style.setProperty('--inkkit-code-line-number', 'rgb(10, 120, 30)')
  })
  const color = await page
    .locator('.inkkit-line-number')
    .first()
    .evaluate((element) => getComputedStyle(element, '::before').color)
  expect(color).toBe('rgb(10, 120, 30)')
})
