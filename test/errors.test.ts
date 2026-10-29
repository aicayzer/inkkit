import { ctxOf, documentOf, historyOf } from './editor-access'
import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  InkKitEditor,
  InkKitError,
  type EditorEvents,
  type EditorOptions,
} from '../src/index'
import { editorErrorCodes } from '../src/types'

interface Session {
  editor: InkKitEditor
  root: HTMLElement
  view: EditorView
  errors: InkKitError[]
}

async function open(
  run: (session: Session) => void | Promise<void>,
  options: EditorOptions = {},
  events: Partial<EditorEvents> = {},
): Promise<void> {
  const errors: InkKitError[] = []
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
      ...events,
    },
    options,
  )
  const view = ctxOf(editor).get(editorViewCtx)
  try {
    await run({ editor, root, view, errors })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = {
  documentId: 'errors',
  generation: 1,
  format: 'md' as const,
  text: '# Title\n\nSome text with [a link][ref] and a note.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[ref]: https://example.com\n',
}

const code = (code: InkKitError['code']) =>
  expect.objectContaining({ name: 'InkKitError', code })

/** What a call must leave alone when it throws. */
function state(editor: InkKitEditor) {
  const snapshot = editor.snapshot()
  const commands = editor.commandState().commands
  return {
    text: snapshot.text,
    revision: snapshot.revision,
    selection: editor.textSnapshot().selection,
    undo: commands.undo,
    redo: commands.redo,
    mode: editor.editingMode,
    editable: editor.editable,
    viewport: editor.viewport().insets,
  }
}

test('the API reference has a row for every error code and no other', () => {
  const api = readFileSync('docs/reference/errors.mdx', 'utf8')
  const section = api.slice(api.indexOf('\n## Error codes\n'))
  const table = section.slice(0, section.indexOf('\n## ', 1))
  const documented = [...table.matchAll(/^\| `([a-z-]+)` +\|/gm)].map(
    (match) => match[1],
  )
  expect(documented).toEqual([...editorErrorCodes])
})

test('InkKitError keeps the failure it reports as its cause', () => {
  const cause = new Error('adapter offline')
  const error = new InkKitError('file-unavailable', 'Unavailable', { cause })
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ code: 'file-unavailable', cause })
  expect(new InkKitError('internal', 'No cause').cause).toBeUndefined()
})

