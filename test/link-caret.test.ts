import { expect, test } from 'vitest'
import { InkKitEditor, type CaretState } from '../src/core'
import { doc, para, rich, withRichEditor } from './formats/rtf/harness'

async function run(
  text: string,
  body: (editor: InkKitEditor, caret: () => CaretState) => void,
  format: 'md' | 'txt' = 'md',
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, { changed() {} })
  try {
    editor.loadDocument({ documentId: 'link', generation: 1, format, text })
    body(editor, () => editor.commandState().caret)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
function select(editor: InkKitEditor, from: string, to = from, end = false) {
  const snapshot = editor.textSnapshot()
  const start = snapshot.text.indexOf(from)
  expect(start).toBeGreaterThanOrEqual(0)
  const first = end ? start + from.length : start
  const last =
    to === from ? start + from.length : snapshot.text.indexOf(to) + to.length
  editor.selectTextRange({
    snapshotId: snapshot.snapshotId,
    from: first,
    to: end ? first : last,
  })
}

test('the caret state carries the address of the link at the caret', () =>
  run(
    'Read [the notes](https://example.com/notes "T") now.\n',
    (editor, caret) => {
      editor.selectTextRange({
        ...editor.textSnapshot().selection,
        from: 0,
        to: 0,
      })
      expect(caret().marks).not.toContain('link')
      expect(caret()).not.toHaveProperty('href')
      const text = editor.textSnapshot().text
      const inside = text.indexOf('notes')
      const { snapshotId } = editor.textSnapshot()
      editor.selectTextRange({ snapshotId, from: inside, to: inside })
      expect(caret().marks).toContain('link')
      expect(caret().href).toBe('https://example.com/notes')
    },
  ))

test('a range names the first link it touches, and a range without a link has none', () =>
  run(
    'Plain [one](https://one.test/) mid [two](https://two.test/) end\n',
    (editor, caret) => {
      select(editor, 'Plain', 'end')
      expect(caret().href).toBe('https://one.test/')
      select(editor, 'mid ', 'two')
      expect(caret().href).toBe('https://two.test/')
      select(editor, 'Plain ')
      expect(caret().marks).not.toContain('link')
      expect(caret().href).toBeUndefined()
      select(editor, 'two')
      expect(caret().href).toBe('https://two.test/')
    },
  ))

test('an autolink, a reference link and a relative link report their addresses', () =>
  run(
    'See <https://auto.test/x>, [ref][r] and [rel](notes/a.md).\n\n[r]: https://ref.test/page\n',
    (editor, caret) => {
      select(editor, 'https://auto.test/x')
      expect(caret().href).toBe('https://auto.test/x')
      select(editor, 'ref')
      expect(caret().href).toBe('https://ref.test/page')
      select(editor, 'rel')
      expect(caret().href).toBe('notes/a.md')
    },
  ))

test('a caret just after a link is outside it, as its marks say', () =>
  run('A [link](https://x.test/) tail\n', (editor, caret) => {
    select(editor, 'link', 'link', true)
    expect(caret().marks).not.toContain('link')
    expect(caret().href).toBeUndefined()
  }))

test('the address follows a change made by format and an undo', () =>
  run('A [link](https://x.test/) tail\n', (editor, caret) => {
    select(editor, 'link')
    editor.format('link', { destination: 'https://y.test/' })
    expect(caret().href).toBe('https://y.test/')
    editor.undo()
    expect(caret().href).toBe('https://x.test/')
    editor.format('link', { destination: undefined })
    expect(caret().href).toBeUndefined()
  }))

test('source and TXT surfaces have no link address', async () => {
  await run('A [link](https://x.test/) tail\n', (editor, caret) => {
    editor.setEditingMode('source')
    expect(caret()).not.toHaveProperty('href')
  })
  await run(
    'A https://x.test/ tail\n',
    (_editor, caret) => {
      expect(caret()).not.toHaveProperty('href')
    },
    'txt',
  )
})

test('an RTF link reports its address too', () =>
  withRichEditor({}, ({ editor }) => {
    editor.loadDocument(
      rich(
        doc(
          para(
            { type: 'text', text: 'See ' },
            {
              type: 'text',
              text: 'here',
              marks: [{ type: 'link', href: 'https://rtf.test/' }],
            },
          ),
        ),
      ),
    )
    const snapshot = editor.textSnapshot()
    const at = snapshot.text.indexOf('here') + 1
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from: at,
      to: at,
    })
    expect(editor.commandState().caret.href).toBe('https://rtf.test/')
  }))
