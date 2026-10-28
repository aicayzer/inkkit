import { withInputTimers } from './timing'
import { expect, test, vi } from 'vitest'
import { InkKitEditor, type EditorOptions } from '../src/core'

const images: EditorOptions['images'] = {
  presentation: () => ({ url: 'blob:picture' }),
  importImage: async () => ({ reference: 'picture.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
  }),
}

async function run(
  text: string,
  body: (editor: InkKitEditor, root: HTMLElement) => void | Promise<void>,
  options: EditorOptions = { images },
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {} },
    options,
  )
  try {
    editor.loadDocument({
      documentId: 'media',
      generation: 1,
      format: 'md',
      text,
    })
    Object.defineProperty(root.querySelector('.ProseMirror'), 'clientWidth', {
      value: 600,
      configurable: true,
    })
    await body(editor, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function key(root: HTMLElement, name: string, shiftKey = false) {
  const handle = root.querySelector<HTMLElement>('[role="slider"]')!
  handle.focus()
  const event = new KeyboardEvent('keydown', {
    key: name,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  handle.dispatchEvent(event)
  return event.defaultPrevented
}

for (const newline of ['\n', '\r\n']) {
  for (const embed of [
    '![Café 😀|120](photo.png "Title")',
    '![[Café 😀|120]]',
  ]) {
    test(`keyboard resizing preserves ${JSON.stringify(embed)} with ${JSON.stringify(newline)}, history and reopening`, async () => {
      const source = ['Before  ', '', `${embed}   `, '', 'After', ''].join(
        newline,
      )
      await run(
        source,
        async (editor, root) => {
          await vi.waitFor(() =>
            expect(root.querySelector('[role="slider"]')).not.toBeNull(),
          )
          expect(key(root, 'ArrowRight')).toBe(true)
          await vi.waitFor(() =>
            expect(root.querySelector('[role="slider"]')).not.toBeNull(),
          )
          const resized = source.replace('|120', '|130')
          expect(editor.snapshot().text).toBe(resized)
          expect(document.activeElement).toBe(
            root.querySelector('[role="slider"]'),
          )
          expect(
            root
              .querySelector('[role="slider"]')
              ?.getAttribute('aria-valuenow'),
          ).toBe('130')
          expect(key(root, 'ArrowLeft', true)).toBe(true)
          await vi.waitFor(() =>
            expect(root.querySelector('[role="slider"]')).not.toBeNull(),
          )
          expect(editor.snapshot().text).toBe(source.replace('|120', '|129'))
          editor.undo()
          expect(editor.snapshot().text).toBe(resized)
          editor.undo()
          expect(editor.snapshot().text).toBe(source)
          editor.redo()
          expect(editor.snapshot().text).toBe(resized)
          editor.loadDocument({
            documentId: 'reopened',
            generation: 2,
            format: 'md',
            text: resized,
          })
          expect(editor.snapshot().text).toBe(resized)
        },
        {
          files: {
            resolve: async () => ({ kind: 'image', url: 'blob:picture' }),
          },
        },
      )
    })
  }
}

test('image-adapter keyboard resizing clamps width and ignores stale, read-only and composition input', async () => {
  const source = '![Picture|120](photo.png)\n'
  await run(source, async (editor, root) => {
    expect(key(root, 'Home')).toBe(true)
    expect(editor.snapshot().text).toBe(source.replace('|120', '|48'))
    const boundedRevision = editor.snapshot().revision
    expect(key(root, 'ArrowLeft')).toBe(true)
    expect(editor.snapshot().revision).toBe(boundedRevision)
    expect(key(root, 'End')).toBe(true)
    expect(editor.snapshot().text).toBe(source.replace('|120', '|600'))
    editor.undo()
    expect(editor.snapshot().text).toBe(source.replace('|120', '|48'))
    editor.undo()
    expect(editor.snapshot().text).toBe(source)
    editor.setEditable(false)
    expect(key(root, 'ArrowRight')).toBe(false)
    expect(editor.snapshot().text).toBe(source)
    editor.setEditable(true)
    const surface = root.querySelector('.ProseMirror')!
    await withInputTimers(() => {
      surface.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true, data: '中' }),
      )
      expect(key(root, 'ArrowRight')).toBe(false)
      surface.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, data: '' }),
      )
    })
    expect(editor.snapshot().text).toBe(source)
    const stale = root.querySelector('[role="slider"]')!
    editor.loadDocument({
      documentId: 'other',
      generation: 2,
      format: 'md',
      text: 'Replacement\n',
    })
    stale.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(editor.snapshot().text).toBe('Replacement\n')
  })
})

test('PDF previews keep their sandbox but leave Open as the keyboard path', async () => {
  const open = vi.fn()
  await run(
    '![[Document.pdf]]\n',
    async (editor, root) => {
      await vi.waitFor(() =>
        expect(root.querySelector('iframe')).not.toBeNull(),
      )
      const frame = root.querySelector('iframe')!
      expect(frame.tabIndex).toBe(-1)
      expect(frame.getAttribute('sandbox')).toBe('')
      const button = root.querySelector<HTMLButtonElement>('.inkkit-file-open')!
      editor.setEditable(false)
      button.focus()
      button.click()
      expect(open).toHaveBeenCalledOnce()
      expect(editor.snapshot().text).toBe('![[Document.pdf]]\n')
    },
    {
      files: {
        resolve: async () => ({
          kind: 'pdf',
          url: 'blob:document',
          label: 'Document.pdf',
        }),
        open,
      },
    },
  )
})

test('an asynchronous resized image does not take focus back from another control', async () => {
  let requests = 0
  let release!: (value: { kind: 'image'; url: string }) => void
  await run(
    '![Picture|120](photo.png)\n',
    async (editor, root) => {
      await vi.waitFor(() =>
        expect(root.querySelector('[role="slider"]')).not.toBeNull(),
      )
      expect(
        root.querySelector('[role="slider"]')?.getAttribute('aria-label'),
      ).toBe('Adjust width Picture')
      key(root, 'ArrowRight')
      expect(editor.snapshot().text).toBe('![Picture|130](photo.png)\n')
      const other = document.createElement('button')
      root.append(other)
      other.focus()
      release({ kind: 'image', url: 'blob:picture' })
      await vi.waitFor(() =>
        expect(root.querySelector('[role="slider"]')).not.toBeNull(),
      )
      expect(document.activeElement).toBe(other)
    },
    {
      labels: { imageResize: 'Adjust width' },
      files: {
        resolve: () =>
          ++requests === 1
            ? Promise.resolve({ kind: 'image', url: 'blob:picture' })
            : new Promise((resolve) => {
                release = resolve
              }),
      },
    },
  )
})
