import { ctxOf, optionsOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  TextSelection,
  AllSelection,
  NodeSelection,
} from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import {
  InkKitEditor,
  InkKitError,
  type ImageAdapter,
  type EditorEvents,
  type ClipboardOutput,
} from '../src/index'

async function run(
  callback: (
    editor: InkKitEditor,
    root: HTMLElement,
    ctx: Ctx,
  ) => void | Promise<void>,
  images?: ImageAdapter,
  events: Partial<EditorEvents> = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {}, ...events },
    { images },
  )
  const ctx = ctxOf(editor)
  try {
    await callback(editor, root, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const input = {
  documentId: 'memo',
  generation: 1,
  format: 'md' as const,
  text: '__bold__\n\nEDIT\n',
}

test('snapshot is complete, byte exact, scoped and explicit about failures', () =>
  run((editor, _root, ctx) => {
    expect(() => editor.snapshot()).toThrow(InkKitError)
    editor.loadDocument(input)
    expect(editor.snapshot()).toEqual({ ...input, revision: 0, dirty: false })
    expect(() => editor.snapshot(0)).toThrow('Document changed')
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.content.size - 1),
    )
    expect(editor.snapshot()).toMatchObject({
      text: '__bold__\n\nEDIT!\n',
      dirty: true,
      revision: 1,
    })
    undo(view.state, view.dispatch)
    expect(editor.snapshot()).toMatchObject({ text: input.text, dirty: false })
  }))

test('TXT mode keeps Markdown punctuation, entities, BOM and CRLF literal', () =>
  run((editor, root) => {
    const text = '\uFEFF**plain** &#x20;\r\nlast '
    editor.loadDocument({ ...input, format: 'txt', text })
    expect(editor.snapshot().text).toBe(text)
    const textarea = root.querySelector('textarea')!
    expect(root.hidden).toBe(false)
    expect(textarea.closest('[hidden]')).toBeNull()
    textarea.setSelectionRange(text.length, text.length)
    editor.pasteAsPlainText('!')
    expect(editor.snapshot().text).toBe(text + '!')
    expect(editor.table('insert')).toBe(false)
  }))

test('plain-text paste keeps punctuation literal in Markdown', () =>
  run((editor) => {
    editor.loadDocument({ ...input, text: '' })
    editor.pasteAsPlainText('**not bold** &#x20; £ café 😀')
    expect(editor.snapshot().text).toContain('\\*\\*not bold\\*\\*')
  }))

test('ordinary and Markdown copy have distinct content, including whitespace', () =>
  run(async (editor) => {
    editor.loadDocument({ ...input, text: 'tight. and **bold**' })
    editor.insertText(' ', 1)
    const clip = await editor.clipboardSnapshot()
    expect(clip.text).toBe('tight. and bold ')
    const dom = document.createElement('div')
    dom.innerHTML = clip.html
    expect(dom.querySelector('strong')!.textContent!.trim()).toBe('bold')
    expect(clip.markdown).toBe(editor.snapshot().text)
    expect(editor.snapshot().dirty).toBe(true)
  }))

test('table commands create, add, align and delete editable cells', () =>
  run((editor, _root, ctx) => {
    editor.loadDocument({ ...input, text: '' })
    expect(editor.table('insert', { rows: 3, columns: 2 })).toBe(true)
    const view = ctx.get(editorViewCtx)
    let cell = -1
    view.state.doc.descendants((node, pos) => {
      if (cell < 0 && node.type.name === 'table_cell') cell = pos + 2
    })
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, cell)),
    )
    expect(editor.table('addRowAfter')).toBe(true)
    expect(editor.table('addColumnAfter')).toBe(true)
    expect(editor.table('alignCenter')).toBe(true)
    expect(editor.snapshot().text).toContain(':')
    expect(editor.table('deleteRow')).toBe(true)
    expect(editor.table('deleteColumn')).toBe(true)
    expect(editor.table('deleteTable')).toBe(true)
  }))

