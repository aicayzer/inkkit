import { expect, test } from 'vitest'
import { InkKitEditor, InkKitError, type ImageAdapter } from '../src/core'

const image = {
  bytes: new Uint8Array([1]),
  mimeType: 'image/png',
  filename: 'Photo',
}

async function run(
  importImage: ImageAdapter['importImage'],
  body: (editor: InkKitEditor, errors: InkKitError[]) => Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: InkKitError[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    },
    {
      images: {
        presentation: () => undefined,
        importImage,
        exportImage: async () => image,
      },
    },
  )
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: '',
    })
    await body(editor, errors)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const html =
  '<p>Before café</p><p><img src="captured" alt="Photo"></p><p>After 🐈</p>'

for (const route of ['html', 'files'] as const) {
  test(`${route} image-unavailable keeps a placeholder and the paste history`, () => {
    const failure = new InkKitError('image-unavailable', 'Store unavailable')
    return run(
      async () => {
        throw failure
      },
      async (editor, errors) => {
        const before = editor.snapshot()
        await editor.paste({
          text: '',
          images: [image],
          ...(route === 'html' ? { html } : {}),
        })
        const saved = editor.snapshot().text
        expect(saved).toContain('[Photo: image unavailable]')
        if (route === 'html') {
          expect(saved).toContain('Before café')
          expect(saved).toContain('After 🐈')
        }
        expect(errors).toEqual([failure])
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(before.text)
        expect(editor.redo()).toBe(true)
        expect(editor.snapshot().text).toBe(saved)
        editor.loadDocument({
          documentId: 'note',
          generation: 2,
          format: 'md',
          text: saved,
        })
        expect(editor.snapshot().text).toBe(saved)
      },
    )
  })
}

for (const code of ['stale-document', 'destroyed'] as const) {
  test(`HTML image ${code} cancels the complete paste`, () => {
    const failure = new InkKitError(code, 'Import cancelled')
    return run(
      async () => {
        throw failure
      },
      async (editor) => {
        const before = editor.snapshot()
        await expect(
          editor.paste({ text: '', html, images: [image] }),
        ).rejects.toMatchObject({ code })
        expect(editor.snapshot()).toEqual(before)
        expect(editor.commandState().commands.undo).toBe(false)
      },
    )
  })
}