test('each bad argument throws invalid-argument and changes nothing', () =>
  open((session) => {
    const { editor, view } = session
    editor.loadDocument(input)
    // A selection that a careless call could move.
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 12, 16)),
    )
    editor.replaceSource(input.text + 'More.\n')
    editor.undo()
    const range = editor.textSnapshot().selection
    const unrelated = document.createElement('div')
    const before = state(editor)
    const bad = (value: unknown) => value as never
    const calls: [string, () => unknown][] = [
      [
        'loadDocument format',
        () => editor.loadDocument({ ...input, format: bad('html') }),
      ],
      [
        'loadDocument text',
        () => editor.loadDocument({ ...input, text: bad(5) }),
      ],
      [
        'loadDocument generation',
        () => editor.loadDocument({ ...input, generation: bad('2') }),
      ],
      ['loadDocument input', () => editor.loadDocument(bad(null))],
      [
        'reloadDocument id',
        () => editor.reloadDocument({ ...input, documentId: bad(1) }),
      ],
      ['snapshot generation', () => editor.snapshot(bad('1'))],
      ['commandState generation', () => editor.commandState(1.5)],
      ['textSnapshot generation', () => editor.textSnapshot(Number.NaN)],
      ['headings generation', () => editor.headings(bad({}))],
      ['setEditingMode mode', () => editor.setEditingMode(bad('bogus'))],
      [
        'setEditingMode generation',
        () => editor.setEditingMode('source', bad('1')),
      ],
      ['replaceSource text', () => editor.replaceSource(bad(5))],
      ['undo generation', () => editor.undo(bad(true))],
      ['redo generation', () => editor.redo(Infinity)],
      ['find text', () => editor.find(bad(1))],
      ['replace replacement', () => editor.replace('text', bad(1))],
      ['replaceAll search', () => editor.replaceAll(bad(null), 'x')],
      ['format command', () => editor.format(bad('overline'))],
      ['format heading level', () => editor.format(bad('heading'))],
      ['format options', () => editor.format('bold', bad('x'))],
      [
        'format option for another command',
        () => editor.format('bold', { destination: 'x' }),
      ],
      [
        'format language for link',
        () => editor.format('link', { language: 'js' }),
      ],
      [
        'format unknown option',
        () => editor.format('codeBlock', bad({ lang: 'js' })),
      ],
      ['format generation', () => editor.format('bold', undefined, bad('1'))],
      [
        'format destination',
        () => editor.format('link', { destination: bad(1) }),
      ],
      ['table generation', () => editor.table('insert', undefined, 1.5)],
      ['table command', () => editor.table(bad('merge'))],
      ['table rows', () => editor.table('insert', { rows: 0 })],
      ['table columns', () => editor.table('insert', { columns: 101 })],
      ['table option', () => editor.table('insert', { column: 1 })],
      ['table unknown option', () => editor.table('insert', bad({ cells: 4 }))],
      ['table order', () => editor.table('sortRows', { order: bad('random') })],
      ['insertText text', () => editor.insertText(bad(5), 1)],
      ['insertText generation', () => editor.insertText('x', bad(undefined))],
      ['keyDown key', () => editor.keyDown({ key: bad(13) }, 1)],
      [
        'keyDown modifier',
        () => editor.keyDown({ key: 'a', metaKey: bad('no') }, 1),
      ],
      [
        'insertPaths paths',
        () => editor.insertPaths(bad('a.png'), { clientX: 0, clientY: 0 }),
      ],
      [
        'insertPaths point',
        () =>
          editor.insertPaths(['a.png'], { clientX: Number.NaN, clientY: 0 }),
      ],
      [
        'insertImages entry',
        () => editor.insertImages([bad({ reference: 1, alt: '' })]),
      ],
      [
        'insertImages point',
        () =>
          editor.insertImages(
            [{ reference: 'a.png', alt: '' }],
            bad({ clientX: 4 }),
          ),
      ],
      [
        'insertImages old field',
        () => editor.insertImages([bad({ path: 'a.png', alt: '' })]),
      ],
      [
        'appendImages entry',
        () => editor.appendImages([bad({ reference: 1, alt: '' })]),
      ],
      [
        'appendImages generation',
        () => editor.appendImages([{ reference: 'a.png', alt: '' }], bad('1')),
      ],
      ['insertFootnote label', () => editor.insertFootnote('a b')],
      ['insertFootnote type', () => editor.insertFootnote(bad(1))],
      ['navigateFootnote target', () => editor.navigateFootnote(bad('next'))],
      [
        'editReferenceDefinition destination',
        () => editor.editReferenceDefinition('ref', bad(1)),
      ],
      [
        'editReferenceDefinition title',
        () => editor.editReferenceDefinition('ref', 'x', bad(1)),
      ],
      ['pasteAsPlainText text', () => editor.pasteAsPlainText(bad(undefined))],
      ['setEditable', () => editor.setEditable(bad('false'))],
      [
        'setTextInputPreferences value',
        () => editor.setTextInputPreferences({ autocapitalize: bad('always') }),
      ],
      [
        'setTextInputPreferences option',
        () => editor.setTextInputPreferences(bad({ spellCheck: true })),
      ],
      ['setCommentsVisible', () => editor.setCommentsVisible(bad(1))],
      ['setKeymap name', () => editor.setKeymap(bad({ overline: ['Mod-u'] }))],
      [
        'setKeymap old heading name',
        () => editor.setKeymap(bad({ heading: ['Mod-h'] })),
      ],
      ['setKeymap keys', () => editor.setKeymap({ bold: bad('Mod-b') })],
      [
        'selectTextRange range',
        () => editor.selectTextRange(bad({ from: 0, to: 0 })),
      ],
      [
        'selectTextRange option',
        () => editor.selectTextRange(range, bad({ scroll: true })),
      ],
      [
        'selectTextRange focus',
        () => editor.selectTextRange(range, { focus: bad('yes') }),
      ],
      ['revealTextRange range', () => editor.revealTextRange(bad(null))],
      ['replaceTextRange text', () => editor.replaceTextRange(range, bad(5))],
      [
        'replaceTextRange offsets',
        () => editor.replaceTextRange({ ...range, from: bad('0') }, 'x'),
      ],
      ['textRangesRects ranges', () => editor.textRangesRects(bad(range))],
      ['visibleTextRanges id', () => editor.visibleTextRanges(bad(1))],
      [
        'setViewport container',
        () => editor.setViewport({ scrollContainer: unrelated }),
      ],
      ['setViewport inset', () => editor.setViewport({ insets: { top: -1 } })],
      [
        'setViewport infinite inset',
        () => editor.setViewport({ insets: { left: Infinity } }),
      ],
      [
        'setViewport option',
        () => editor.setViewport(bad({ inset: { top: 1 } })),
      ],
      ['navigateHeading entry', () => editor.navigateHeading(bad({ id: 'x' }))],
      ['navigateHeading null', () => editor.navigateHeading(bad(null))],
    ]
    for (const [name, call] of calls) {
      expect(call, name).toThrow(code('invalid-argument'))
      expect(state(editor), name).toEqual(before)
    }
    expect(session.errors).toEqual([])
  }))

