import { expect, test, type Page } from '@playwright/test'
import type { EditorOptions, InkKitEditor } from '../../src/core'

/**
 * The display options draw numbers and controls inside the editor's own DOM. These cases drive
 * real keyboard, pointer and clipboard input, and compare what the document saves with the
 * options on and off, because the options are presentation and must not change any edit.
 */

const moduleUrl = `/@fs${process.cwd()}/src/core.ts`

declare global {
  interface Window {
    displayEditor: InkKitEditor
    displayGeneration: number
  }
}

async function mount(
  page: Page,
  text: string,
  options: EditorOptions = {},
): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await page.evaluate(
    async ({ moduleUrl, text, options }) => {
      const { InkKitEditor } = await import(moduleUrl)
      document.body.replaceChildren()
      document.body.style.cssText = 'margin:0;padding:10px;width:620px'
      const root = document.createElement('div')
      root.id = 'display-editor'
      root.style.cssText = 'padding:20px 28px;--inkkit-reading-width:520px'
      document.body.append(root)
      const editor = await InkKitEditor.mount(
        root,
        { changed() {} },
        { rendering: { drawnSelection: false }, ...options },
      )
      window.displayGeneration = 1
      editor.loadDocument({
        documentId: 'display',
        generation: window.displayGeneration,
        format: 'md',
        text,
      })
      window.displayEditor = editor
    },
    { moduleUrl, text, options },
  )
}

/** Loads another document into the mounted editor, which starts with every section open. */
const reload = (page: Page, text: string) =>
  page.evaluate((text) => {
    window.displayEditor.loadDocument({
      documentId: 'display',
      generation: ++window.displayGeneration,
      format: 'md',
      text,
    })
  }, text)

const saved = (page: Page) =>
  page.evaluate(() => window.displayEditor.snapshot().text)

const find = (page: Page, text: string) =>
  page.evaluate((text) => window.displayEditor.find(text), text)

/** The caret as the document has it: the text before it in its block, and the block's text. */
const caret = (page: Page) =>
  page.evaluate(() => {
    const selection = getSelection()!
    const node = selection.anchorNode
    const block = (
      node instanceof Element ? node : node?.parentElement
    )?.closest('p,h1,h2,h3,h4,h5,h6,pre')
    if (!block || !node) return null
    const range = document.createRange()
    range.selectNodeContents(block)
    range.setEnd(node, selection.anchorOffset)
    return {
      before: range.toString().replace(/\n$/, ''),
      block: block.textContent,
      collapsed: selection.isCollapsed,
    }
  })

const toggle = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true })

const fence = '```\none\ntwo\nthree\n```\n'

// What a person does at the edges of a line: each starts from a caret before `two`, or after `one`.
const lineEdits: [string, string, (page: Page) => Promise<void>][] = [
  [
    'Backspace at a line start',
    'two',
    (page) => page.keyboard.press('Backspace'),
  ],
  ['Delete at a line end', 'one-end', (page) => page.keyboard.press('Delete')],
  ['Return at a line start', 'two', (page) => page.keyboard.press('Enter')],
  ['Return at a line end', 'one-end', (page) => page.keyboard.press('Enter')],
  ['typing at a line start', 'two', (page) => page.keyboard.type('X')],
  ['typing at a line end', 'one-end', (page) => page.keyboard.type('X')],
  [
    'inserted text at a line start',
    'two',
    (page) => page.keyboard.insertText('日本'),
  ],
  [
    'Shift+ArrowRight then Backspace from a line start',
    'two',
    async (page) => {
      await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Backspace')
    },
  ],
  [
    'Backspace twice across two line starts',
    'three',
    async (page) => {
      await page.keyboard.press('Backspace')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('Backspace')
    },
  ],
]

async function placeCaret(page: Page, where: string) {
  const target = where.replace('-end', '')
  await page.evaluate(() => window.displayEditor.focus())
  expect(await find(page, target)).toBe(true)
  await page.keyboard.press(where.endsWith('-end') ? 'ArrowRight' : 'ArrowLeft')
}

