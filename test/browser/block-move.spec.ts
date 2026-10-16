import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Places the caret before `marker` in the readable text.
async function caret(page: Page, marker: string) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(marker)
  expect(at).toBeGreaterThanOrEqual(0)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

async function saved(page: Page): Promise<string> {
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  return observed.snapshot!.text
}

// Saves the text, reopens it and checks that it reads back as the same text.
async function reopens(page: Page, text: string) {
  await operation(page, 'reload', { text })
  expect(await saved(page)).toBe(text)
}

// [what, source, caret marker, keys, saved]
const moves: [string, string, string, string[], string][] = [
  [
    'a paragraph moves up past a table',
    'Intro\r\n\r\n| a | b |\r\n|:--|--:|\r\n| 1 | 2 |\r\n\r\nLast __words__  \r\nend\r\n',
    'Last',
    ['Alt+ArrowUp'],
    'Intro\r\n\r\nLast __words__  \r\nend\r\n\r\n| a | b |\r\n|:--|--:|\r\n| 1 | 2 |\r\n',
  ],
  [
    'a list item keeps its marker and continuation',
    '*   one\n*   two  \n    cont\n*   three\n',
    'one',
    ['Alt+ArrowDown'],
    '*   two  \n    cont\n*   one\n*   three\n',
  ],
  [
    'an ordered item takes the number at its new place',
    '1. one\n2. two\n3. three\n',
    'three',
    ['Alt+ArrowUp', 'Alt+ArrowUp'],
    '1. three\n2. one\n3. two\n',
  ],
  [
    'an item takes its sublist with it',
    '- [ ] one\n  - sub a\n  - sub b\n- [x] two\n',
    'one',
    ['Alt+ArrowDown'],
    '- [x] two\n- [ ] one\n  - sub a\n  - sub b\n',
  ],
  [
    'a sublist item stays in its sublist',
    '- one\n  - sub a\n  - sub b\n- two\n',
    'sub b',
    ['Alt+ArrowUp', 'Alt+ArrowUp'],
    '- one\n  - sub b\n  - sub a\n- two\n',
  ],
  [
    'a block in a callout stays below its title',
    '> [!NOTE] Title\n> a\n>\n> b *em*\n\nAfter\n',
    'b',
    ['Alt+ArrowUp', 'Alt+ArrowUp'],
    '> [!NOTE] Title\n> b *em*\n>\n> a\n\nAfter\n',
  ],
  [
    'a block in a quote stays in the quote',
    'Before\n\n> a\n>\n> b\n',
    'a',
    ['Alt+ArrowDown', 'Alt+ArrowDown'],
    'Before\n\n> b\n>\n> a\n',
  ],
]

for (const [what, source, marker, keys, expected] of moves)
  test(`${what} @preservation`, async ({ page, openFixture }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    await caret(page, marker)
    for (const key of keys) await page.keyboard.press(key)
    // The caret stays at the start of the moved text.
    await page.keyboard.type('X')
    const typed = await saved(page)
    expect(typed.replace('X', '')).toBe(expected)
    expect(typed.indexOf(`X${marker}`)).toBe(expected.indexOf(marker))
    await page.keyboard.press('ControlOrMeta+z')
    expect(await saved(page)).toBe(expected)
    await reopens(page, expected)
  })

test('a move is one undo step and redo moves again @preservation', async ({
  page,
  openFixture,
}) => {
  const source = 'A\r\n\r\nB  \r\nb\r\n\r\nC\r\n'
  await openFixture()
  await operation(page, 'reload', { text: source })
  await caret(page, 'C')
  await page.keyboard.press('Alt+ArrowUp')
  await page.keyboard.press('Alt+ArrowUp')
  const moved = 'C\r\n\r\nA\r\n\r\nB  \r\nb\r\n'
  expect(await saved(page)).toBe(moved)
  await page.keyboard.press('ControlOrMeta+z')
  expect(await saved(page)).toBe('A\r\n\r\nC\r\n\r\nB  \r\nb\r\n')
  await page.keyboard.press('ControlOrMeta+z')
  const restored = await observe(page)
  expect(restored.snapshot).toMatchObject({ text: source, dirty: false })
  await page.keyboard.press('Shift+ControlOrMeta+z')
  expect(await saved(page)).toBe('A\r\n\r\nC\r\n\r\nB  \r\nb\r\n')
})