test('async methods reject bad arguments instead of throwing', () =>
  open(async ({ editor, errors }) => {
    editor.loadDocument(input)
    const before = state(editor)
    const bad = (value: unknown) => value as never
    for (const call of [
      () => editor.paste(bad({ text: 1 })),
      () =>
        editor.paste(
          bad({ text: 'x', images: [{ bytes: [1], mimeType: 'image/png' }] }),
        ),
      () => editor.clipboardSnapshot(bad('all')),
      () => editor.printableSnapshot(bad('1')),
    ]) {
      let pending!: Promise<unknown>
      expect(() => (pending = call() as Promise<unknown>)).not.toThrow()
      await expect(pending).rejects.toEqual(code('invalid-argument'))
    }
    expect(state(editor)).toEqual(before)
    expect(errors).toEqual([])
    const root = document.createElement('div')
    const events = { changed() {}, copy() {}, openLink() {} }
    for (const mount of [
      () => InkKitEditor.mount(bad(null), events),
      () => InkKitEditor.mount(root, bad(null)),
      () => InkKitEditor.mount(root, bad({ ...events, changed: undefined })),
      () => InkKitEditor.mount(root, bad({ ...events, error: 'log' })),
      () => InkKitEditor.mount(root, events, bad({ editable: 'yes' })),
      () => InkKitEditor.mount(root, events, bad({ theme: 'dark' })),
      () => InkKitEditor.mount(root, events, bad({ keymap: { overline: [] } })),
      () => InkKitEditor.mount(root, events, bad({ labels: { copyCode: 1 } })),
    ])
      await expect(mount()).rejects.toEqual(code('invalid-argument'))
    expect(root.classList.contains('inkkit-root')).toBe(false)
  }))