async function edited(
  page: Page,
  numbered: boolean,
  where: string,
  act: (page: Page) => Promise<void>,
) {
  await mount(page, fence, { display: { codeLineNumbers: numbered } })
  await placeCaret(page, where)
  await act(page)
  // Where the caret ended up decides what the next keystroke does, so type once more.
  await page.keyboard.type('Z')
  const text = await saved(page)
  // The keys reached the editor: the typed letter is in the saved text.
  expect(text).toContain('Z')
  return { text, caret: await caret(page) }
}

for (const [name, where, act] of lineEdits)
  test(`line numbers do not change ${name}`, async ({ page }) => {
    const off = await edited(page, false, where, act)
    const on = await edited(page, true, where, act)
    expect(on).toEqual(off)
  })

test('Backspace at the start of a numbered line joins it to the line above, as without numbers', async ({
  page,
}) => {
  for (const numbered of [false, true]) {
    await mount(page, fence, { display: { codeLineNumbers: numbered } })
    await placeCaret(page, 'two')
    await page.keyboard.press('Backspace')
    expect(await saved(page)).toBe('```\nonetwo\nthree\n```\n')
  }
})

test('Delete and Return around numbered lines save the same bytes', async ({
  page,
}) => {
  await mount(page, fence, { display: { codeLineNumbers: true } })
  await placeCaret(page, 'one-end')
  await page.keyboard.press('Delete')
  expect(await saved(page)).toBe('```\nonetwo\nthree\n```\n')
  await page.keyboard.press('Enter')
  expect(await saved(page)).toBe('```\none\ntwo\nthree\n```\n')
})

test('an inserted line takes its number, and a deleted one gives it up', async ({
  page,
}) => {
  await mount(page, fence, { display: { codeLineNumbers: true } })
  const numbers = () =>
    page
      .locator('.inkkit-line-number')
      .evaluateAll((entries) =>
        entries.map((entry) => entry.getAttribute('data-inkkit-line')),
      )
  expect(await numbers()).toEqual(['1', '2', '3'])
  await placeCaret(page, 'two')
  await page.keyboard.press('Enter')
  expect(await numbers()).toEqual(['1', '2', '3', '4'])
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  expect(await numbers()).toEqual(['1', '2'])
})

test('composition at a numbered line start saves what it does without numbers', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Only Chromium lets a test drive an input method, through the DevTools Protocol',
  )
  const compose = async (numbered: boolean) => {
    await mount(page, fence, { display: { codeLineNumbers: numbered } })
    await placeCaret(page, 'two')
    const session = await page.context().newCDPSession(page)
    await session.send('Input.imeSetComposition', {
      text: 'に',
      selectionStart: 1,
      selectionEnd: 1,
    })
    await session.send('Input.imeSetComposition', {
      text: '日本',
      selectionStart: 2,
      selectionEnd: 2,
    })
    await session.send('Input.insertText', { text: '日本' })
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    return saved(page)
  }
  const off = await compose(false)
  expect(await compose(true)).toBe(off)
})

/** What the editor paints for the selection: the highlighted text and the drawn bars. */
const painted = (page: Page) =>
  page.evaluate(() => ({
    ranges: Array.from(CSS.highlights.get('inkkit-selection') ?? [], (range) =>
      (range as Range).toString(),
    ),
    bars: [
      ...(document.querySelector('.inkkit-selection-layer')?.children ?? []),
    ].map((bar) => {
      const rect = bar.getBoundingClientRect()
      return [rect.width > 0, Math.round(rect.top), Math.round(rect.left)]
    }),
  }))

const hasPainting = ({ ranges, bars }: { ranges: string[]; bars: unknown[] }) =>
  ranges.length + bars.length > 0

