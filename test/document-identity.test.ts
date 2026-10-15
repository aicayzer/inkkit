import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  InkKitEditor,
  type ClipboardOutput,
  type CommandState,
  type DocumentSnapshot,
  type EditorEvents,
  type EditorOptions,
  type InkKitError,
} from '../src/index'
import { editorEvents } from '../src/editor'

interface Session {
  editor: InkKitEditor
  root: HTMLElement
  view: EditorView
  errors: InkKitError[]
  changes: DocumentSnapshot[]
  states: CommandState[]
}

async function open(
  run: (session: Session) => void | Promise<void>,
  options: EditorOptions = {},
  events: Partial<EditorEvents> = {},
): Promise<void> {
  const errors: InkKitError[] = []
  const changes: DocumentSnapshot[] = []
  const states: CommandState[] = []
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed: (snapshot) => changes.push(snapshot),
      commandStateChanged: (state) => states.push(state),
      error: (error) => errors.push(error),
      ...events,
    },
    options,
  )
  const view = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
    editorViewCtx,
  )
  try {
    await run({ editor, root, view, errors, changes, states })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = {
  documentId: 'identity',
  generation: 3,
  format: 'md' as const,
  text: '# Title\n\nText with a note[^1] and a [link][ref].\n\n[^1]: Body\n\n[ref]: https://example.com\n',
}

const images = {
  presentation: () => undefined,
  importImage: async () => ({ reference: 'imported.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
  }),
}

const code = (code: InkKitError['code']) =>
  expect.objectContaining({ name: 'InkKitError', code })

/** What a refused call must leave alone. */
function state(session: Session) {
  const { editor, root } = session
  const snapshot = editor.snapshot()
  const commands = editor.commandState().commands
  return {
    snapshot,
    selection: editor.textSnapshot().selection,
    undo: commands.undo,
    redo: commands.redo,
    mode: editor.editingMode,
    focused: root.contains(document.activeElement),
    changes: session.changes.length,
    states: session.states.length,
    errors: session.errors.length,
  }
}

function selectText(view: EditorView, text: string): void {
  let from = -1
  view.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text!.includes(text))
      from = pos + node.text!.indexOf(text)
    return from < 0
  })
  expect(from).toBeGreaterThanOrEqual(0)
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, from, from + text.length),
    ),
  )
}

test('a load or reload must bring a greater generation, and a refused one changes nothing', () =>
  open(async (session) => {
    const { editor } = session
    // The first load accepts any generation, including zero.
    editor.loadDocument({ ...input, generation: 0 })
    editor.loadDocument(input)
    editor.insertText('!', 3)
    const before = state(session)
    for (const generation of [3, 2, -1]) {
      expect(() => editor.loadDocument({ ...input, generation })).toThrow(
        code('invalid-argument'),
      )
      expect(() =>
        editor.reloadDocument({ ...input, generation, text: 'Other\n' }),
      ).toThrow(code('invalid-argument'))
      expect(state(session)).toEqual(before)
    }
    editor.reloadDocument({ ...input, generation: 4, text: 'Reloaded\n' })
    expect(editor.snapshot()).toMatchObject({
      generation: 4,
      revision: 0,
      text: 'Reloaded\n',
    })
    editor.loadDocument({ ...input, documentId: 'next', generation: 10 })
    expect(editor.snapshot()).toMatchObject({
      documentId: 'next',
      generation: 10,
    })
  }))

test('reloadDocument checks the expected generation before it replaces anything', () =>
  open(async (session) => {
    const { editor } = session
    expect(() => editor.reloadDocument({ ...input }, 3)).toThrow(
      code('not-ready'),
    )
    editor.loadDocument(input)
    editor.insertText('!', 3)
    const before = state(session)
    expect(() =>
      editor.reloadDocument({ ...input, generation: 5, text: 'Lost\n' }, 2),
    ).toThrow(code('stale-document'))
    // A stale expectation is reported before a generation that does not increase.
    expect(() =>
      editor.reloadDocument({ ...input, generation: 3, text: 'Lost\n' }, 2),
    ).toThrow(code('stale-document'))
    expect(() =>
      editor.reloadDocument({ ...input, generation: 5 }, bad('3')),
    ).toThrow(code('invalid-argument'))
    expect(state(session)).toEqual(before)
    editor.reloadDocument({ ...input, generation: 5, text: 'Kept\n' }, 3)
    expect(editor.snapshot()).toMatchObject({ generation: 5, text: 'Kept\n' })
    editor.reloadDocument({ ...input, generation: 6, text: 'Again\n' }, null!)
    expect(editor.snapshot()).toMatchObject({ generation: 6, text: 'Again\n' })
  }))

