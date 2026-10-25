import { expect, test, vi } from 'vitest'
import { InkKitEditor, type ImageImportContext } from '../src/index'

for (const route of ['files', 'html'] as const) {
  for (const cancellation of [
    'facade',
    'load',
    'read-only',
    'destroy',
  ] as const) {
    test(`${route} import aborts immediately on ${cancellation} and ignores a late result`, async () => {
      const root = document.createElement('div')
      document.body.append(root)
      const changed = vi.fn()
      const errors = vi.fn()
      const states = vi.fn()
      let context!: ImageImportContext
      let resolve!: (value: { reference: string }) => void
      const editor = await InkKitEditor.mount(
        root,
        {
          changed,
          error: errors,
          commandStateChanged: states,
        },
        {
          images: {
            presentation: () => undefined,
            exportImage: async () => ({
              bytes: new Uint8Array([1]),
              mimeType: 'image/png',
            }),
            importImage: (_, captured) => {
              context = captured
              return new Promise((done) => {
                resolve = done
              })
            },
          },
        },
      )
      try {
        const input = {
          documentId: 'note',
          generation: 1,
          format: 'md' as const,
          text: '# Café\r\n\r\nUntouched\r\n',
        }
        editor.loadDocument(input)
        const before = editor.snapshot()
        const history = editor.commandState().commands.undo
        changed.mockClear()
        const pending = editor.paste({
          text: 'captured text',
          ...(route === 'html'
            ? { html: '<p>captured text<img src="captured" alt="photo"></p>' }
            : {}),
          images: [
            {
              bytes: new Uint8Array([1]),
              mimeType: 'image/png',
              source: 'captured',
            },
          ],
        })
        const rejection = expect(pending).rejects.toMatchObject({
          code: cancellation === 'destroy' ? 'destroyed' : 'stale-document',
        })
        expect(editor.commandState().pending).toBe(true)
        expect(context.signal.aborted).toBe(false)
        expect(() => editor.snapshot()).toThrow(
          expect.objectContaining({ code: 'operation-pending' }),
        )
        if (cancellation === 'facade') editor.cancelPendingImports(1)
        if (cancellation === 'load')
          editor.loadDocument({
            ...input,
            generation: 2,
            text: 'Replacement\n',
          })
        if (cancellation === 'read-only') editor.setEditable(false)
        if (cancellation === 'destroy') await editor.destroy()
        expect(context.signal.aborted).toBe(true)
        // The host can finish saving even if its adapter never answers.
        await rejection
        if (cancellation !== 'destroy') {
          expect(editor.commandState().pending).toBe(false)
          expect(editor.snapshot()).toEqual(
            cancellation === 'load'
              ? expect.objectContaining({
                  generation: 2,
                  text: 'Replacement\n',
                })
              : before,
          )
          expect(editor.commandState().commands.undo).toBe(history)
          if (cancellation === 'facade') expect(editor.editable).toBe(true)
        }
        resolve({ reference: 'late.png' })
        await Promise.resolve()
        await Promise.resolve()
        expect(changed).not.toHaveBeenCalled()
        expect(errors).not.toHaveBeenCalled()
        if (cancellation !== 'destroy') {
          const saved = editor.snapshot()
          editor.loadDocument({ ...saved, generation: 3 })
          expect(editor.snapshot().text).toBe(saved.text)
        }
      } finally {
        await editor.destroy()
        root.remove()
      }
    })
  }
}

test('cancellation guards the generation and does not cancel a newer import', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const requests: {
    context: ImageImportContext
    resolve: (value: { reference: string }) => void
  }[] = []
  const editor = await InkKitEditor.mount(
    root,
    { changed() {} },
    {
      images: {
        presentation: () => undefined,
        exportImage: async () => ({
          bytes: new Uint8Array([1]),
          mimeType: 'image/png',
        }),
        importImage: (_, context) =>
          new Promise((resolve) => requests.push({ context, resolve })),
      },
    },
  )
  try {
    expect(() => editor.cancelPendingImports()).toThrow(
      expect.objectContaining({ code: 'not-ready' }),
    )
    editor.loadDocument({
      documentId: 'note',
      generation: 2,
      format: 'md',
      text: '',
    })
    const input = {
      text: '',
      images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
    }
    const first = editor.paste(input)
    const rejected = expect(first).rejects.toMatchObject({
      code: 'stale-document',
    })
    expect(() => editor.cancelPendingImports(1)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    expect(requests[0]!.context.signal.aborted).toBe(false)
    editor.cancelPendingImports(2)
    const second = editor.paste(input)
    requests[0]!.resolve({ reference: 'old.png' })
    await rejected
    expect(editor.commandState().pending).toBe(true)
    expect(requests[1]!.context.signal.aborted).toBe(false)
    requests[1]!.resolve({ reference: 'new.png' })
    await second
    expect(editor.snapshot().text).toContain('new.png')
    expect(editor.snapshot().text).not.toContain('old.png')
    editor.cancelPendingImports(2)
  } finally {
    await editor.destroy()
    expect(() => editor.cancelPendingImports()).toThrow(
      expect.objectContaining({ code: 'destroyed' }),
    )
    root.remove()
  }
})

test('a synchronously throwing adapter can cancel reentrantly without an unhandled rejection', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {} },
    {
      images: {
        presentation: () => undefined,
        exportImage: async () => ({
          bytes: new Uint8Array([1]),
          mimeType: 'image/png',
        }),
        importImage: () => {
          editor.cancelPendingImports(1)
          throw new Error('Store refused the bytes')
        },
      },
    },
  )
  try {
    editor.loadDocument({
      documentId: 'sync',
      generation: 1,
      format: 'md',
      text: 'Untouched\r\n',
    })
    const before = editor.snapshot()
    await expect(
      editor.paste({
        text: '',
        images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
      }),
    ).rejects.toMatchObject({ code: 'stale-document' })
    expect(editor.snapshot()).toEqual(before)
    expect(editor.commandState().pending).toBe(false)
  } finally {
    await editor.destroy()
    root.remove()
  }
})