/** Selects `text` the way a person or a host does: a double click on it, or a text range. */
async function select(page: Page, how: 'double click' | 'range', text: string) {
  if (how === 'range') {
    await page.evaluate((text) => {
      const editor = window.displayEditor
      const snapshot = editor.textSnapshot()
      const from = snapshot.text.indexOf(text)
      editor.selectTextRange({
        snapshotId: snapshot.snapshotId,
        from,
        to: from + text.length,
      })
    }, text)
    return
  }
  const point = await page.evaluate((text) => {
    const walker = document.createTreeWalker(
      document.querySelector('#display-editor .ProseMirror')!,
      NodeFilter.SHOW_TEXT,
    )
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(text)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at + 1)
      range.setEnd(node, at + 2)
      const rect = range.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }
    return null
  }, text)
  await page.evaluate(() => window.displayEditor.focus())
  await page.mouse.dblclick(point!.x, point!.y)
  // The browser selected the word before the editor is asked what it paints for it.
  await expect
    .poll(() => page.evaluate(() => getSelection()!.toString()))
    .toBe(text)
}

// A preference that replaces DOM under a painted selection leaves the same selection painted.
for (const drawn of [false, true])
  for (const how of ['double click', 'range'] as const)
    for (const [name, text, selected, turn] of [
      [
        'line numbers',
        '```\nAAA\nBBB\nCCC\n```\n',
        'BBB',
        { codeLineNumbers: true },
      ],
      [
        'heading folds',
        'Before\n\n# Headline\n\nafter\n',
        'Headline',
        { foldHeadings: true },
      ],
    ] as const)
      test(`turning ${name} on or off keeps a painted selection (${how}, drawn ${drawn})`, async ({
        page,
      }) => {
        for (const [first, second] of [
          [{}, turn],
          [turn, {}],
        ] as const) {
          await mount(page, text, {
            display: first,
            rendering: { drawnSelection: drawn },
          })
          await select(page, how, selected)
          await expect
            .poll(async () => hasPainting(await painted(page)))
            .toBe(true)
          const before = await painted(page)
          expect(JSON.stringify(before)).toContain(
            drawn && name === 'heading folds' ? 'true' : selected,
          )
          await page.evaluate(
            (second) => window.displayEditor.setDisplayPreferences(second),
            second,
          )
          await expect.poll(() => painted(page)).toEqual(before)
          if (how === 'double click')
            expect(await page.evaluate(() => getSelection()!.toString())).toBe(
              selected,
            )
        }
      })

const outline = '# One\n\nHidden\n\n# Two\n'

// A key that deletes, as each engine acts on it. One a given engine does not bind changes nothing,
// which is also a pass: what matters is that hidden text is never lost. A key that deletes forward
// is tried at the end of the folded heading, and one that deletes backward at the start of the
// heading that follows the section.
const forward = [
  'Delete',
  'Shift+Delete',
  'Alt+Delete',
  'Control+Delete',
  'Meta+Delete',
  'Control+d',
  'Control+k',
  'Control+Alt+Backspace',
]
const backward = [
  'Backspace',
  'Shift+Backspace',
  'Alt+Backspace',
  'Control+Backspace',
  'Meta+Backspace',
  'Control+h',
]

for (const [keys, place] of [
  [forward, 'after the heading'],
  [backward, 'before the next heading'],
] as const)
  for (const key of keys)
    test(`${key} ${place} never changes folded text`, async ({ page }) => {
      await mount(page, outline, { display: { foldHeadings: true } })
      await toggle(page, 'Fold section One').click()
      await expect(page.getByText('Hidden')).toBeHidden()
      if (place === 'after the heading') {
        await page.locator('.ProseMirror h1').first().click()
        await page.keyboard.press('End')
      } else {
        await page.evaluate(() => window.displayEditor.focus())
        expect(await find(page, 'Two')).toBe(true)
        await page.keyboard.press('ArrowLeft')
      }
      await page.keyboard.press(key)
      // Whatever the key did, the folded paragraph is exactly as it was.
      expect(await saved(page)).toContain('\nHidden\n')
      expect(await saved(page)).toBe(outline)
    })

