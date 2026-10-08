import { expect, test } from 'vitest'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor, type ClipboardOutput } from '../src/index'

for (const operation of ['copy', 'cut']) {
  test(`${operation} of a footnote reference exports required definition images through the native callback`, async () => {
    const root = document.createElement('div')
    document.body.append(root)
    let exported: ClipboardOutput | undefined
    let acknowledge!: () => void
    const accepted = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    const errors: Error[] = []
    const editor = await InkKitEditor.mount(
      root,
      {
        changed() {},
        stateChanged() {},
        copy() {},
        openLink() {},
        error(error) {
          errors.push(error)
        },
        async clipboard(output) {
          exported = output
          await accepted
        },
      },
      {
        images: {
          presentation: () => ({ url: 'private://photo' }),
          importImage: async () => ({ reference: 'images/imported.png' }),
          exportImage: async () => ({
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
          }),
        },
      },
    )
    try {
      const source =
        'See[^Note]\n\n[^Note]: Before ![Photo](images/photo.png) after.\n'
      editor.loadDocument({
        documentId: 'native-reference-copy',
        generation: 1,
        format: 'md',
        text: source,
      })
      const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
      const view = ctx.get(editorViewCtx)
      let reference = -1
      view.state.doc.descendants((node, pos) => {
        if (reference < 0 && node.type.name === 'footnote_reference')
          reference = pos
      })
      view.dispatch(
        view.state.tr.setSelection(
          NodeSelection.create(view.state.doc, reference),
        ),
      )
      const immediate = new Map<string, string>()
      const event = new Event(operation, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: {
          setData(type: string, value: string) {
            immediate.set(type, value)
          },
        },
      })
      view.dom.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(immediate.size).toBe(0)
      expect(editor.snapshot().text).toBe(source)
      for (let attempts = 0; !exported && attempts < 20; attempts++)
        await Promise.resolve()
      expect(exported?.images).toHaveLength(1)
      expect(exported?.images[0]?.image?.bytes).toEqual(
        new Uint8Array([1, 2, 3]),
      )
      expect(exported?.html).toContain('data:image/png;base64,AQID')
      expect(exported?.html).not.toContain('private://')
      expect(exported?.html).not.toContain('images/photo.png')
      expect(exported?.markdown).toContain(
        '[^Note]: Before ![Photo](images/photo.png) after.',
      )
      expect(editor.snapshot().text).toBe(source)
      acknowledge()
      if (operation === 'cut') {
        for (
          let attempts = 0;
          editor.snapshot().text.includes('See[^Note]') && attempts < 20;
          attempts++
        )
          await Promise.resolve()
        expect(editor.snapshot().text).not.toContain('See[^Note]')
        expect(editor.snapshot().text).toContain(
          '[^Note]: Before ![Photo](images/photo.png) after.',
        )
      }
      expect(errors).toEqual([])
    } finally {
      acknowledge()
      await editor.destroy()
      root.remove()
    }
  })
}
