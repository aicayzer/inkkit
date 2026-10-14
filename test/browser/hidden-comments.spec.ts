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

// Chords with no deletion binding of their own still delete one character.
const chords = mac
  ? ['Control+Alt+Backspace', 'Meta+Alt+Backspace', 'Control+Meta+Backspace']
  : [
      'Alt+Backspace',
      'Control+Alt+Backspace',
      'Meta+Backspace',
      'Alt+Shift+Backspace',
    ]
for (const chord of chords)
  test(`${chord} beside a hidden comment keeps it @smoke`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await open(page, 'ab <!-- c -->cd\n')
    await select(page, 3)
    await press(page, [chord])
    await expectSaved(page, 'ab<!-- c -->cd\n')
  })

test('Control-Alt-Delete beside a hidden comment keeps it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, 'ab <!-- c -->cd\n')
  await select(page, 3)
  await press(page, ['Control+Alt+Delete'])
  await expectSaved(page, 'ab <!-- c -->d\n')
})

for (const [name, last, expected] of [
  ['cancelled', '', inline],
  ['committed', 'か', 'Inline か<!-- secret --> here.\n'],
] as const)
  test(`a composition ${name} beside a hidden comment keeps it`, async ({
    page,
    openFixture,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'IME input needs the Chrome DevTools Protocol',
    )
    await openFixture()
    await open(page, inline)
    await select(page, 7)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', {
      text: 'か',
      selectionStart: 1,
      selectionEnd: 1,
    })
    if (!last)
      await cdp.send('Input.imeSetComposition', {
        text: '',
        selectionStart: 0,
        selectionEnd: 0,
      })
    await cdp.send('Input.insertText', { text: last })
    await expectSaved(page, expected)
  })

test('an edit the browser makes itself that would remove a hidden comment is refused and redrawn', async ({
  page,
  openFixture,
}) => {
  test.skip(!mac, 'Control-T transposes characters on macOS')
  await openFixture()
  const source = 'ab<!-- c -->cd\n'
  await open(page, source)
  await select(page, 2)
  await press(page, ['Control+t'])
  await expect
    .poll(async () => (await observe(page)).diagnostics.map((d) => d.code))
    .toEqual(['preservation'])
  expect(await saved(page)).toBe(source)
  const surface = page.locator('#editor .ProseMirror')
  await expect.poll(() => surface.innerText()).toBe('abcd')
  await expect(surface.locator('.inkkit-comment')).toHaveText(' c ')
  await press(page, ['X'])
  await expect.poll(() => saved(page)).toContain('<!-- c -->')
})

test('Control-K before a hidden comment deletes to the end of the line and keeps it', async ({
  page,
  openFixture,
}) => {
  test.skip(!mac, 'Control-K deletes to the end of the line on macOS')
  await openFixture()
  await open(page, 'Keep %%secret%% one two\n')
  await select(page, 5)
  await press(page, ['Control+k'])
  await expectSaved(page, 'Keep %%secret%%\n')
})

test('a software keyboard deletion uses the range it reports', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, 'Keep %%secret%% one two\n')
  await select(page, 5)
  await page.evaluate(() => {
    const surface = document.querySelector('#editor .ProseMirror')!
    const paragraph = surface.querySelector('p')!
    const last = paragraph.lastChild as Text
    const range = new StaticRange({
      startContainer: paragraph.firstChild!,
      startOffset: 5,
      endContainer: last,
      endOffset: last.length,
    })
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentForward',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(event, 'getTargetRanges', { value: () => [range] })
    surface.dispatchEvent(event)
  })
  await expectSaved(page, 'Keep %%secret%%\n')
})

async function load(page: Page, source: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await operation(page, 'focus')
}

for (const key of ['Backspace', 'Delete', 'Enter'])
  test(`${key} in a note that holds only a hidden comment changes nothing`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await load(page, '<!-- c -->\n')
    await press(page, [key])
    await page.waitForTimeout(100)
    await expectSaved(page, '<!-- c -->\n')
  })

for (const [name, write] of [
  ['typing', (page: Page) => press(page, ['X'])],
  ['insertText', (page: Page) => operation(page, 'insertText', { text: 'X' })],
  ['plain paste', (page: Page) => operation(page, 'pastePlain', { text: 'X' })],
  [
    'paste',
    (page: Page) =>
      operation(page, 'paste', { input: { text: 'X', html: '<p>X</p>' } }),
  ],
] as const)
  for (const [source, expected] of [
    ['<!-- c -->\n', '<!-- c -->\n\nX\n'],
    ['<!-- c -->\n\n---\n', '<!-- c -->\n\nX\n\n---\n'],
  ] as const)
    test(`${name} in a note with no visible text goes after the hidden comment in ${JSON.stringify(source)}`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      await load(page, source)
      await write(page)
      await expectSaved(page, expected)
    })

test('composing in a note that holds only a hidden comment goes after it', async ({
  page,
  openFixture,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'IME input needs the Chrome DevTools Protocol',
  )
  await openFixture()
  await load(page, '<!-- c -->\n')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', {
    text: 'か',
    selectionStart: 1,
    selectionEnd: 1,
  })
  await cdp.send('Input.insertText', { text: 'か' })
  await expectSaved(page, '<!-- c -->\n\nか\n')
})

test('deleting a table row removes the hidden comments in it', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, '| a | b |\n| - | - |\n| x <!-- c --> | y |\n| p | q |\n')
  await select(page, 5)
  await operation(page, 'table', { command: 'deleteRow' })
  await expectSaved(page, '| a | b |\n| - | - |\n| p | q |\n')
})