/** A value of the wrong type, passed as if it were the right one. */
function bad<T>(value: unknown): T {
  return value as T
}

test('each newly guarded method refuses a stale generation and changes nothing', () =>
  open(
    async (session) => {
      const { editor, view, root } = session
      editor.loadDocument(input)
      selectText(view, 'note')
      const before = state(session)
      const stale = 2
      const sync: [string, () => unknown][] = [
        ['pasteAsPlainText', () => editor.pasteAsPlainText('x', stale)],
        ['insertFootnote', () => editor.insertFootnote(undefined, stale)],
        [
          'navigateFootnote',
          () => editor.navigateFootnote('definition', stale),
        ],
        [
          'editReferenceDefinition',
          () =>
            editor.editReferenceDefinition(
              'ref',
              'https://changed.example',
              undefined,
              stale,
            ),
        ],
        ['focus', () => editor.focus(stale)],
        ['blur', () => editor.blur(stale)],
        ['find', () => editor.find('Body', stale)],
      ]
      for (const [name, call] of sync) {
        expect(call, name).toThrow(code('stale-document'))
        expect(state(session), name).toEqual(before)
      }
      await expect(editor.clipboardSnapshot('document', stale)).rejects.toEqual(
        code('stale-document'),
      )
      await expect(
        editor.paste({ text: 'x', markdown: '**x**' }, stale),
      ).rejects.toEqual(code('stale-document'))
      expect(state(session)).toEqual(before)
      expect(root.contains(document.activeElement)).toBe(false)

      // The current generation, or none, lets each of them run.
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, view.state.selection.to),
        ),
      )
      expect(editor.navigateFootnote('definition', 3)).toBe(true)
      expect(editor.navigateFootnote('reference', null!)).toBe(true)
      expect(
        editor.editReferenceDefinition(
          'ref',
          'https://changed.example',
          undefined,
          3,
        ),
      ).toBe(true)
      expect(editor.snapshot().text).toContain('[ref]: https://changed.example')
      expect(editor.insertFootnote('two', 3)).toBe(true)
      expect(editor.snapshot().text).toContain('[^two]')
      editor.focus(3)
      expect(root.contains(document.activeElement)).toBe(true)
      editor.blur(3)
      expect(root.contains(document.activeElement)).toBe(false)
      expect((await editor.clipboardSnapshot('document', 3)).generation).toBe(3)
      await editor.paste({ text: 'pasted', markdown: 'pasted' }, 3)
      expect(editor.snapshot().text).toContain('pasted')
    },
    { images },
  ))

test('results say whether a call did anything', () =>
  open(({ editor, view }) => {
    editor.loadDocument(input)
    expect(editor.find('Body', 3)).toBe(true)
    expect(editor.find('Absent', 3)).toBe(false)
    selectText(view, 'Text')
    expect(editor.pasteAsPlainText('Words', 3)).toBe(true)
    expect(editor.snapshot().text).toContain('Words with a note')
    // Nothing selected and nothing to insert changes nothing.
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    )
    const revision = editor.snapshot().revision
    expect(editor.pasteAsPlainText('', 3)).toBe(false)
    expect(editor.snapshot().revision).toBe(revision)
    editor.setEditingMode('source', 3)
    expect(editor.find('Body', 3)).toBe(true)
    expect(editor.find('Absent', 3)).toBe(false)
    expect(editor.insertFootnote(undefined, 3)).toBe(false)
    expect(editor.pasteAsPlainText('', 3)).toBe(false)
    expect(editor.pasteAsPlainText('More', 3)).toBe(true)
    editor.loadDocument({ ...input, generation: 4, format: 'txt' })
    expect(editor.insertFootnote(undefined, 4)).toBe(false)
  }))