test('Shift+Delete after a folded heading opens the section and keeps its text', async ({
  page,
}) => {
  await mount(page, outline, { display: { foldHeadings: true } })
  await toggle(page, 'Fold section One').click()
  await page.locator('.ProseMirror h1').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Delete')
  expect(await saved(page)).toBe(outline)
  await expect(page.getByText('Hidden')).toBeVisible()
  await expect(toggle(page, 'Fold section One')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})

test('cut, paste and drop over a selection that ends in a folded heading keep the hidden text', async ({
  page,
}) => {
  const source = 'Intro\n\n# One\n\nHidden\n\n# Two\n'
  const select = async () => {
    await mount(page, source, { display: { foldHeadings: true } })
    await toggle(page, 'Fold section One').click()
    await page.evaluate(() => {
      const editor = window.displayEditor
      const snapshot = editor.textSnapshot()
      editor.selectTextRange({
        snapshotId: snapshot.snapshotId,
        from: 0,
        to: snapshot.text.indexOf('One') + 3,
      })
    })
  }
  const hiddenKept = async () => {
    const text = await saved(page)
    expect(text.split('Hidden')).toHaveLength(2)
    expect(text).toContain('# Two')
  }
  await select()
  await page.keyboard.press('ControlOrMeta+x')
  await hiddenKept()

  await select()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', 'Pasted\n\nParagraphs')
    document.querySelector('#display-editor .ProseMirror')!.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await hiddenKept()

  await select()
  const target = await page.locator('.ProseMirror h1').first().boundingBox()
  await page.evaluate(
    ({ x, y }) => {
      const data = new DataTransfer()
      data.setData('text/plain', 'Dropped')
      const editor = document.querySelector('#display-editor .ProseMirror')!
      for (const type of ['dragover', 'drop'])
        editor.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: data,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        )
    },
    { x: target!.x + target!.width - 2, y: target!.y + target!.height / 2 },
  )
  await hiddenKept()
})

test('a selection that covers a whole folded section deletes it', async ({
  page,
}) => {
  await mount(page, outline, { display: { foldHeadings: true } })
  await toggle(page, 'Fold section One').click()
  await page.locator('.ProseMirror h1').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  expect(await saved(page)).toBe('')
})

test('cut after select-all removes folded text on purpose', async ({
  page,
}) => {
  await mount(page, outline, { display: { foldHeadings: true } })
  await toggle(page, 'Fold section One').click()
  await page.locator('.ProseMirror h1').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+x')
  expect(await saved(page)).toBe('')
})

