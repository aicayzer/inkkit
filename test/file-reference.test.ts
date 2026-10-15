import { expect, test, vi } from 'vitest'
import {
  InkKitEditor,
  type FileAdapter,
  type FileReference,
} from '../src/index'

// Each syntax form, with the FileReference the host receives for it.
const forms: [string, FileReference][] = [
  [
    '![](a/b.mp4#t=10)',
    {
      kind: 'path',
      reference: 'a/b.mp4#t=10',
      target: 'a/b.mp4',
      fragment: 't=10',
    },
  ],
  [
    // A `#` in a file name is written `%23` and is not decoded.
    '![Notes](My%23Notes.pdf)',
    {
      kind: 'path',
      reference: 'My%23Notes.pdf',
      target: 'My%23Notes.pdf',
      label: 'Notes',
    },
  ],
  [
    // `?` has no meaning, and the fragment is everything after the first `#`.
    '![](a.pdf?x=1#page=2#more)',
    {
      kind: 'path',
      reference: 'a.pdf?x=1#page=2#more',
      target: 'a.pdf?x=1',
      fragment: 'page=2#more',
    },
  ],
  [
    '![Wide|320](<a b.pdf#>)',
    {
      kind: 'path',
      reference: 'a b.pdf#',
      target: 'a b.pdf',
      fragment: '',
      label: 'Wide',
      width: 320,
    },
  ],
  [
    // Markdown resolves a backslash escape before InkKit sees the address, so
    // an escaped `#` still starts the fragment.
    String.raw`![](My\#Notes.pdf)`,
    {
      kind: 'path',
      reference: 'My#Notes.pdf',
      target: 'My',
      fragment: 'Notes.pdf',
    },
  ],
  [
    '![](plain.png)',
    { kind: 'path', reference: 'plain.png', target: 'plain.png' },
  ],
  [
    '![[My file.pdf#page=3]]',
    {
      kind: 'wiki',
      reference: 'My file.pdf#page=3',
      target: 'My file.pdf',
      fragment: 'page=3',
      label: 'My file.pdf#page=3',
    },
  ],
  [
    '![[ Spaced.pdf # page=4 |200]]',
    {
      kind: 'wiki',
      reference: 'Spaced.pdf#page=4',
      target: 'Spaced.pdf',
      fragment: 'page=4',
      label: 'Spaced.pdf#page=4',
      width: 200,
    },
  ],
  [
    // An escaped `#` belongs to the name, so the target is not the reference cut at its first `#`.
    String.raw`![[My\#Notes.pdf#page=2]]`,
    {
      kind: 'wiki',
      reference: 'My#Notes.pdf#page=2',
      target: 'My#Notes.pdf',
      fragment: 'page=2',
      label: 'My#Notes.pdf#page=2',
    },
  ],
  [
    '![[Photo.png]]',
    {
      kind: 'wiki',
      reference: 'Photo.png',
      target: 'Photo.png',
      label: 'Photo.png',
    },
  ],
]

test('FileReference gives the target without its fragment for every syntax form', async () => {
  const resolved: FileReference[] = []
  const opened: FileReference[] = []
  const menus: FileReference[] = []
  const adapter: FileAdapter = {
    resolve: async (reference) => {
      resolved.push(reference)
      return { kind: 'file', label: reference.target }
    },
    open: (reference) => opened.push(reference),
    contextMenu: (reference) => menus.push(reference),
  }
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {} },
    { files: adapter, wikiLinks: { open() {} } },
  )
  // CRLF line endings, as a note written on Windows has them.
  const text = forms.map(([source]) => source).join('\r\n\r\n') + '\r\n'
  try {
    editor.loadDocument({
      documentId: 'files',
      generation: 1,
      format: 'md',
      text,
    })
    await vi.waitFor(() => expect(resolved).toHaveLength(forms.length))
    expect(resolved).toEqual(forms.map(([, reference]) => reference))
    for (const reference of resolved)
      expect(reference.target === reference.reference).toBe(
        reference.fragment === undefined,
      )

    const cards = [...root.querySelectorAll<HTMLElement>('.inkkit-file')]
    expect(cards).toHaveLength(forms.length)
    cards[0]!
      .querySelector<HTMLButtonElement>('.inkkit-file-name button')!
      .click()
    cards[8]!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 8 }),
    )
    expect(opened).toEqual([forms[0]![1]])
    expect(menus).toEqual([forms[8]![1]])
    expect(editor.snapshot().text).toBe(text)
  } finally {
    await editor.destroy()
    root.remove()
  }
})