test('null stands for an omitted optional parameter or option', () =>
  open(
    async ({ editor, root, view }) => {
      const omitted = null as never
      editor.loadDocument(input)
      expect(editor.snapshot(omitted).revision).toBe(0)
      expect(editor.commandState(omitted).generation).toBe(1)
      expect(editor.headings(omitted)).toHaveLength(1)
      expect(editor.undo(omitted)).toBe(false)
      const range = { ...editor.textSnapshot(omitted).selection, from: 0 }
      editor.selectTextRange(range, omitted)
      editor.selectTextRange(range, { focus: omitted, reveal: omitted })
      editor.setViewport({
        scrollContainer: omitted,
        insets: { top: omitted, left: 4 },
      })
      expect(editor.viewport().insets).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 4,
      })
      editor.setTextInputPreferences({ spellcheck: omitted })
      // An omitted history binding keeps its default.
      editor.setKeymap({ undo: omitted })
      editor.replaceSource('One\n', omitted)
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: true,
          bubbles: true,
        }),
      )
      expect(editor.snapshot().text).toBe(input.text)
      expect((await editor.clipboardSnapshot(omitted)).markdown).toBe(
        input.text,
      )
      editor.editReferenceDefinition('ref', 'https://example.org', omitted)
      editor.insertFootnote(omitted)
      expect(editor.snapshot().text).toContain('[^1]: ')
      editor.insertImages(
        [{ reference: 'a.png', alt: 'A', title: omitted }],
        omitted,
        omitted,
      )
      expect(editor.snapshot().text).toContain('![A](a.png)')
      editor.loadDocument({ ...input, generation: 2, text: '' })
      expect(editor.table('insert', { rows: omitted, columns: omitted })).toBe(
        true,
      )
      expect(editor.commandState().table).toMatchObject({ rows: 3, columns: 2 })
      await editor.paste({
        text: 'Pasted',
        markdown: omitted,
        html: omitted,
        images: omitted,
      })
      expect(editor.snapshot().text).toContain('Pasted')
      expect(editor.setEditingMode('source', omitted)).toBe(true)
      expect(root.querySelector('textarea')!.hidden).toBe(false)
    },
    {
      images: {
        presentation: () => undefined,
        importImage: async () => ({ reference: 'x' }),
        exportImage: async () => ({
          bytes: new Uint8Array(),
          mimeType: 'image/png',
        }),
      },
      editable: null as never,
      labels: { copyCode: null as never },
      rendering: null as never,
    },
  ))

test('lifecycle and document state failures are thrown, or rejected by async methods', () =>
  open(async ({ editor, root, errors }) => {
    expect(() => editor.snapshot()).toThrow(code('not-ready'))
    await expect(editor.printableSnapshot()).rejects.toEqual(code('not-ready'))
    editor.loadDocument(input)
    expect(() => editor.snapshot(0)).toThrow(code('stale-document'))
    await expect(editor.clipboardSnapshot()).resolves.toBeDefined()
    expect(() =>
      editor.selectTextRange({ ...editor.textSnapshot().selection, to: 9999 }),
    ).toThrow(code('invalid-range'))
    editor.setEditable(false)
    expect(() => editor.replaceSource('x')).toThrow(code('read-only'))
    await expect(editor.paste({ text: 'x' })).rejects.toEqual(code('read-only'))
    editor.setEditable(true)
    editor.setEditingMode('source')
    const textarea = root.querySelector('textarea')!
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(() => editor.snapshot()).toThrow(code('composition'))
    textarea.dispatchEvent(new Event('compositionend'))
    await editor.destroy()
    expect(() => editor.snapshot()).toThrow(code('destroyed'))
    expect(() => editor.editable).toThrow(code('destroyed'))
    await expect(editor.paste({ text: 'x' })).rejects.toEqual(code('destroyed'))
    await expect(editor.destroy()).resolves.toBeUndefined()
    expect(errors).toEqual([])
  }))

test('an import in progress is operation-pending', async () => {
  let finish!: (value: { reference: string }) => void
  await open(
    async ({ editor }) => {
      editor.loadDocument(input)
      const pasting = editor.paste({
        text: '',
        images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
      })
      expect(() => editor.snapshot()).toThrow(code('operation-pending'))
      await expect(editor.paste({ text: 'x' })).rejects.toEqual(
        code('operation-pending'),
      )
      finish({ reference: 'pasted.png' })
      await pasting
    },
    {
      images: {
        presentation: () => undefined,
        importImage: () => new Promise((resolve) => (finish = resolve)),
        exportImage: async () => ({
          bytes: new Uint8Array(),
          mimeType: 'image/png',
        }),
      },
    },
  )
})

let commentGeneration = 100