test('every output names the document, generation and revision it describes', () =>
  open(
    async ({ editor, view, changes, states }) => {
      editor.loadDocument(input)
      expect(states.at(-1)).toMatchObject({
        documentId: 'identity',
        generation: 3,
        revision: 0,
      })
      editor.insertText('!', 3)
      const version = { documentId: 'identity', generation: 3, revision: 1 }
      expect(editor.snapshot()).toMatchObject(version)
      expect(editor.commandState(3)).toMatchObject(version)
      expect(editor.textSnapshot(3)).toMatchObject(version)
      expect(editor.headings(3)[0]).toMatchObject(version)
      expect(await editor.printableSnapshot(3)).toMatchObject(version)
      expect(await editor.clipboardSnapshot()).toMatchObject(version)
      selectText(view, 'Title')
      expect(await editor.clipboardSnapshot('selection', 3)).toMatchObject({
        ...version,
        text: 'Title',
      })
      expect(changes.at(-1)).toMatchObject(version)
      expect(states.at(-1)).toMatchObject(version)
      editor.setEditingMode('source', 3)
      editor.replaceSource('# Source\n', 3)
      const source = { ...version, revision: 2 }
      expect(await editor.clipboardSnapshot()).toMatchObject({
        ...source,
        markdown: '# Source\n',
      })
      expect(changes.at(-1)).toMatchObject(source)
      editor.loadDocument({
        ...input,
        documentId: 'plain',
        generation: 7,
        format: 'txt',
        text: 'Plain\r\n',
      })
      expect(await editor.clipboardSnapshot()).toEqual({
        documentId: 'plain',
        generation: 7,
        revision: 0,
        text: 'Plain\r\n',
        html: '<pre>Plain\r\n</pre>',
        markdown: 'Plain\r\n',
        images: [],
        diagrams: [],
      })
    },
    { images },
  ))

test('changed receives a snapshot of the document it reports', () =>
  open(({ editor, view, changes, root }) => {
    editor.loadDocument(input)
    expect(changes).toEqual([])
    // An edit to heading text, which once took a second transaction for the heading's ID.
    view.dispatch(view.state.tr.insertText('!', 3))
    expect(changes).toEqual([editor.snapshot()])
    const text = editor.snapshot().text
    expect(changes).toEqual([
      {
        documentId: 'identity',
        generation: 3,
        revision: 1,
        format: 'md',
        text,
        dirty: true,
      },
    ])
    editor.undo(3)
    expect(changes.at(-1)).toEqual(editor.snapshot())
    expect(changes.at(-1)).toMatchObject({
      revision: 2,
      text: input.text,
      dirty: false,
    })
    // A paragraph edit and its undo report the revision later outputs carry.
    view.dispatch(
      view.state.tr.insertText('?', view.state.doc.content.size - 2),
    )
    expect(changes.at(-1)).toEqual(editor.snapshot())
    expect(changes.at(-1)!.revision).toBe(3)
    editor.undo(3)
    expect(changes.at(-1)).toEqual(editor.snapshot())
    expect(changes.at(-1)!.revision).toBe(4)
    // Source typing reports at once, with the revision snapshots carry.
    editor.setEditingMode('source', 3)
    const plain = root.querySelector('textarea')!
    plain.value = '# Typed\n'
    plain.setSelectionRange(7, 7)
    plain.dispatchEvent(new Event('input'))
    expect(changes.at(-1)).toEqual(editor.snapshot())
    expect(changes.at(-1)).toMatchObject({ text: '# Typed\n', dirty: true })
  }))

test('caret state arrives only with command state, which carries identity', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  await expect(
    InkKitEditor.mount(root, {
      changed() {},
      ...{ stateChanged() {} },
    }),
  ).rejects.toEqual(code('invalid-argument'))
  root.remove()
  await open(({ editor, view, states }) => {
    editor.loadDocument(input)
    selectText(view, 'link')
    expect(states.at(-1)).toMatchObject({
      documentId: 'identity',
      generation: 3,
      caret: { marks: ['link'], block: { type: 'paragraph' } },
    })
    selectText(view, 'Title')
    expect(states.at(-1)!.caret.block).toEqual({ type: 'heading', level: 1 })
  })
})

test('clipboard output from a person’s copy carries the version it was copied from', () => {
  const written: ClipboardOutput[] = []
  return open(
    async ({ editor, view, root, errors }) => {
      editor.loadDocument({ ...input, text: 'Before ![photo](a.png) after\n' })
      editor.insertText('!', 3)
      const version = editor.snapshot()
      for (const mode of ['formatted', 'source'] as const) {
        editor.setEditingMode(mode, 3)
        const target =
          mode === 'source' ? root.querySelector('textarea')! : view.dom
        if (mode === 'source') {
          const plain = root.querySelector('textarea')!
          plain.setSelectionRange(0, plain.value.length)
        } else
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(
                view.state.doc,
                1,
                view.state.doc.content.size - 1,
              ),
            ),
          )
        const copy = new Event('copy', { bubbles: true, cancelable: true })
        Object.defineProperty(copy, 'clipboardData', {
          value: { setData() {}, getData: () => '' },
        })
        target.dispatchEvent(copy)
        await vi.waitFor(() =>
          expect(written).toHaveLength(mode === 'source' ? 2 : 1),
        )
        expect(written.at(-1)).toMatchObject({
          documentId: version.documentId,
          generation: version.generation,
          revision: version.revision,
        })
      }
      expect(errors).toEqual([])
    },
    { images },
    { clipboard: (content) => void written.push(content) },
  )
})

