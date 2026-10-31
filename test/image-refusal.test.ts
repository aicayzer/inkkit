import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { ctxOf } from './editor-access'
import {
  InkKitEditor,
  InkKitError,
  type EditorOptions,
  type ImageAdapter,
} from '../src/core'

const bytes = new Uint8Array([1, 2, 3])
const adapter: ImageAdapter = {
  presentation: () => undefined,
  importImage: async () => ({ reference: 'stored.png' }),
  exportImage: async () => ({ bytes, mimeType: 'image/png' }),
}
const html =
  '<p>Caption</p><p><img src="https://example.test/a.png" alt="A"></p>'

async function run(
  options: EditorOptions,
  body: (
    editor: InkKitEditor,
    errors: InkKitError[],
    root: HTMLElement,
  ) => Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: InkKitError[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, error: (error) => errors.push(error) },
    options,
  )
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: 'Start\n',
    })
    await body(editor, errors, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const file = () => new File([bytes], 'Photo.png', { type: 'image/png' })
function pasteEvent(data: Record<string, string>, files: File[] = []) {
  return {
    clipboardData: {
      getData: (type: string) => data[type] ?? '',
      files,
    },
  } as unknown as ClipboardEvent
}
function domPaste(editor: InkKitEditor, event: ClipboardEvent): unknown {
  const view = ctxOf(editor).get(editorViewCtx)
  return view.someProp('handlePaste', (handler) =>
    handler(view, event, view.state.selection.content()),
  )
}
function domDrop(editor: InkKitEditor, files: File[], html = ''): unknown {
  const view = ctxOf(editor).get(editorViewCtx)
  const event = {
    dataTransfer: {
      getData: (type: string) => (type === 'text/html' ? html : ''),
      files,
    },
    clientX: 0,
    clientY: 0,
    preventDefault() {},
  } as unknown as DragEvent
  return view.someProp('handleDOMEvents', (handlers) =>
    handlers.drop?.(view, event),
  )
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('without an image adapter a pasted image is refused whole, with a typed error and no placeholder', () =>
  run({}, async (editor, errors) => {
    const before = editor.snapshot()
    await expect(
      editor.paste({ text: 'Caption', html, images: [] }),
    ).rejects.toMatchObject({ code: 'image-unsupported' })
    await expect(
      editor.paste({
        text: '',
        images: [{ bytes, mimeType: 'image/png', filename: 'Photo' }],
      }),
    ).rejects.toMatchObject({ code: 'image-unsupported' })
    expect(editor.snapshot()).toEqual(before)
    expect(editor.snapshot().text).not.toContain('unavailable')
    // A host call is waiting for these, so they are not also reported.
    expect(errors).toEqual([])
    // Plain text with no image still pastes.
    await editor.paste({ text: 'Plain' })
    expect(editor.snapshot().text).toContain('Plain')
  }))

test('a DOM paste or drop of an image without an adapter reports image-unsupported and inserts nothing', () =>
  run({}, async (editor, errors) => {
    const before = editor.snapshot()
    const attempts = [
      () =>
        domPaste(editor, pasteEvent({ 'text/plain': '', 'text/html': html })),
      () => domPaste(editor, pasteEvent({ 'text/plain': '' }, [file()])),
      () => domDrop(editor, [file()]),
      () => domDrop(editor, [], html),
    ]
    for (const attempt of attempts) {
      errors.length = 0
      expect(attempt()).toBe(true)
      await settle()
      expect(errors.map((error) => error.code)).toEqual(['image-unsupported'])
      expect(editor.snapshot()).toEqual(before)
    }
    // A text paste is untouched.
    errors.length = 0
    domPaste(editor, pasteEvent({ 'text/plain': 'Words' }))
    await settle()
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toContain('Words')
  }))

test('content that only carries an image keeps working: a table kept as source and a diagram copy', () =>
  run({}, async (editor, errors) => {
    await editor.paste({
      text: 'table',
      html: '<table><caption>c</caption><tr><th>h</th></tr><tr><td><img src="image:opaque" alt="IMG"></td></tr></table>',
    })
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toContain('<table>')
  }))

test('a read-only editor ignores an image paste instead of reporting it', () =>
  run({}, async (editor, errors) => {
    editor.setEditable(false)
    domPaste(editor, pasteEvent({ 'text/html': html }))
    await settle()
    expect(errors).toEqual([])
  }))

test('with an image adapter an image paste is imported and a failed import keeps its placeholder', async () => {
  await run({ images: adapter }, async (editor, errors) => {
    await editor.paste({
      text: '',
      images: [{ bytes, mimeType: 'image/png', filename: 'Photo' }],
    })
    expect(editor.snapshot().text).toContain('![Photo](stored.png)')
    expect(errors).toEqual([])
    expect(domPaste(editor, pasteEvent({ 'text/plain': '' }, [file()]))).toBe(
      true,
    )
    await settle()
    expect(errors).toEqual([])
  })
  await run(
    {
      images: {
        ...adapter,
        importImage: async () => {
          throw new Error('disk full')
        },
      },
    },
    async (editor, errors) => {
      await editor.paste({
        text: '',
        images: [{ bytes, mimeType: 'image/png', filename: 'Photo' }],
      })
      expect(editor.snapshot().text).toContain('Photo: image unavailable')
      expect(errors.map((error) => error.code)).toEqual(['image-unavailable'])
    },
  )
})

test('a file adapter alone leaves dropped image files to the host but refuses a pasted image', () =>
  run(
    {
      files: {
        resolve: async () => ({ kind: 'missing' }),
        open: () => {},
      } as never,
    },
    async (editor, errors) => {
      expect(domDrop(editor, [file()])).not.toBe(true)
      await settle()
      expect(errors).toEqual([])
      domPaste(editor, pasteEvent({ 'text/html': html }))
      await settle()
      expect(errors.map((error) => error.code)).toEqual(['image-unsupported'])
    },
  ))

function sourcePaste(editor: InkKitEditor, files: File[], text = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.assign(event, {
    clipboardData: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      files,
    },
  })
  sourceArea(editor).dispatchEvent(event)
  return event
}
function sourceDrop(editor: InkKitEditor, files: File[], text = '') {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.assign(event, {
    dataTransfer: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      files,
    },
  })
  sourceArea(editor).dispatchEvent(event)
  return event
}
const sourceArea = (_editor: InkKitEditor) =>
  document.querySelector<HTMLTextAreaElement>('textarea.inkkit-plain')!