/** Loads a note with a visible comment and puts the caret inside it. */
function inComment({ editor, view }: Session): void {
  editor.loadDocument({
    ...input,
    generation: ++commentGeneration,
    text: 'A <!--note--> B\n',
  })
  editor.setCommentsVisible(true)
  let at = 0
  view.state.doc.descendants((node, pos) => {
    if (node.type.name.includes('comment')) at = pos + 3
  })
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
  )
}

test('a facade edit that preservation refuses throws to the caller and is not also an event', () => {
  const changes: string[] = []
  return open(
    (session) => {
      const { editor, view, errors } = session
      for (const [name, call] of [
        [
          'insertText',
          () => editor.insertText('-->', editor.commandState().generation),
        ],
        ['pasteAsPlainText', () => editor.pasteAsPlainText('-->')],
      ] as const) {
        inComment(session)
        const before = state(editor)
        const selection = view.state.selection
        expect(call, name).toThrow(code('preservation'))
        expect(state(editor), name).toEqual(before)
        expect(view.state.selection.eq(selection), name).toBe(true)
        expect(errors, name).toEqual([])
        expect(changes, name).toEqual([])
      }
    },
    {},
    { changed: ({ text }) => changes.push(text) },
  )
})

test('a refused format throws and is not also an event', () => {
  const changes: string[] = []
  return open(
    ({ editor, errors }) => {
      // A code block cannot hold the hidden comment, so the conversion is refused.
      editor.loadDocument({ ...input, text: 'A <!--note--> B\n' })
      const before = state(editor)
      expect(() => editor.format('codeBlock')).toThrow(code('preservation'))
      expect(state(editor)).toEqual(before)
      expect(errors).toEqual([])
      expect(changes).toEqual([])
    },
    {},
    { changed: ({ text }) => changes.push(text) },
  )
})

test('a refused facade paste rejects, and the same edit made by the person is an event', () =>
  open(async (session) => {
    const { editor, view, errors } = session
    inComment(session)
    const before = state(editor)
    await expect(editor.paste({ text: '-->' })).rejects.toEqual(
      code('preservation'),
    )
    expect(state(editor)).toEqual(before)
    expect(errors).toEqual([])
    view.dispatch(view.state.tr.insertText('-->'))
    expect(errors).toEqual([code('preservation')])
    expect(errors[0]!.cause).toBeInstanceOf(Error)
    expect(state(editor)).toEqual(before)
  }))

test('a file that cannot be resolved, previewed or opened is file-unavailable', async () => {
  const offline = new Error('offline')
  const opened = new Error('no app')
  await open(
    async ({ editor, root, errors }) => {
      editor.loadDocument({
        ...input,
        text: '![Clip](clip.mp4)\n\n![Photo](photo.png)\n\n[[Other note]]\n',
      })
      await vi.waitFor(() => expect(errors).toHaveLength(1))
      expect(errors[0]).toMatchObject({
        code: 'file-unavailable',
        cause: offline,
      })
      const image = root.querySelector('img')!
      image.dispatchEvent(new Event('error'))
      expect(errors[1]).toMatchObject({ code: 'file-unavailable' })
      root
        .querySelector('.inkkit-wiki-link')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        )
      expect(errors[2]).toMatchObject({
        code: 'file-unavailable',
        cause: opened,
      })
      expect(errors).toHaveLength(3)
    },
    {
      files: {
        resolve: async (reference) => {
          if (reference.reference === 'clip.mp4') throw offline
          return { kind: 'image', url: 'blob:photo', mimeType: 'image/png' }
        },
      },
      wikiLinks: {
        open() {
          throw opened
        },
      },
    },
  )
})

test('copying an image with no clipboard event is clipboard-unavailable', () =>
  open(
    ({ editor, view, errors }) => {
      editor.loadDocument({ ...input, text: 'A ![Photo](photo.png) B\n' })
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
      view.dom.dispatchEvent(copy)
      expect(errors).toEqual([code('clipboard-unavailable')])
    },
    {
      images: {
        presentation: () => undefined,
        importImage: async () => ({ reference: 'x' }),
        exportImage: async () => ({
          bytes: new Uint8Array([1]),
          mimeType: 'image/png',
        }),
      },
    },
  ))

