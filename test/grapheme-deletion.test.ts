import { expect, test, vi } from 'vitest'
import { InkKitEditor } from '../src/core'

type Format = 'md' | 'txt'
type DeleteKey = 'Backspace' | 'Delete'
const formats = ['md', 'txt'] as const
const keys = ['Backspace', 'Delete'] as const
const generation = 12

async function run(
  format: Format,
  text: string,
  callback: (
    editor: InkKitEditor,
    plain: HTMLTextAreaElement,
    changed: ReturnType<typeof vi.fn>,
  ) => void,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const changed = vi.fn()
  const editor = await InkKitEditor.mount(root, { changed })
  try {
    editor.loadDocument({ documentId: 'graphemes', generation, format, text })
    if (format === 'md') editor.setEditingMode('source')
    callback(editor, root.querySelector('textarea')!, changed)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function select(editor: InkKitEditor, from: number, to = from) {
  const { snapshotId } = editor.textSnapshot()
  editor.selectTextRange({ snapshotId, from, to })
}

function selection(editor: InkKitEditor) {
  const { from, to } = editor.textSnapshot().selection
  return [from, to]
}

function deleteAndRoundtrip(
  editor: InkKitEditor,
  key: DeleteKey,
  expected: string,
  from: number,
  to: number,
) {
  const before = editor.snapshot()
  expect(editor.keyDown({ key }, generation)).toBe(true)
  expect(editor.snapshot()).toMatchObject({
    text: expected,
    revision: before.revision + 1,
    dirty: true,
  })
  expect(selection(editor)).toEqual([from, from])
  expect(editor.undo()).toBe(true)
  expect(editor.snapshot().text).toBe(before.text)
  expect(selection(editor)).toEqual([from, to])
  expect(editor.redo()).toBe(true)
  expect(editor.snapshot().text).toBe(expected)
  expect(selection(editor)).toEqual([from, from])
  const saved = editor.snapshot()
  editor.loadDocument({ ...saved, generation: generation + 1 })
  expect(editor.snapshot().text).toBe(expected)
  expect(editor.snapshot().dirty).toBe(false)
  expect(editor.undo()).toBe(false)
}

const boundaries = formats.flatMap((format) =>
  keys.flatMap((key) =>
    ['👩🏽‍💻', '🇬🇧', 'e\u0301'].map((cluster) => ({ format, key, cluster })),
  ),
)
test.each(boundaries)(
  '$format $key deletes the complete boundary grapheme $cluster',
  ({ format, key, cluster }) =>
    run(format, `A${cluster}B`, (editor, _plain, changed) => {
      select(editor, key === 'Backspace' ? 1 + cluster.length : 1)
      changed.mockClear()
      deleteAndRoundtrip(editor, key, 'AB', 1, 1 + cluster.length)
      expect(changed).toHaveBeenCalledTimes(3)
    }),
)

const interiors = [
  { format: 'md', cluster: '👩‍💻', caret: 3 },
  { format: 'txt', cluster: '🇬🇧', caret: 3 },
  { format: 'md', cluster: 'e\u0301', caret: 2 },
] as const
test.each(interiors.flatMap((row) => keys.map((key) => ({ ...row, key }))))(
  '$format $key deletes the whole cluster at interior offset $caret in $cluster',
  ({ format, key, cluster, caret }) =>
    run(format, `A${cluster}B`, (editor) => {
      select(editor, caret)
      deleteAndRoundtrip(editor, key, 'AB', 1, 1 + cluster.length)
    }),
)

test.each(keys)(
  '%s removes a whole surrogate pair at an interior DOM caret without relaxing public range validation',
  (key) =>
    run('md', 'A😀B', (editor, plain) => {
      const before = editor.snapshot()
      expect(() => select(editor, 2)).toThrow(
        expect.objectContaining({ code: 'invalid-range' }),
      )
      expect(editor.snapshot()).toEqual(before)
      plain.setSelectionRange(2, 2)
      deleteAndRoundtrip(editor, key, 'AB', 1, 3)
    }),
)

test('Delete uses preceding regional-indicator context at an interior flag caret', () =>
  run('txt', 'A🇬🇧🇺B', (editor) => {
    select(editor, 3)
    deleteAndRoundtrip(editor, 'Delete', 'A🇺B', 1, 5)
  }))

test.each([
  { format: 'md', key: 'Backspace', cluster: '👩🏽‍💻' },
  { format: 'txt', key: 'Delete', cluster: 'e\u0301' },
] as const)(
  '$format $key retains BOM and untouched mixed line endings',
  ({ format, key, cluster }) =>
    run(format, `\uFEFFpre\r\nA${cluster}B\nkeep\rfinal`, (editor) => {
      const from = editor.textSnapshot().text.indexOf(cluster)
      select(editor, key === 'Backspace' ? from + cluster.length : from)
      deleteAndRoundtrip(
        editor,
        key,
        '\uFEFFpre\r\nAB\nkeep\rfinal',
        from,
        from + cluster.length,
      )
    }),
)

test('deleting a displayed newline removes its raw CRLF and retains the BOM', () =>
  run('md', '\uFEFFpre\r\nnext\r\nlast', (editor) => {
    const from = editor.textSnapshot().text.indexOf('\n')
    select(editor, from)
    deleteAndRoundtrip(
      editor,
      'Delete',
      '\uFEFFprenext\r\nlast',
      from,
      from + 1,
    )
  }))

test.each(keys)('%s keeps an explicit combining-mark selection exact', (key) =>
  run('txt', 'Ae\u0301B', (editor) => {
    select(editor, 2, 3)
    deleteAndRoundtrip(editor, key, 'AeB', 2, 3)
  }),
)

test.each(formats)('%s preserves grouped deletion history', (format) =>
  run(format, 'A👩‍💻🇬🇧B', (editor) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      select(editor, 1)
      expect(editor.keyDown({ key: 'Delete' }, generation)).toBe(true)
      expect(editor.snapshot().text).toBe('A🇬🇧B')
      expect(editor.keyDown({ key: 'Delete' }, generation)).toBe(true)
      expect(editor.snapshot().text).toBe('AB')
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe('A👩‍💻🇬🇧B')
      expect(selection(editor)).toEqual([1, 6])
      expect(editor.undo()).toBe(false)
      expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe('AB')
      expect(selection(editor)).toEqual([1, 1])
      expect(editor.redo()).toBe(false)
    } finally {
      clock.mockRestore()
    }
  }),
)

