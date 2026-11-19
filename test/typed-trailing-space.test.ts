import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/core'

// iOS predictive text ends most typed sentences with a space. A block that an
// edit reaches saves without spaces and tabs at the end of its text, instead
// of writing them as `&#x20;` or `&#x9;`, while the editor keeps showing them.

async function session(
  source: string,
  run: (editor: InkKitEditor, changes: string[]) => void | Promise<void>,
): Promise<void> {
  const errors: Error[] = []
  const changes: string[] = []
  const root = document.body.appendChild(document.createElement('div'))
  const editor = await InkKitEditor.mount(root, {
    changed: (snapshot) => changes.push(snapshot.text),
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    editor.loadDocument({
      documentId: 'typed',
      generation: 1,
      format: 'md',
      text: source,
    })
    expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
    await run(editor, changes)
    expect(errors).toEqual([])
  } finally {
    await editor.destroy()
    root.remove()
  }
}

// Places the caret after the `occurrence`th `text` in the readable text.
function caretAfter(editor: InkKitEditor, text: string, occurrence = 1): void {
  const snapshot = editor.textSnapshot()
  let at = -1
  for (let index = 0; index < occurrence; index++)
    at = snapshot.text.indexOf(text, at + 1)
  expect(at).toBeGreaterThanOrEqual(0)
  const offset = at + text.length
  editor.selectTextRange({
    snapshotId: snapshot.snapshotId,
    from: offset,
    to: offset,
  })
}

function type(editor: InkKitEditor, text: string): void {
  expect(editor.insertText(text, editor.snapshot().generation)).toBe(true)
}

// The saved text reopens as itself, in a fresh editor, with nothing to save.
async function reopens(text: string, readable?: string): Promise<void> {
  const root = document.body.appendChild(document.createElement('div'))
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({
      documentId: 'reopened',
      generation: 1,
      format: 'md',
      text,
    })
    expect(editor.snapshot()).toMatchObject({ text, dirty: false })
    if (readable !== undefined)
      expect(editor.textSnapshot().text).toBe(readable)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

for (const ending of ['\n', '\r\n']) {
  const lines = (text: string) => text.replaceAll('\n', ending)
  const label = JSON.stringify(ending)

  test(`a typed sentence ending in a space saves without it (${label})`, async () => {
    const source = lines('# Shopping list\n\nMilk\n')
    await session(source, async (editor) => {
      caretAfter(editor, 'Milk')
      type(editor, ' and bread. ')
      const saved = lines('# Shopping list\n\nMilk and bread.\n')
      const snapshot = editor.snapshot()
      expect(snapshot).toMatchObject({ text: saved, dirty: true, revision: 1 })
      // The editor keeps the space and the caret after it.
      expect(editor.textSnapshot().text).toBe('Shopping list\nMilk and bread. ')
      expect(editor.textSnapshot().selection).toMatchObject({
        from: 'Shopping list\nMilk and bread. '.length,
      })
      await reopens(saved, 'Shopping list\nMilk and bread.')
      // Typing on continues after the space.
      type(editor, 'Eggs. ')
      expect(editor.snapshot().text).toBe(
        lines('# Shopping list\n\nMilk and bread. Eggs.\n'),
      )
      // Typing joins one undo step, and Undo returns the loaded bytes.
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
      expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe(
        lines('# Shopping list\n\nMilk and bread. Eggs.\n'),
      )
      expect(editor.textSnapshot().text).toBe(
        'Shopping list\nMilk and bread. Eggs. ',
      )
    })
  })

  test(`a space typed at the end of a loaded block saves the loaded bytes (${label})`, async () => {
    const source = lines('One.\n\nTwo.\n')
    await session(source, (editor, changes) => {
      caretAfter(editor, 'Two.')
      type(editor, ' ')
      // The text is what was loaded, so there is nothing to save: the
      // revision counts the edit, and no change is sent.
      expect(editor.snapshot()).toMatchObject({
        text: source,
        dirty: false,
        revision: 1,
      })
      expect(changes).toEqual([])
      expect(editor.textSnapshot().text).toBe('One.\nTwo. ')
      type(editor, 'Three. ')
      expect(changes).toEqual([lines('One.\n\nTwo. Three.\n')])
    })
  })

  for (const [name, blanks] of [
    ['several spaces', '   '],
    ['a tab', '\t'],
    ['spaces and tabs', ' \t \t'],
  ] as const)
    test(`${name} at the end of a paragraph are dropped (${label})`, async () => {
      await session(lines('Start\n\nEnd\n'), async (editor) => {
        caretAfter(editor, 'End')
        type(editor, blanks)
        const saved = lines('Start\n\nEnd\n')
        expect(editor.snapshot().text).toBe(saved)
        expect(editor.textSnapshot().text).toBe(`Start\nEnd${blanks}`)
        await reopens(saved)
      })
    })

  test(`a non-breaking space at the end of a paragraph is kept (${label})`, async () => {
    await session(lines('Start\n\nEnd\n'), async (editor) => {
      caretAfter(editor, 'End')
      type(editor, '\u00A0 ')
      // U+00A0 is text to Markdown, which never trims it.
      const saved = lines('Start\n\nEnd\u00A0\n')
      expect(editor.snapshot().text).toBe(saved)
      await reopens(saved, 'Start\nEnd\u00A0')
    })
  })

  for (const [name, source, after, saved] of [
    ['a heading', '# Title\n\nBody\n', 'Title', '# Titlex\n\nBody\n'],
    ['a setext heading', 'Title\n=====\n', 'Title', 'Titlex\n=====\n'],
    ['a bullet item', '- one\n- two\n', 'one', '- onex\n- two\n'],
    ['a task item', '- [ ] one\n- [x] two\n', 'two', '- [ ] one\n- [x] twox\n'],
    ['an ordered item', '1. one\n2. two\n', 'one', '1. onex\n2. two\n'],
    ['a quote', '> quoted\n', 'quoted', '> quotedx\n'],
    ['a callout', '> [!NOTE]\n> body\n', 'body', '> [!NOTE]\n> bodyx\n'],
    [
      'a table cell',
      '| a | b |\n| - | - |\n| c | d |\n',
      'c',
      '| a | b |\n| - | - |\n| cx | d |\n',
    ],
    [
      'the last table cell',
      '| a | b |\n| - | - |\n| c | d |\n',
      'd',
      '| a | b |\n| - | - |\n| c | dx |\n',
    ],
    ['bold text', '**bold**\n', 'bold', '**boldx**\n'],
  ] as const)
    test(`spaces typed at the end of ${name} are dropped (${label})`, async () => {
      await session(lines(source), async (editor) => {
        caretAfter(editor, after)
        type(editor, 'x  ')
        expect(editor.snapshot().text).toBe(lines(saved))
        await reopens(lines(saved))
      })
    })

  test(`other blocks ending in encoded spaces keep their bytes (${label})`, async () => {
    const source = lines(
      '# Heading&#x20;\n\nFirst&#x20;\n\n- item&#x20;\n\n| a&#x20; | b |\n| - | - |\n| c | d&#x9; |\n\nLast&#x20;&#x20;\n',
    )
    await session(source, async (editor) => {
      caretAfter(editor, 'First')
      type(editor, ' typed ')
      const saved = lines(
        '# Heading&#x20;\n\nFirst&#x20;typed\n\n- item&#x20;\n\n| a&#x20; | b |\n| - | - |\n| c | d&#x9; |\n\nLast&#x20;&#x20;\n',
      )
      expect(editor.snapshot().text).toBe(saved)
      await reopens(saved)
      // A table edit keeps the bytes of the cells it does not reach.
      caretAfter(editor, 'c')
      type(editor, 'c ')
      const table = saved.replace('| c |', '| cc |')
      expect(editor.snapshot().text).toBe(table)
      await reopens(table)
    })
  })

  test(`an unedited document with encoded end spaces comes back byte for byte (${label})`, async () => {
    const source = lines('Para&#x20;\n\n- item&#x9;\n\n# Head&#x20;\n')
    await session(source, (editor) => {
      caretAfter(editor, 'Para')
      type(editor, 'x')
      expect(editor.snapshot().text).toBe(
        lines('Parax\n\n- item&#x9;\n\n# Head&#x20;\n'),
      )
      // Undo returns the loaded block, whose own end spaces stay.
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
      expect(editor.redo()).toBe(true)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
    })
  })

  test(`deleting and retyping a loaded end space keeps its spelling (${label})`, async () => {
    const source = lines('Keep&#x20;\n\nNext\n')
    await session(source, (editor) => {
      const snapshot = editor.textSnapshot()
      expect(
        editor.replaceTextRange(
          { snapshotId: snapshot.snapshotId, from: 4, to: 5 },
          '',
        ),
      ).toBe(true)
      expect(editor.snapshot().text).toBe(lines('Keep\n\nNext\n'))
      type(editor, ' ')
      expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
    })
  })

  test(`a space before an end hard break is dropped with the break (${label})`, async () => {
    await session(lines('Run\n\nAfter\n'), async (editor) => {
      caretAfter(editor, 'Run')
      type(editor, ' ')
      editor.keyDown({ key: 'Enter', shiftKey: true }, 1)
      expect(editor.snapshot().text).toBe(lines('Run\n\nAfter\n'))
      type(editor, ' ')
      // Spaces after the pending break go with it.
      expect(editor.snapshot().text).toBe(lines('Run\n\nAfter\n'))
      type(editor, 'now ')
      const saved = lines('Run \\\n&#x20;now\n\nAfter\n')
      expect(editor.snapshot().text).toBe(saved)
      await reopens(saved)
    })
  })

  for (const [name, spelling] of [
    ['two spaces', '  '],
    ['a backslash', '\\'],
    ['<br>', '<br>'],
  ] as const)
    test(`an authored hard break written as ${name} keeps its spelling (${label})`, async () => {
      const source = lines(`Line${spelling}\nnext\n`)
      await session(source, async (editor) => {
        caretAfter(editor, 'next')
        type(editor, ' ')
        expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
        type(editor, 'word ')
        const saved = lines(`Line${spelling}\nnext word\n`)
        expect(editor.snapshot().text).toBe(saved)
        await reopens(saved)
      })
    })

  test(`spaces at the start of a block and beside a soft break keep their encoding (${label})`, async () => {
    await session(lines('See example today\n\none\ntwo\n'), async (editor) => {
      caretAfter(editor, 'See example')
      editor.keyDown({ key: 'Enter' }, 1)
      caretAfter(editor, 'one')
      type(editor, ' ')
      const saved = lines('See example\n\n&#x20;today\n\none&#x20;\ntwo\n')
      expect(editor.snapshot().text).toBe(saved)
      await reopens(saved)
    })
  })

  test(`a block of only spaces keeps them (${label})`, async () => {
    await session(lines('a\n\nb\n'), async (editor) => {
      caretAfter(editor, 'a')
      editor.keyDown({ key: 'Enter' }, 1)
      type(editor, '  ')
      const saved = lines('a\n\n&#x20;&#x20;\n\nb\n')
      expect(editor.snapshot().text).toBe(saved)
      await reopens(saved)
    })
  })

  test(`a bare URL at the end of a block stays bare (${label})`, async () => {
    await session(
      lines('Intro\n\nsee https://example.com\n'),
      async (editor) => {
        caretAfter(editor, 'https://example.com')
        type(editor, ' ')
        expect(editor.snapshot()).toMatchObject({
          text: lines('Intro\n\nsee https://example.com\n'),
          dirty: false,
        })
        type(editor, 'now ')
        const saved = lines('Intro\n\nsee https://example.com now\n')
        expect(editor.snapshot().text).toBe(saved)
        await reopens(saved)
      },
    )
  })

  test(`code keeps its end spaces (${label})`, async () => {
    const source = lines('Use `a `\n\n```\ncode\n```\n')
    await session(source, async (editor) => {
      caretAfter(editor, 'Use')
      type(editor, 'd')
      caretAfter(editor, 'code')
      type(editor, '  ')
      const saved = lines('Used `a `\n\n```\ncode  \n```\n')
      expect(editor.snapshot().text).toBe(saved)
      await reopens(saved)
    })
  })

  test(`reloading the saved text leaves a clean editor (${label})`, async () => {
    await session(lines('Note\n'), (editor) => {
      caretAfter(editor, 'Note')
      type(editor, ' taken. ')
      const saved = editor.snapshot().text
      expect(saved).toBe(lines('Note taken.\n'))
      editor.loadDocument({
        documentId: 'typed',
        generation: 2,
        format: 'md',
        text: saved,
      })
      expect(editor.snapshot()).toMatchObject({
        text: saved,
        dirty: false,
        revision: 0,
      })
      expect(editor.textSnapshot().text).toBe('Note taken.')
      caretAfter(editor, 'taken.')
      type(editor, ' More. ')
      expect(editor.snapshot().text).toBe(lines('Note taken. More.\n'))
    })
  })

  test(`source mode shows the saved text and returns to it (${label})`, async () => {
    await session(lines('Intro\n\nNote\n'), (editor) => {
      caretAfter(editor, 'Note')
      type(editor, ' taken. ')
      const saved = lines('Intro\n\nNote taken.\n')
      expect(editor.setEditingMode('source')).toBe(true)
      const source = editor.textSnapshot()
      // The source surface reads line endings as LF.
      expect(source.text).toBe('Intro\n\nNote taken.\n')
      expect(source.selection.from).toBeLessThanOrEqual(source.text.length)
      expect(editor.setEditingMode('formatted')).toBe(true)
      expect(editor.snapshot().text).toBe(saved)
      type(editor, 'Done ')
      expect(editor.snapshot().text).toMatch(/Done/)
      expect(editor.snapshot().text).not.toContain('&#x20;')
    })
  })
}
