import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Places the caret before or after `marker` in the readable text.
async function caret(page: Page, marker: string, after: boolean) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(marker) + (after ? marker.length : 0)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

const editor = (page: Page) =>
  page.getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })

// [what, source, caret after, whether after (or before) it, text, saved]
const chunks: [string, string, string, boolean, string, string][] = [
  [
    'a URL and a space',
    'Plain words here\n',
    'Plain ',
    true,
    'https://example.com ',
    'Plain https://example.com words here\n',
  ],
  [
    'a URL and a space at the end of a block after another block',
    'First line\n\nSecond\n',
    'Second',
    true,
    ' see https://example.com ',
    'First line\n\nSecond see <https://example.com>&#x20;\n',
  ],
  [
    'strong emphasis',
    'Plain words here\n',
    'Plain ',
    true,
    '**x**',
    'Plain **x**words here\n',
  ],
  [
    'strong emphasis after another block',
    'First line\n\nSecond words\n',
    'Second ',
    true,
    '**x**',
    'First line\n\nSecond **x**words\n',
  ],
  [
    'strikethrough',
    'Plain words here\n',
    'Plain ',
    true,
    '~~x~~',
    'Plain ~~x~~words here\n',
  ],
  [
    'strikethrough after another block',
    'First line\n\nSecond words\n',
    'Second ',
    true,
    '~~x~~',
    'First line\n\nSecond ~~x~~words\n',
  ],
  [
    'emphasis and a space',
    'Plain words here\n',
    'Plain ',
    true,
    '*x* ',
    'Plain \\*x\\* words here\n',
  ],
  [
    'a heading marker inside a line',
    'Plain words here\n',
    'Plain ',
    true,
    '# ',
    'Plain # words here\n',
  ],
  [
    'a heading marker at the start of a block after another block',
    'First line\n\nSecond words\n',
    'Second',
    false,
    '# ',
    'First line\n\n# Second words\n',
  ],
]

for (const [route, insert] of [
  // Text the browser inserts in one piece, as dictation and text
  // replacements do.
  [
    'browser text input',
    (page: Page, text: string) => page.keyboard.insertText(text),
  ],
  [
    'insertText',
    (page: Page, text: string) => operation(page, 'insertText', { text }),
  ],
] as const)
  for (const [name, source, marker, after, text, saved] of chunks)
    test(`${route} with ${name} inserts exactly its text @preservation`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      await operation(page, 'reload', { text: source })
      await caret(page, marker, after)
      await insert(page, text)
      let observed = await observe(page)
      expect(observed.diagnostics).toEqual([])
      expect(observed.snapshot!.text).toBe(saved)
      await operation(page, 'undo')
      observed = await observe(page)
      expect(observed.diagnostics).toEqual([])
      expect(observed.snapshot!.text).toBe(source)
    })

test('Enter after a bare URL at the end of a paragraph starts a new paragraph @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'See https://example.com\n' })
  await caret(page, 'example.com', true)
  await page.keyboard.press('Enter')
  await page.keyboard.type('next')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('See https://example.com\n\nnext\n')
  await expect(editor(page).locator('a')).toHaveCount(1)
  await expect(editor(page).locator('a')).toHaveAttribute(
    'href',
    'https://example.com',
  )
})

test('Enter after a URL in the middle of a line splits the paragraph there @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'See https://example.com today\n' })
  await caret(page, 'example.com', true)
  await page.keyboard.press('Enter')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe(
    'See https://example.com\n\n&#x20;today\n',
  )
  await expect(editor(page).locator('a')).toHaveText('https://example.com')
})

for (const [name, source, marker] of [
  ['a URL', 'See https://example.com today\n', 'example.com'],
  ['a word', 'See example today\n', 'example'],
] as const)
  test(`Enter after ${name} in the middle of a line, then Backspace, restores the text exactly @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    await caret(page, marker, true)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Backspace')
    const observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(source)
  })

test('Enter inside an inline code span keeps the code text @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'Run `foo  bar` now\n' })
  await caret(page, 'foo', true)
  await page.keyboard.press('Enter')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Run `foo`\n\n`  bar` now\n')
})

test('browser text input after Select All inserts exactly its text @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', {
    text: 'First words here\n\nSecond words there\n',
  })
  await caret(page, 'First', true)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('**x**')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  // The browser replaces the whole document itself, so no input rule runs.
  expect(observed.snapshot!.text).toBe('\\*\\*x\\*\\*\n')
})

test('Enter inside a URL splits the paragraph there and keeps both parts @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'See https://example.com today\n' })
  await caret(page, 'https://examp', true)
  await page.keyboard.press('Enter')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('See https://examp\n\nle.com today\n')
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(
    'See https://example.com today\n',
  )
})
