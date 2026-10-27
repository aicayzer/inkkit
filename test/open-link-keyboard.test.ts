import { afterEach, expect, test } from 'vitest'
import { InkKitEditor, type WikiLinkReference } from '../src/core'

const editors: InkKitEditor[] = []
afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.destroy()
  document.body.replaceChildren()
})

async function mount(text: string) {
  const root = document.createElement('div')
  document.body.append(root)
  const links: string[] = []
  const wiki: WikiLinkReference[] = []
  const errors: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      openLink: (href) => links.push(href),
      error: (error) => errors.push(error.code),
    },
    {
      keymap: { openLink: ['Ctrl-o'] },
      linkSchemes: ['things'],
      wikiLinks: { open: (reference) => wiki.push(reference) },
    },
  )
  editors.push(editor)
  editor.loadDocument({
    documentId: 'links',
    generation: 1,
    format: 'md',
    text,
  })
  return { editor, root, links, wiki, errors }
}
const key = { key: 'o', code: 'KeyO', ctrlKey: true }

for (const editable of [true, false]) {
  for (const ending of ['\n', '\r\n']) {
    test(`keyboard link opening preserves ${editable ? 'editable' : 'read-only'} ${JSON.stringify(ending)} source`, async () => {
      const source =
        '[Café **日本語**](https://example.com/path) and [[ Plan# section | alias ]]  \n\n[ref][r]\n\n[r]: things:open\n'.replaceAll(
          '\n',
          ending,
        )
      const { editor, links, wiki, errors } = await mount(source)
      editor.setEditable(editable)
      const before = editor.snapshot()
      editor.find('日本語')
      expect(editor.keyDown(key, 1)).toBe(true)
      expect(links).toEqual(['https://example.com/path'])
      const projection = editor.textSnapshot()
      const from = projection.text.indexOf(' alias ')
      editor.selectTextRange({
        snapshotId: projection.snapshotId,
        from,
        to: from + 7,
      })
      expect(editor.keyDown(key, 1)).toBe(true)
      expect(wiki).toEqual([
        expect.objectContaining({
          raw: '[[ Plan# section | alias ]]',
          target: ' Plan',
          fragment: ' section ',
          label: ' alias ',
        }),
      ])
      editor.find('ref')
      expect(editor.keyDown(key, 1)).toBe(true)
      expect(links.at(-1)).toBe('things:open')
      expect(editor.snapshot()).toEqual(before)
      expect(editor.commandState().commands.undo).toBe(false)
      expect(errors).toEqual([])
      editor.loadDocument({
        documentId: 'reopened',
        generation: 2,
        format: 'md',
        text: editor.snapshot().text,
      })
      expect(editor.snapshot().text).toBe(source)
      expect(() => editor.keyDown(key, 1)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
    })
  }
}

test('unsafe targets, plain text, source mode, composition and removed bindings never open a link', async () => {
  const { editor, root, links } = await mount(
    '[bad](javascript:alert) plain [good](https://example.com)\n',
  )
  editor.find('bad')
  editor.keyDown(key, 1)
  editor.find('plain')
  editor.keyDown(key, 1)
  editor.find('good')
  const surface = root.querySelector('.ProseMirror')!
  surface.dispatchEvent(
    new CompositionEvent('compositionstart', { bubbles: true }),
  )
  expect(editor.keyDown(key, 1)).toBe(false)
  surface.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true }),
  )
  editor.setEditingMode('source')
  expect(editor.keyDown(key, 1)).toBe(false)
  editor.setEditingMode('formatted')
  editor.setKeymap({ openLink: [] })
  expect(editor.keyDown(key, 1)).toBe(false)
  expect(links).toEqual([])
})

test('read-only Enter binding opens once and later shortcut groups retain precedence', async () => {
  const { editor, links } = await mount('[link](https://example.com)\n')
  editor.setKeymap({ openLink: ['Shift-Enter'] })
  editor.find('link')
  editor.setEditable(false)
  expect(editor.keyDown({ key: 'Enter', shiftKey: true }, 1)).toBe(true)
  expect(links).toEqual(['https://example.com'])
  editor.setKeymap({ openLink: ['Ctrl-b'], bold: ['Ctrl-b'] })
  expect(() => editor.keyDown({ key: 'b', ctrlKey: true }, 1)).toThrow(
    expect.objectContaining({ code: 'read-only' }),
  )
  expect(links).toHaveLength(1)
})