test('pending image import blocks snapshot and stale completion cannot change a new memo', () =>
  run(
    async (editor, _root, ctx) => {
      editor.loadDocument({ ...input, text: 'original' })
      let finish!: (value: { reference: string }) => void
      const adapter = optionsOf(editor).images!
      adapter.importImage = () =>
        new Promise((resolve) => {
          finish = resolve
        })
      const paste = editor.paste({
        text: 'before',
        images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
      })
      expect(() => editor.snapshot()).toThrow('image import')
      editor.loadDocument({
        ...input,
        documentId: 'other',
        generation: 2,
        text: 'new memo',
      })
      finish({ reference: 'images/photo.png' })
      await expect(paste).rejects.toThrow('document changed')
      expect(editor.snapshot().text).toBe('new memo')
      expect(ctx.get(editorViewCtx).state.doc.textContent).toBe('new memo')
    },
    {
      presentation() {
        return undefined
      },
      async importImage() {
        return { reference: 'unused' }
      },
      async exportImage() {
        return { bytes: new Uint8Array([1]), mimeType: 'image/png' }
      },
    },
  ))

test('destroyed editor fails explicitly', () =>
  run(async (editor) => {
    editor.loadDocument(input)
    await editor.destroy()
    expect(() => editor.snapshot()).toThrow('destroyed')
  }))

test('multiline literal paste retains source characters and omits its pending final break on reopen', () =>
  run(async (editor) => {
    editor.loadDocument({ ...input, text: '' })
    const text = 'first\nsecond\n\n**literal** &#x20;\n'
    editor.pasteAsPlainText(text)
    expect((await editor.clipboardSnapshot()).text).toBe(text)
    const saved = editor.snapshot().text
    editor.undo(1)
    expect(editor.snapshot().text).toBe('')
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(editor.snapshot().text).toBe(saved)
    expect((await editor.clipboardSnapshot()).text).toBe(text.slice(0, -1))
  }))

test('TXT find wraps literal matches and respects composition', () =>
  run((editor, root, ctx) => {
    editor.loadDocument({
      ...input,
      format: 'txt',
      text: '**needle**\r\nneedle',
    })
    const textarea = root.querySelector('textarea')!
    textarea.setSelectionRange(0, 0)
    const hidden = ctx.get(editorViewCtx).state.doc
    editor.find('needle')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 8])
    editor.find('needle')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([11, 17])
    editor.find('needle')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 8])
    editor.find('')
    expect(textarea.selectionStart).toBe(textarea.selectionEnd)
    expect(ctx.get(editorViewCtx).state.doc).toBe(hidden)
    textarea.dispatchEvent(new Event('compositionstart'))
    expect(() => editor.snapshot()).toThrow('composition')
    expect(editor.insertText('x', 1)).toBe(false)
    textarea.dispatchEvent(new Event('compositionend'))
    expect(editor.snapshot().dirty).toBe(false)
  }))

const imageAdapter: ImageAdapter = {
  presentation() {
    return undefined
  },
  async importImage() {
    return { reference: 'images/photo.png' }
  },
  async exportImage() {
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }
  },
}

test('loading the same document again cancels a pending import and releases snapshots', () =>
  run(
    async (editor) => {
      editor.loadDocument({ ...input, text: 'old' })
      let finish!: (value: { reference: string }) => void
      const adapter = optionsOf(editor).images!
      adapter.importImage = () =>
        new Promise((resolve) => {
          finish = resolve
        })
      const paste = editor.paste({
        text: 'paste',
        images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
      })
      editor.loadDocument({ ...input, generation: 2, text: 'new' })
      expect(editor.snapshot().text).toBe('new')
      finish({ reference: 'images/old.png' })
      await expect(paste).rejects.toThrow('document changed')
      expect(editor.snapshot().text).toBe('new')
    },
    { ...imageAdapter },
  ))

