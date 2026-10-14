import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Comments start hidden, drawn `display: none`. Browsers delete a hidden
// element beside a deleted character, which jsdom does not reproduce, so
// these use real key presses.

const mac = process.platform === 'darwin'

async function open(page: Page, source: string) {
  await operation(page, 'replaceSource', { text: source })
  await expect
    .poll(async () => (await observe(page)).snapshot?.text)
    .toBe(source)
}

// Offsets count readable text, which leaves comments out.
async function select(page: Page, from: number, to = from) {
  await operation(page, 'textSnapshot')
  const { snapshotId } = (await observe(page)).lastResult as {
    snapshotId: string
  }
  await operation(page, 'selectTextRange', {
    range: { snapshotId, from, to },
    options: { focus: true },
  })
}

async function press(page: Page, keys: string[]) {
  for (const key of keys)
    if (key.length === 1) await page.keyboard.type(key)
    else await page.keyboard.press(key)
}

// Extends the selection one key press at a time until it reaches a readable offset.
async function extend(page: Page, key: string, offset: number) {
  for (let presses = 0; presses < 20; presses++) {
    await operation(page, 'textSnapshot')
    const { selection } = (await observe(page)).lastResult as {
      selection: { from: number; to: number }
    }
    if (selection.from === offset || selection.to === offset) return
    await page.keyboard.press(key)
  }
  throw Error(`The selection did not reach ${offset}`)
}

const saved = async (page: Page) => (await observe(page)).snapshot?.text

async function expectSaved(page: Page, text: string) {
  await expect.poll(() => saved(page)).toBe(text)
  expect((await observe(page)).diagnostics).toEqual([])
}

const inline = 'Inline <!-- secret --> here.\n'
const obsidian = 'Inline %%secret%% here.\n'
const beside: [string, number, string, string][] = [
  [inline, 7, 'Delete', 'Inline <!-- secret -->here.\n'],
  [inline, 8, 'Backspace', 'Inline <!-- secret -->here.\n'],
  [inline, 6, 'Delete', 'Inline<!-- secret --> here.\n'],
  [inline, 7, 'Backspace', 'Inline<!-- secret --> here.\n'],
  [obsidian, 7, 'Delete', 'Inline %%secret%%here.\n'],
  [obsidian, 8, 'Backspace', 'Inline %%secret%%here.\n'],
  [obsidian, 6, 'Delete', 'Inline%%secret%% here.\n'],
  [obsidian, 7, 'Backspace', 'Inline%%secret%% here.\n'],
  [
    'a <!-- one --><!-- two --> b\n',
    3,
    'Backspace',
    'a <!-- one --><!-- two -->b\n',
  ],
  [
    'a <!-- one --><!-- two --> b\n',
    2,
    'Delete',
    'a <!-- one --><!-- two -->b\n',
  ],
  ['Emoji 👍🏽<!-- c --> end\n', 10, 'Backspace', 'Emoji <!-- c --> end\n'],
]

for (const [source, offset, key, expected] of beside)
  test(`${key} at ${offset} beside a hidden comment in ${JSON.stringify(source)} keeps it @smoke`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, source)
    await select(page, offset)
    await press(page, [key])
    await expectSaved(page, expected)
    await press(page, ['ControlOrMeta+z'])
    await expect.poll(() => saved(page)).toBe(source)
  })

test('repeated Backspace passes a hidden comment and keeps it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, inline)
  await select(page, 8)
  await press(page, ['Backspace', 'Backspace', 'Backspace'])
  await expectSaved(page, 'Inlin<!-- secret -->here.\n')
})

const word = mac ? 'Alt' : 'Control'
for (const [offset, key] of [
  [11, `${word}+Backspace`],
  [5, `${word}+Delete`],
] as const)
  test(`${key} across a hidden comment keeps it`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, 'Keep one<!-- secret -->two\n')
    await select(page, offset)
    await press(page, [key])
    await expectSaved(page, 'Keep <!-- secret -->\n')
  })

test('Command-Backspace before a hidden comment keeps it', async ({
  page,
  openFixture,
}) => {
  test.skip(!mac, 'Deleting to the line start is a macOS binding')
  await openFixture()
  await open(page, 'Keep one %%secret%% two\n')
  await select(page, 10)
  await press(page, ['Meta+Backspace'])
  await expectSaved(page, '%%secret%%two\n')
})

const blocks: [string, string, number, string, string][] = [
  [
    'Backspace after an HTML block comment',
    'First\n\n<!-- block -->\n\nSecond\n',
    6,
    'Backspace',
    'FirstSecond\n\n<!-- block -->\n',
  ],
  [
    'Delete before an HTML block comment',
    'First\n\n<!-- block -->\n\nSecond\n',
    5,
    'Delete',
    'FirstSecond\n\n<!-- block -->\n',
  ],
  [
    'Backspace after a %% block comment',
    'First\n\n%%\nblock\n%%\n\nSecond\n',
    6,
    'Backspace',
    'FirstSecond\n\n%%\nblock\n%%\n',
  ],
  [
    'Delete before two block comments',
    'First\n\n<!-- one -->\n\n%%\ntwo\n%%\n\nSecond\n',
    5,
    'Delete',
    'FirstSecond\n\n<!-- one -->\n\n%%\ntwo\n%%\n',
  ],
]