test('print rejects an authored image it cannot embed with image-unavailable and its cause', async () => {
  const missing = new Error('missing bytes')
  await open(
    async ({ editor, errors }) => {
      editor.loadDocument({ ...input, text: '![Photo](photo.png)\n' })
      const printing = editor.printableSnapshot()
      await expect(printing).rejects.toEqual(code('image-unavailable'))
      await expect(printing).rejects.toMatchObject({ cause: missing })
      expect(errors).toEqual([])
    },
    {
      images: {
        presentation: () => undefined,
        importImage: async () => ({ reference: 'x' }),
        exportImage: async () => {
          throw missing
        },
      },
    },
  )
})

test('an unexpected exception arrives as internal, with the original as its cause', () =>
  open(async ({ editor, root, errors }) => {
    editor.loadDocument(input)
    const fault = new TypeError('fault')
    const internals = editor as unknown as Record<string, unknown>
    internals.outlineContext = () => {
      throw fault
    }
    expect(() => editor.headings()).toThrow(code('internal'))
    expect(() => editor.headings()).toThrow(
      expect.objectContaining({ cause: fault }),
    )
    documentOf(editor).exportDocument = () => {
      throw fault
    }
    await expect(editor.printableSnapshot()).rejects.toMatchObject({
      code: 'internal',
      cause: fault,
    })
    editor.setEditingMode('source')
    historyOf(editor).applySource = () => {
      throw fault
    }
    const textarea = root.querySelector('textarea')!
    textarea.value += 'typed'
    textarea.dispatchEvent(new Event('input'))
    expect(errors).toEqual([
      expect.objectContaining({ code: 'internal', cause: fault }),
    ])
  }))

test('a shortcut that fails reports through the error event, and keyDown throws the same failure', () =>
  open(({ editor, view, errors }) => {
    editor.loadDocument(input)
    editor.setKeymap({ bold: ['Mod-b'] })
    const fault = new TypeError('fault')
    ;(editor as unknown as Record<string, unknown>).format = () => {
      throw fault
    }
    const press = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    expect(() => view.dom.dispatchEvent(press)).not.toThrow()
    expect(press.defaultPrevented).toBe(true)
    expect(errors).toEqual([
      expect.objectContaining({ code: 'internal', cause: fault }),
    ])
    expect(() =>
      editor.keyDown({ key: 'b', code: 'KeyB', metaKey: true }, 1),
    ).toThrow(expect.objectContaining({ code: 'internal', cause: fault }))
    expect(errors).toHaveLength(1)
  }))

test('an exception from a host event handler goes to reportError and does not fail InkKit', async () => {
  const reported: unknown[] = []
  vi.stubGlobal('reportError', (error: unknown) => reported.push(error))
  const fault = new Error('host fault')
  const fail = () => {
    throw fault
  }
  try {
    await open(
      ({ editor }) => {
        editor.loadDocument(input)
        expect(editor.insertText('X', 1)).toBe(true)
        expect(editor.snapshot().revision).toBe(1)
        expect(() => editor.setEditable(false)).not.toThrow()
        expect(editor.editable).toBe(false)
      },
      {},
      { changed: fail, commandStateChanged: fail },
    )
    expect(reported.length).toBeGreaterThan(0)
    expect(reported.every((error) => error === fault)).toBe(true)
    reported.length = 0
    // A refused edit the person makes still reaches an error handler that throws, and the
    // handler's exception does not escape the edit.
    await open(
      (session) => {
        inComment(session)
        const { view } = session
        expect(() =>
          view.dispatch(view.state.tr.insertText('-->')),
        ).not.toThrow()
      },
      {},
      { error: fail },
    )
    expect(reported).toEqual([fault])
  } finally {
    vi.unstubAllGlobals()
  }
})