test('loading the same document again rejects a pending clipboard export', () =>
  run(
    async (editor) => {
      editor.loadDocument({ ...input, text: '![Photo](images/photo.png)' })
      let finish!: (value: { bytes: Uint8Array; mimeType: string }) => void
      const adapter = optionsOf(editor).images!
      adapter.exportImage = () =>
        new Promise((resolve) => {
          finish = resolve
        })
      const copy = editor.clipboardSnapshot()
      editor.loadDocument({ ...input, generation: 2, text: 'replacement' })
      finish({ bytes: new Uint8Array([1]), mimeType: 'image/png' })
      await expect(copy).rejects.toThrow('Document changed')
    },
    { ...imageAdapter },
  ))

test('partial image copy has valid Markdown and portable image HTML', () =>
  run(
    async (editor, _root, ctx) => {
      editor.loadDocument({
        ...input,
        text: 'Before ![Photo](images/photo.png) after',
      })
      const view = ctx.get(editorViewCtx)
      let image = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image') image = pos
      })
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, image)),
      )
      const copy = await editor.clipboardSnapshot('selection')
      expect(copy.markdown).toBe('![Photo](images/photo.png)\n')
      expect(copy.html).toContain('data:image/png;base64,')
      expect(copy.html).not.toContain('memo-image:')
      expect(copy.html).not.toContain('images/photo.png')
    },
    { ...imageAdapter },
  ))

test('image cut waits for clipboard and intercepts private HTML', async () => {
  let exported: ClipboardOutput | undefined
  let accept!: () => void
  const accepted = new Promise<void>((resolve) => {
    accept = resolve
  })
  await run(
    async (editor, _root, ctx) => {
      editor.loadDocument({
        ...input,
        text: 'Before ![Photo](images/photo.png) after',
      })
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(new AllSelection(view.state.doc)),
      )
      const types = new Map<string, string>()
      const cut = new Event('cut', { bubbles: true, cancelable: true })
      Object.defineProperty(cut, 'clipboardData', {
        value: {
          setData(type: string, value: string) {
            types.set(type, value)
          },
        },
      })
      view.dom.dispatchEvent(cut)
      expect(cut.defaultPrevented).toBe(true)
      expect(types.size).toBe(0)
      expect(editor.snapshot().text).toContain('images/photo.png')
      for (let attempts = 0; !exported && attempts < 20; attempts++)
        await Promise.resolve()
      expect(exported?.html).toContain('data:image/png;base64,')
      expect(editor.snapshot().text).toContain('images/photo.png')
      accept()
      for (
        let attempts = 0;
        editor.snapshot().text && attempts < 20;
        attempts++
      )
        await Promise.resolve()
      expect(editor.snapshot().text).toBe('')
    },
    { ...imageAdapter },
    {
      async clipboard(content) {
        exported = content
        await accepted
      },
    },
  )
})

test('destroyed methods fail before reading detached editor state', () =>
  run(async (editor) => {
    editor.loadDocument(input)
    await editor.destroy()
    for (const operation of [
      () => editor.reloadDocument(input),
      () => editor.find('x'),
      () => editor.focus(),
      () => editor.insertText('x', 1),
      () => editor.keyDown({ key: 'Enter' }, 1),
      () => editor.insertPaths(['path'], { clientX: 0, clientY: 0 }),
    ])
      expect(operation).toThrow('destroyed')
  }))