test.each(formats.flatMap((format) => keys.map((key) => ({ format, key }))))(
  '$format $key guards preserve source, selection, history and change events',
  ({ format, key }) =>
    run(format, 'A👩‍💻B', (editor, plain, changed) => {
      select(editor, 3)
      const before = editor.snapshot()
      const beforeSelection = selection(editor)
      const history = () => {
        const { undo, redo } = editor.commandState().commands
        return { undo, redo }
      }
      const beforeHistory = history()
      changed.mockClear()
      const unchanged = () => {
        expect(editor.snapshot()).toEqual(before)
        expect(selection(editor)).toEqual(beforeSelection)
        expect(history()).toEqual(beforeHistory)
        expect(changed).not.toHaveBeenCalled()
      }
      expect(() => editor.keyDown({ key }, generation - 1)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      unchanged()
      editor.setEditable(false)
      expect(() => editor.keyDown({ key }, generation)).toThrow(
        expect.objectContaining({ code: 'read-only' }),
      )
      editor.setEditable(true)
      unchanged()
      plain.dispatchEvent(new CompositionEvent('compositionstart'))
      expect(editor.keyDown({ key }, generation)).toBe(false)
      expect(() => editor.keyDown({ key }, generation - 1)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      plain.dispatchEvent(new CompositionEvent('compositionend'))
      unchanged()
    }),
)

test.each(
  formats.flatMap((format) => ['A👩‍💻B', ''].map((text) => ({ format, text }))),
)(
  '$format boundary no-ops and modifier bypass leave $text intact',
  ({ format, text }) =>
    run(format, text, (editor, _plain, changed) => {
      for (const key of keys) {
        select(editor, key === 'Backspace' ? 0 : text.length)
        const before = editor.snapshot()
        const beforeSelection = selection(editor)
        changed.mockClear()
        expect(editor.keyDown({ key }, generation)).toBe(false)
        expect(editor.snapshot()).toEqual(before)
        expect(selection(editor)).toEqual(beforeSelection)
        expect(editor.undo()).toBe(false)
        expect(editor.redo()).toBe(false)
        expect(changed).not.toHaveBeenCalled()
        if (text) {
          select(editor, 3)
          for (const modifier of ['ctrlKey', 'altKey', 'metaKey'])
            expect(editor.keyDown({ key, [modifier]: true }, generation)).toBe(
              false,
            )
          expect(editor.snapshot()).toEqual(before)
          expect(selection(editor)).toEqual([3, 3])
          expect(editor.undo()).toBe(false)
          expect(editor.redo()).toBe(false)
          expect(changed).not.toHaveBeenCalled()
        }
      }
    }),
)