test('a selection across blocks moves them together', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'A\n\nB\n\nC\n\nD\n' })
  await caret(page, 'B')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  // The editor reads the selection the keys made before the next key.
  await expect
    .poll(async () => {
      await operation(page, 'textSnapshot')
      const { selection } = (await observe(page)).textSnapshot!
      return selection.to - selection.from
    })
    .toBeGreaterThan(1)
  await page.keyboard.press('Alt+ArrowDown')
  expect(await saved(page)).toBe('A\n\nD\n\nB\n\nC\n')
  await page.keyboard.press('Alt+ArrowDown')
  expect(await saved(page)).toBe('A\n\nD\n\nB\n\nC\n')
})

test('in a table cell the key is left to the web view', async ({
  page,
  openFixture,
}) => {
  const source = 'P\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n'
  await openFixture()
  await operation(page, 'reload', { text: source })
  await caret(page, '3')
  await page.keyboard.press('Alt+ArrowUp')
  expect((await observe(page)).snapshot).toMatchObject({
    text: source,
    dirty: false,
  })
  // A host that gives the row moves these keys gets them in a table.
  await operation(page, 'keymap', {
    keymap: { tableMoveRowUp: ['Alt-ArrowUp'] },
  })
  await caret(page, '3')
  await page.keyboard.press('Alt+ArrowUp')
  expect(await saved(page)).toBe(
    'P\n\n| a | b |\n|---|---|\n| 3 | 4 |\n| 1 | 2 |\n',
  )
})

test('a block neither move reaches keeps its bytes beside a moved copy @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', {
    text: '__same__\n\nB\n\n**same**\n\nC\n\nD\n',
  })
  await caret(page, 'same')
  await page.keyboard.press('Alt+ArrowDown')
  await caret(page, 'C')
  await page.keyboard.press('Alt+ArrowDown')
  const expected = 'B\n\n__same__\n\n**same**\n\nD\n\nC\n'
  expect(await saved(page)).toBe(expected)
  await reopens(page, expected)
})

test('an item whose source would nest under its new neighbor still moves @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: '-   alpha\n  - beta\n' })
  await caret(page, 'alpha')
  await page.keyboard.press('Alt+ArrowDown')
  const expected = '-   beta\n  - alpha\n'
  expect(await saved(page)).toBe(expected)
  await reopens(page, expected)
})

test('an undone move leaves the end of the note as it was @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  for (const [source, expected] of [
    ['A\n\nB\n\nC', 'A\n\nC'],
    ['A\n\nB\n\nC\n\n\n', 'A\n\nC\n\n\n'],
  ] as const) {
    await operation(page, 'reload', { text: source })
    await caret(page, 'C')
    await page.keyboard.press('Alt+ArrowUp')
    await page.keyboard.press('ControlOrMeta+z')
    expect(await saved(page)).toBe(source)
    // Deletes B: its letter, then its empty paragraph.
    await caret(page, 'B')
    await page.keyboard.press('Shift+ArrowRight')
    await expect
      .poll(async () => {
        await operation(page, 'textSnapshot')
        const { text, selection } = (await observe(page)).textSnapshot!
        return text.slice(selection.from, selection.to)
      })
      .toBe('B')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    expect(await saved(page)).toBe(expected)
  }
})

test('a move of blocks that read alike is saved at once @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', {
    text: 'Heading\n===\n\n# Heading\n\nTail\n',
  })
  await caret(page, 'Heading')
  await page.keyboard.press('Alt+ArrowDown')
  const expected = '# Heading\n\nHeading\n===\n\nTail\n'
  expect((await observe(page)).snapshot).toMatchObject({
    text: expected,
    dirty: true,
  })
  await reopens(page, expected)
})