test('image cut retains source on missing bytes; an ordinary copy describes the image without an error', async () => {
  const errors: InkKitError[] = []
  let writes = 0
  await run(
    async (editor, _root, ctx) => {
      const source = 'Before ![Photo](images/photo.png) after'
      editor.loadDocument({ ...input, text: source })
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(new AllSelection(view.state.doc)),
      )
      const copy = await editor.clipboardSnapshot('selection')
      expect(copy.text).toContain('image unavailable')
      expect(copy.images[0]?.error).toBe('Image offline')
      // Degraded output describes itself; it is not also an error.
      expect(errors).toEqual([])
      view.dom.dispatchEvent(
        new Event('cut', { bubbles: true, cancelable: true }),
      )
      for (let attempts = 0; attempts < 20; attempts++) await Promise.resolve()
      expect(writes).toBe(0)
      expect(errors.map((error) => error.code)).toEqual(['image-unavailable'])
      expect(editor.snapshot().text).toBe(source)
    },
    {
      ...imageAdapter,
      async exportImage() {
        throw new Error('Image offline')
      },
    },
    {
      error(error) {
        errors.push(error)
      },
      clipboard() {
        writes++
      },
    },
  )
})

test('image cut retains source if host clipboard writing fails', async () => {
  const errors: InkKitError[] = []
  const refusal = new Error('Clipboard write refused')
  await run(
    async (editor, _root, ctx) => {
      const source = '![Photo](images/photo.png)'
      editor.loadDocument({ ...input, text: source })
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(new AllSelection(view.state.doc)),
      )
      view.dom.dispatchEvent(
        new Event('cut', { bubbles: true, cancelable: true }),
      )
      for (let attempts = 0; attempts < 20; attempts++) await Promise.resolve()
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        code: 'clipboard-unavailable',
        cause: refusal,
      })
      expect(editor.snapshot().text).toBe(source)
    },
    { ...imageAdapter },
    {
      error(error) {
        errors.push(error)
      },
      async clipboard() {
        throw refusal
      },
    },
  )
})

test('a preservation failure rejects the edit without changing snapshot, revision or undo history', () => {
  const errors: Error[] = []
  const changes: string[] = []
  return run(
    (editor, _root, ctx) => {
      const source = '- One\n\nBetween\n\n- Two\n'
      editor.loadDocument({ ...input, text: source })
      const before = editor.snapshot()
      const view = ctx.get(editorViewCtx)
      const from = view.state.doc.firstChild!.nodeSize
      view.dispatch(
        view.state.tr.delete(from, from + view.state.doc.child(1).nodeSize),
      )
      expect(errors).toHaveLength(1)
      expect(errors[0]?.message).toContain('The edit was not applied')
      expect(editor.snapshot()).toEqual(before)
      expect(changes).toEqual([])
      expect(editor.undo()).toBe(false)
      view.dispatch(view.state.tr.insertText('!', from + 1))
      expect(editor.snapshot().text).toBe(source.replace('Between', '!Between'))
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(source)
    },
    undefined,
    {
      error: (error) => errors.push(error),
      changed: ({ text }) => changes.push(text),
    },
  )
})

test('rejected edits leave a pending image paste at its accepted selection', async () => {
  let finish!: (value: { reference: string }) => void
  const errors: Error[] = []
  await run(
    async (editor, _root, ctx) => {
      const source = '- One\n\nBetween\n\n- Two\n'
      editor.loadDocument({ ...input, text: source })
      const view = ctx.get(editorViewCtx)
      let selected = 0
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Two') selected = pos
      })
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, selected, selected + 3),
        ),
      )
      const paste = editor.paste({
        text: '',
        images: [
          {
            bytes: new Uint8Array([1]),
            mimeType: 'image/png',
            filename: 'pasted',
          },
        ],
      })
      const from = view.state.doc.firstChild!.nodeSize
      view.dispatch(
        view.state.tr.delete(from, from + view.state.doc.child(1).nodeSize),
      )
      expect(errors).toHaveLength(1)
      expect(view.state.doc.textContent).toBe('OneBetweenTwo')
      view.dispatch(view.state.tr.insertText('!', from + 1))
      finish({ reference: 'opaque:image' })
      await paste
      expect(editor.snapshot().text).toBe(
        '- One\n\n!Between\n\n- ![pasted](opaque:image)\n',
      )
    },
    {
      ...imageAdapter,
      importImage: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    },
    { error: (error) => errors.push(error) },
  )
})