for (const [name, source, offset, key, expected] of blocks)
  test(`${name} joins the visible paragraphs and keeps the comment`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, source)
    await select(page, offset)
    await press(page, [key])
    await expectSaved(page, expected)
    await press(page, ['ControlOrMeta+z'])
    await expect.poll(() => saved(page)).toBe(source)
  })

for (const [name, source, offset, key] of [
  [
    'Backspace after a leading block comment',
    '<!-- block -->\n\nSecond\n',
    0,
    'Backspace',
  ],
  [
    'Delete before a trailing block comment',
    'First\n\n<!-- block -->\n',
    5,
    'Delete',
  ],
  [
    'Backspace after an inline comment that opens the note',
    '%%c%% B\n',
    0,
    'Backspace',
  ],
  [
    'Backspace after a quote that ends with a block comment',
    '> First\n>\n> <!-- c -->\n\nSecond\n',
    6,
    'Backspace',
  ],
] as const)
  test(`${name} changes nothing`, async ({ page, openFixture }) => {
    await openFixture()
    await open(page, source)
    await select(page, offset)
    await press(page, [key])
    await page.waitForTimeout(100)
    await expectSaved(page, source)
  })

test('a hidden comment at the edge of a selection stays when the selection is replaced or deleted', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, inline)
  await select(page, 0, 7)
  await press(page, ['Z'])
  await expectSaved(page, 'Z<!-- secret --> here.\n')
  await open(page, inline)
  await select(page, 7, 13)
  await press(page, ['Backspace'])
  await expectSaved(page, 'Inline <!-- secret -->\n')
  // Extending by key from a caret after the comment starts the selection there.
  await open(page, obsidian)
  await select(page, 7)
  await extend(page, 'Shift+ArrowLeft', 0)
  await press(page, ['Backspace'])
  await expectSaved(page, '%%secret%% here.\n')
  await open(page, obsidian)
  await select(page, 7)
  await extend(page, 'Shift+ArrowRight', 13)
  await press(page, ['Z'])
  await expectSaved(page, 'Inline %%secret%%Z\n')
})

test('a hidden comment inside a deleted selection goes with it, and undo restores it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, inline)
  await select(page, 3, 10)
  await press(page, ['Backspace'])
  await expectSaved(page, 'Inlre.\n')
  await press(page, ['ControlOrMeta+z'])
  await expect.poll(() => saved(page)).toBe(inline)
})

// Typing shows where the caret is: the typed text must land outside every comment.
async function expectTypedOutside(page: Page, source: string, comment: string) {
  await press(page, ['X'])
  await expect.poll(() => saved(page)).not.toBe(source)
  const text = (await saved(page))!
  expect(text.replace('X', '')).toBe(source)
  expect(text).toContain(comment)
}

for (const [source, comment, offset, keys] of [
  [inline, '<!-- secret -->', 6, ['ArrowRight', 'ArrowRight']],
  [inline, '<!-- secret -->', 8, ['ArrowLeft', 'ArrowLeft']],
  [obsidian, '%%secret%%', 6, ['ArrowRight']],
  [obsidian, '%%secret%%', 8, ['ArrowLeft']],
  ['First\n\n<!-- block -->\n\nSecond\n', '<!-- block -->', 5, ['ArrowRight']],
  ['First\n\n<!-- block -->\n\nSecond\n', '<!-- block -->', 6, ['ArrowLeft']],
  ['First\n\n<!-- block -->\n\nSecond\n', '<!-- block -->', 2, ['ArrowDown']],
  ['First\n\n<!-- block -->\n\nSecond\n', '<!-- block -->', 8, ['ArrowUp']],
  [
    'First\n\n<!-- block -->\n',
    '<!-- block -->',
    5,
    ['ArrowRight', 'ArrowDown'],
  ],
  ['<!-- block -->\n\nSecond\n', '<!-- block -->', 0, ['ArrowLeft', 'ArrowUp']],
] as const)
  test(`${keys.join(', ')} from ${offset} never puts the caret inside a hidden comment in ${JSON.stringify(source)}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, source)
    await select(page, offset)
    await press(page, [...keys])
    await expectTypedOutside(page, source, comment)
  })

for (const [source, comment] of [
  [inline, '<!-- secret -->'],
  ['First\n\n<!-- block -->\n\nSecond\n', '<!-- block -->'],
] as const)
  test(`hiding comments moves a caret out of ${comment}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, source)
    await operation(page, 'commentsVisible', { visible: true })
    const box = (await page.locator('.inkkit-comment').first().boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await operation(page, 'commentsVisible', { visible: false })
    await expectTypedOutside(page, source, comment)
  })

test('a search match inside a hidden comment stays selected, and arrows leave it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, inline)
  await operation(page, 'focus')
  await operation(page, 'find', { text: 'secret' })
  await expect
    .poll(async () => (await observe(page)).textSnapshot?.selection)
    .toMatchObject({ from: 7, to: 7 })
  await press(page, ['ArrowRight'])
  await expectTypedOutside(page, inline, '<!-- secret -->')
})

test('deletion input without a key press keeps a hidden comment', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, inline)
  await select(page, 8)
  await page.evaluate(() => {
    document.querySelector('#editor .ProseMirror')!.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward',
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await expectSaved(page, 'Inline <!-- secret -->here.\n')
})