test('clipboardSnapshot takes a named scope, and paste takes no plainText field', () =>
  open(async ({ editor, view }) => {
    editor.loadDocument(input)
    selectText(view, 'Title')
    expect((await editor.clipboardSnapshot()).markdown).toBe(input.text)
    expect((await editor.clipboardSnapshot(null!)).markdown).toBe(input.text)
    expect((await editor.clipboardSnapshot('document')).markdown).toBe(
      input.text,
    )
    expect((await editor.clipboardSnapshot('selection')).text).toBe('Title')
    for (const scope of [false, true, 'all', 'Selection'])
      await expect(editor.clipboardSnapshot(bad(scope))).rejects.toEqual(
        code('invalid-argument'),
      )
    const before = editor.snapshot()
    await expect(
      editor.paste(bad({ text: '**x**', plainText: true })),
    ).rejects.toEqual(code('invalid-argument'))
    expect(editor.snapshot()).toEqual(before)
    expect('textRangeRects' in editor).toBe(false)
  }))

test('blur releases only InkKit’s own text surfaces', () =>
  open(({ editor, root }) => {
    expect(() => editor.blur()).toThrow(code('not-ready'))
    const host = document.createElement('input')
    document.body.append(host)
    let generation = input.generation
    try {
      for (const [format, mode] of [
        ['md', 'formatted'],
        ['md', 'source'],
        ['txt', 'source'],
      ] as const) {
        editor.loadDocument({ ...input, generation: ++generation, format })
        if (format === 'md') editor.setEditingMode(mode, generation)
        editor.focus(generation)
        const surface = document.activeElement
        expect(root.contains(surface), `${format} ${mode}`).toBe(true)
        const before = editor.snapshot()
        editor.blur(generation)
        expect(root.contains(document.activeElement)).toBe(false)
        expect(editor.snapshot()).toEqual(before)
        // Focus elsewhere is left where it is.
        host.focus()
        editor.blur(generation)
        expect(document.activeElement).toBe(host)
      }
    } finally {
      host.remove()
    }
  }))

test('openLink and copy are optional, and without copy no Copy button is drawn', async () => {
  for (const copy of [undefined, vi.fn()]) {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(root, {
      changed() {},
      ...(copy ? { copy } : {}),
    })
    try {
      editor.loadDocument({
        ...input,
        text: '```js\ncode()\n```\n\n[link](https://example.com)\n',
      })
      const button = root.querySelector<HTMLButtonElement>(
        'pre button.inkkit-copy',
      )
      expect(!!button).toBe(!!copy)
      button?.click()
      if (copy) expect(copy).toHaveBeenCalledWith('code()')
      const link = root.querySelector('a[href]')!
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        metaKey: true,
        ctrlKey: true,
      })
      expect(() => link.dispatchEvent(click)).not.toThrow()
      expect(click.defaultPrevented).toBe(true)
    } finally {
      await editor.destroy()
      root.remove()
    }
  }
})

test('snapshot and heading IDs change with every load, edit and mode change', () =>
  open(({ editor }) => {
    editor.loadDocument(input)
    const ids = () => [
      editor.textSnapshot().snapshotId,
      editor.headings()[0]!.id,
    ]
    const seen = [ids()]
    editor.reloadDocument({ ...input, generation: 4 })
    seen.push(ids())
    editor.insertText('!', 4)
    seen.push(ids())
    editor.setEditingMode('source', 4)
    editor.setEditingMode('formatted', 4)
    seen.push(ids())
    expect(new Set(seen.map(([id]) => id)).size).toBe(seen.length)
    expect(new Set(seen.map(([, id]) => id)).size).toBe(seen.length)
    // Reading again without a change keeps them.
    expect(ids()).toEqual(seen.at(-1))
  }))

test('the API reference has a row for every event and no other', () => {
  const api = readFileSync('docs/api.md', 'utf8')
  const section = api.slice(api.indexOf('\n## Events\n'))
  const table = section.slice(0, section.indexOf('\n## ', 1))
  const documented = [...table.matchAll(/^\| `([a-zA-Z]+)` +\|/gm)].map(
    (match) => match[1],
  )
  expect(documented).toEqual([...editorEvents])
})