for (const format of ['md', 'txt'] as const)
  test(`${format} source: an image-only paste or drop without an adapter reports image-unsupported`, () =>
    run({}, async (editor, errors) => {
      editor.loadDocument({
        documentId: format,
        generation: 2,
        format,
        text: 'Start\n',
      })
      if (format === 'md') editor.setEditingMode('source')
      const before = editor.snapshot()
      expect(sourcePaste(editor, [file()]).defaultPrevented).toBe(true)
      expect(sourceDrop(editor, [file()]).defaultPrevented).toBe(true)
      await settle()
      expect(errors.map((error) => error.code)).toEqual([
        'image-unsupported',
        'image-unsupported',
      ])
      expect(editor.snapshot()).toEqual(before)
      await expect(
        editor.paste({ text: '', images: [{ bytes, mimeType: 'image/png' }] }),
      ).rejects.toMatchObject({ code: 'image-unsupported' })
      // Text that comes with the image is inserted, with no error.
      errors.length = 0
      sourcePaste(editor, [file()], 'Words')
      await settle()
      expect(errors).toEqual([])
      expect(editor.snapshot().text).toContain('Words')
    }))

test('md source: with an image adapter an image-only paste is unchanged', () =>
  run({ images: adapter }, async (editor, errors) => {
    editor.setEditingMode('source')
    sourcePaste(editor, [file()])
    await settle()
    expect(errors).toEqual([])
  }))
