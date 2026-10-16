import { expect, test } from 'vitest'
import { InkKitEditor, type DocumentInput, type TextRange } from '../src/index'

async function run(
  text: string,
  fn: (editor: InkKitEditor) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    const input: DocumentInput = {
      documentId: 'replace-range',
      generation: 1,
      format: 'md',
      text,
    }
    editor.loadDocument(input)
    await fn(editor)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const range = (editor: InkKitEditor, text: string): TextRange => {
  const snapshot = editor.textSnapshot()
  const from = snapshot.text.indexOf(text)
  expect(from).toBeGreaterThanOrEqual(0)
  return { snapshotId: snapshot.snapshotId, from, to: from + text.length }
}
// Reopens the saved bytes in a fresh editor and checks they read back the same.
async function reopens(text: string) {
  await run(text, (editor) => {
    expect(editor.snapshot().text).toBe(text)
  })
}

const containers: readonly (readonly [string, string, string])[] = [
  ['list item', '- alpha beta\n- other\n', '- alpha gamma\n- other\n'],
  ['ordered item', '1. alpha beta\n2. other\n', '1. alpha gamma\n2. other\n'],
  [
    'task item',
    '- [ ] alpha beta\n- [x] other\n',
    '- [ ] alpha gamma\n- [x] other\n',
  ],
  [
    'nested list',
    '- top\n  - alpha beta\n  - deep\n    - deeper\n',
    '- top\n  - alpha gamma\n  - deep\n    - deeper\n',
  ],
  ['quote', '> alpha beta\n\nafter\n', '> alpha gamma\n\nafter\n'],
  [
    'nested quote in list',
    '- item\n\n  > alpha beta\n',
    '- item\n\n  > alpha gamma\n',
  ],
  [
    'callout body',
    '> [!note] Title\n> alpha beta\n\nafter\n',
    '> [!note] Title\n> alpha gamma\n\nafter\n',
  ],
  [
    'table cell',
    '| a | b |\n| - | - |\n| alpha beta | other |\n',
    '| a | b |\n| - | - |\n| alpha gamma | other |\n',
  ],
  [
    'footnote definition',
    'Text[^1]\n\n[^1]: alpha beta\n',
    'Text[^1]\n\n[^1]: alpha gamma\n',
  ],
  ['heading', '# alpha beta\n\nafter\n', '# alpha gamma\n\nafter\n'],
]

test.each(containers)(
  'replaceTextRange works inside a %s: saved bytes reopen and Undo restores',
  (_name, before, after) =>
    run(before, async (editor) => {
      expect(editor.replaceTextRange(range(editor, 'beta'), 'gamma')).toBe(true)
      expect(editor.snapshot().text).toBe(after)
      await reopens(after)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(before)
    }),
)

test.each(containers)(
  'replaceTextRange inside a %s matches replace()',
  (_name, before) =>
    run(before, (editor) => {
      editor.replaceTextRange(range(editor, 'beta'), 'gamma')
      const viaRange = editor.snapshot().text
      editor.loadDocument({
        documentId: 'replace-range',
        generation: 2,
        format: 'md',
        text: before,
      })
      expect(editor.replace('beta', 'gamma')).toBe(true)
      expect(editor.snapshot().text).toBe(viaRange)
    }),
)

test('replaceTextRange keeps CRLF endings in a list item and a table cell', () =>
  run('- alpha beta\r\n- other\r\n', (editor) => {
    editor.replaceTextRange(range(editor, 'beta'), 'gamma')
    expect(editor.snapshot().text).toBe('- alpha gamma\r\n- other\r\n')
    return run(
      '| a | b |\r\n| - | - |\r\n| alpha beta | other |\r\n',
      (table) => {
        table.replaceTextRange(range(table, 'beta'), 'gamma')
        expect(table.snapshot().text).toBe(
          '| a | b |\r\n| - | - |\r\n| alpha gamma | other |\r\n',
        )
        expect(table.undo()).toBe(true)
        expect(table.snapshot().text).toBe(
          '| a | b |\r\n| - | - |\r\n| alpha beta | other |\r\n',
        )
      },
    )
  }))

test('replaceTextRange inside a container leaves other blocks as authored', () => {
  const text = '*  odd marker beta\n*  second\n\n> [!note]\n> keep   this\n'
  return run(text, (editor) => {
    editor.replaceTextRange(range(editor, 'beta'), 'gamma')
    expect(editor.snapshot().text).toBe(
      '*  odd marker gamma\n*  second\n\n> [!note]\n> keep   this\n',
    )
  })
})

const across = (editor: InkKitEditor, first: string, last: string) => {
  const snapshot = editor.textSnapshot()
  const from = snapshot.text.indexOf(first)
  const to = snapshot.text.indexOf(last) + last.length
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThan(from)
  return { snapshotId: snapshot.snapshotId, from, to }
}

test.each([
  ['two list items', '- alpha\n- beta\n', 'alpha', 'beta'],
  ['two nested items', '- top\n  - alpha\n  - beta\n', 'alpha', 'beta'],
  ['two quote paragraphs', '> alpha\n>\n> beta\n', 'alpha', 'beta'],
  [
    'two table cells',
    '| a | b |\n| - | - |\n| alpha | beta |\n',
    'alpha',
    'beta',
  ],
  ['a list item and its paragraph', '- alpha\n\n  beta\n', 'alpha', 'beta'],
  [
    'part of a callout title',
    '> [!note] alpha beta\n> body\n',
    'alpha',
    'beta',
  ],
  ['a hard break in an item', '- alpha\\\n  beta\n', 'alpha', 'beta'],
  ['a hidden comment in an item', '- alpha%%secret%%beta\n', 'alpha', 'beta'],
])('replaceTextRange still refuses a range across %s', (_name, text, a, b) =>
  run(text, (editor) => {
    const before = editor.snapshot()
    expect(() => editor.replaceTextRange(across(editor, a, b), 'X')).toThrow(
      expect.objectContaining({ code: 'invalid-range' }),
    )
    expect(editor.snapshot()).toEqual(before)
  }),
)

test.each([
  [
    'a mark',
    '- alpha **beta** end\n',
    'beta',
    'gamma',
    '- alpha **gamma** end\n',
  ],
  [
    'a new line in a list item',
    '- alpha beta\n',
    'beta',
    'one\ntwo',
    '- alpha one\\\n  two\n',
  ],
  [
    'a code block in a list item',
    '- item\n\n  ```ts\n  const beta = 1\n  ```\n',
    'beta',
    'gamma',
    '- item\n\n  ```ts\n  const gamma = 1\n  ```\n',
  ],
  [
    'a table cell with a mark',
    '| a | b |\n| - | - |\n| **beta** | x |\n',
    'beta',
    'gamma',
    '| a | b |\n| - | - |\n| **gamma** | x |\n',
  ],
])(
  'replaceTextRange handles %s inside a container',
  (_name, before, old, text, after) =>
    run(before, async (editor) => {
      expect(editor.replaceTextRange(range(editor, old), text)).toBe(true)
      expect(editor.snapshot().text).toBe(after)
      await reopens(after)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(before)
    }),
)

test('replaceTextRange inserts at a caret-sized range inside an item', () =>
  run('- alpha\n- beta\n', (editor) => {
    const { snapshotId } = editor.textSnapshot()
    expect(editor.replaceTextRange({ snapshotId, from: 5, to: 5 }, '!')).toBe(
      true,
    )
    expect(editor.snapshot().text).toBe('- alpha!\n- beta\n')
  }))