test('arrow keys move past a folded paragraph and leave the section folded', async ({
  page,
}) => {
  await mount(page, '# One\n\nhidden words\n\n# Two\n\ntail\n', {
    display: { foldHeadings: true },
  })
  await toggle(page, 'Fold section One').click()
  await page.locator('.ProseMirror h1').first().click()
  await page.keyboard.press('End')
  expect(await caret(page)).toMatchObject({ block: 'One', before: 'One' })
  await page.keyboard.press('ArrowDown')
  // The caret passed the hidden paragraph and is in the next visible block, with the section closed.
  expect(await caret(page)).toMatchObject({ block: 'Two', collapsed: true })
  await expect(toggle(page, 'Unfold section One')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await page.keyboard.press('ArrowUp')
  expect(await caret(page)).toMatchObject({ block: 'One', collapsed: true })
  await expect(toggle(page, 'Unfold section One')).toBeVisible()
  // Typing lands where the caret is shown, not in hidden content.
  await page.keyboard.type('!')
  expect(await saved(page)).toBe('# One!\n\nhidden words\n\n# Two\n\ntail\n')
})

test('an arrow key that would select a hidden rule opens the section instead', async ({
  page,
}) => {
  const source = '# One\n\n---\n\n# Two\n\ntail\n'
  await mount(page, source, { display: { foldHeadings: true } })
  await toggle(page, 'Fold section One').click()
  await page.locator('.ProseMirror h1').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowDown')
  // The rule is selected, which a person must see, so the section is open.
  await expect(toggle(page, 'Fold section One')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(page.locator('.ProseMirror hr')).toBeVisible()
  expect(await saved(page)).toBe(source)
})

// The same keystrokes, pointer and typing across headings, with the option off and on.
const source = 'Intro text\n\n# One heading\n\nbody one\n\n## Sub\n\nbody two\n'
test('headings take the same keys, drags and typing whether or not they can fold', async ({
  page,
}) => {
  const run = async (foldHeadings: boolean) => {
    await mount(page, source, { display: { foldHeadings } })
    const steps: unknown[] = []
    // The editor reads the browser's selection a moment after each event, so let it settle
    // before the next one, as a person's pace does.
    const settle = () => page.waitForTimeout(60)
    const press = async (key: string) => {
      await page.keyboard.press(key)
      await settle()
    }
    const type = async (text: string) => {
      await page.keyboard.type(text)
      await settle()
    }
    const note = async () => steps.push(await caret(page))
    await page.evaluate(() => window.displayEditor.focus())
    expect(await find(page, 'Intro text')).toBe(true)
    await settle()
    await press('ArrowRight')
    await note()
    // Across the boundary below a paragraph and into a heading, then back.
    await press('ArrowDown')
    await note()
    await press('ArrowLeft')
    await press('ArrowLeft')
    await note()
    await press('ArrowUp')
    await note()
    await press('ArrowRight')
    await note()
    // A drag from the body into the heading above, then typing over it.
    const body = (await page.getByText('body one').boundingBox())!
    const heading = (await page
      .locator('.ProseMirror h1, .ProseMirror h2')
      .first()
      .boundingBox())!
    await page.mouse.move(body.x + body.width - 2, body.y + body.height / 2)
    await page.mouse.down()
    await page.mouse.move(heading.x + 24, heading.y + heading.height / 2, {
      steps: 6,
    })
    await page.mouse.up()
    await settle()
    await type('Q')
    await note()
    // Typing and Backspace at both ends of a heading.
    await type('A')
    await press('Home')
    await type('B')
    await press('Backspace')
    await press('Backspace')
    await note()
    await press('Backspace')
    await note()
    steps.push(await saved(page))
    return steps
  }
  const off = await run(false)
  // The keys reached the editor: they changed what it saved.
  expect(off.at(-1)).not.toBe(source)
  expect(await run(true)).toEqual(off)
})

test('a heading is named by its own text, and the control by the same text', async ({
  page,
}) => {
  await mount(page, '# One %%private%%\n\nbody\n\n## Two\n', {
    display: { foldHeadings: true },
  })
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveCount(1)
  await expect(heading).toHaveAccessibleName('One')
  await expect(page.getByRole('heading', { level: 2 })).toHaveAccessibleName(
    'Two',
  )
  const control = toggle(page, 'Fold section One')
  await expect(control).toHaveAttribute('aria-expanded', 'true')
  // The control is beside the heading, not inside it, and nothing hides it from assistive technology.
  const placement = await page.evaluate(() => {
    const button = document.querySelector('[data-inkkit-heading-toggle]')!
    const h1 = document.querySelector('.ProseMirror h1')!
    return {
      inside: h1.contains(button),
      sibling: button.closest('.inkkit-heading-block') === h1.parentElement,
      hiddenFromTree: Boolean(button.closest('[aria-hidden="true"]')),
      parentIsHeading: Boolean(button.closest('h1,h2,h3,h4,h5,h6')),
    }
  })
  expect(placement).toEqual({
    inside: false,
    sibling: true,
    hiddenFromTree: false,
    parentIsHeading: false,
  })
  // Folding changes the control's name and state, never the heading's name.
  await control.click()
  await expect(heading).toHaveAccessibleName('One')
  await expect(toggle(page, 'Unfold section One')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  // A comment that is shown is part of what the heading says, so the control's name follows it.
  await page.evaluate(() => window.displayEditor.setCommentsVisible(true))
  await expect(
    page.locator('[data-inkkit-heading-toggle]').first(),
  ).toHaveAttribute('aria-label', /^Unfold section One\s+\S*private/)
  await page.evaluate(() => window.displayEditor.setCommentsVisible(false))
  await expect(toggle(page, 'Unfold section One')).toHaveCount(1)
  await expect(heading).toHaveAccessibleName('One')
})

test('the control stays tabbable and a heading stays editable beside it', async ({
  page,
}) => {
  await mount(page, '# One\n\nbody\n', { display: { foldHeadings: true } })
  await page.locator('.ProseMirror h1').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  expect(await saved(page)).toBe('# One!\n\nbody\n')
  await page.keyboard.press('Tab')
  await expect(toggle(page, 'Fold section One!')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByText('body')).toBeHidden()
  expect(await saved(page)).toBe('# One!\n\nbody\n')
})

test('a heading control is placed beside the first line, and the first heading keeps its margin', async ({
  page,
}) => {
  const placement = async (foldHeadings: boolean) => {
    await mount(page, '# One\n\nbody\n\n## Two\n\nbody\n', {
      display: { foldHeadings },
    })
    return page.evaluate(() =>
      [...document.querySelectorAll('.ProseMirror h1, .ProseMirror h2')].map(
        (heading) => {
          const rect = heading.getBoundingClientRect()
          return { top: Math.round(rect.top), height: Math.round(rect.height) }
        },
      ),
    )
  }
  const off = await placement(false)
  expect(await placement(true)).toEqual(off)
  await expect(toggle(page, 'Fold section One')).toBeAttached()
  const control = (await page
    .locator('.inkkit-heading-fold')
    .first()
    .boundingBox())!
  const heading = (await page.locator('.ProseMirror h1').boundingBox())!
  // The control centres on the heading's first line.
  expect(
    Math.abs(control.y + control.height / 2 - (heading.y + heading.height / 2)),
  ).toBeLessThan(3)
})

test('a private comment block under a folded heading stays out of print and out of view', async ({
  page,
}) => {
  await mount(page, '# One\n\n%%\nprivate memo\n%%\n\nvisible\n\n# Two\n', {
    display: { foldHeadings: true },
  })
  const memo = page.locator('.inkkit-comment-block')
  await expect(memo).toHaveCount(1)
  await expect(memo).toBeHidden()
  await toggle(page, 'Fold section One').click()
  await expect(memo).toBeHidden()
  await expect(page.getByText('visible', { exact: true })).toBeHidden()
  await page.emulateMedia({ media: 'print' })
  // Print shows what folding hid, and still not the comment.
  await expect(page.getByText('visible', { exact: true })).toBeVisible()
  await expect(memo).toBeHidden()
  await expect(page.getByText('private memo')).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  // Showing comments does not show one through a fold.
  await page.evaluate(() => window.displayEditor.setCommentsVisible(true))
  await expect(memo).toBeHidden()
  await toggle(page, 'Unfold section One').click()
  await expect(memo).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(memo).toBeHidden()
})

test('a rendered diagram folds with its block and returns when the section opens', async ({
  page,
}) => {
  await mount(
    page,
    '# One\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n# Two\n\nafter\n',
    { display: { foldHeadings: true } },
  )
  const preview = page.locator('.inkkit-mermaid-preview')
  await expect(preview.locator('svg')).toBeVisible()
  await toggle(page, 'Fold section One').click()
  await expect(preview).toBeHidden()
  await expect(page.locator('.ProseMirror pre')).toBeHidden()
  await toggle(page, 'Unfold section One').click()
  await expect(preview.locator('svg')).toBeVisible()
  // Print shows the rendered diagram of a folded section too.
  await toggle(page, 'Fold section One').click()
  await expect(preview).toBeHidden()
  await page.emulateMedia({ media: 'print' })
  await expect(preview.locator('svg')).toBeVisible()
})

test('moving a folded heading keeps it folded', async ({ page }) => {
  await mount(page, 'Intro\n\n# One\n\nBody\n\n# Two\n', {
    display: { foldHeadings: true },
  })
  expect(await find(page, 'One')).toBe(true)
  await toggle(page, 'Fold section One').click()
  await expect(page.getByText('Body', { exact: true })).toBeHidden()
  await page.evaluate(() => window.displayEditor.moveBlock('up'))
  expect(await saved(page)).toBe('# One\n\nIntro\n\nBody\n\n# Two\n')
  await expect(toggle(page, 'Unfold section One')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(page.getByText('Intro', { exact: true })).toBeHidden()
  await expect(page.getByText('Body', { exact: true })).toBeHidden()
  await expect(page.getByText('Two', { exact: true })).toBeVisible()
})
