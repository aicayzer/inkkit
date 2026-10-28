import { expect, test, vi } from 'vitest'
import { InkKitEditor, type ImageAdapter } from '../src/core'

async function run(
  callback: (editor: InkKitEditor, root: HTMLElement) => Promise<void> | void,
  images?: ImageAdapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {} },
    { images },
  )
  try {
    await callback(editor, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = {
  documentId: 'shared-helpers',
  generation: 1,
  format: 'md' as const,
}
const adapter: ImageAdapter = {
  presentation: () => ({ url: 'private://image' }),
  importImage: async () => ({ reference: 'imported.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([0, 255]),
    mimeType: 'image/png',
  }),
}

for (const [before, after, expected] of [
  ['', '😀', '😀'],
  ['😀', '', ''],
  ['a\r\n😀\rb', 'a\n😁\nb', 'a\r\n😁\rb'],
  ['a\r\n😀\rb', 'a\n𠀀\nb', 'a\r\n𠀀\rb'],
  ['edge\r\nedge', 'edge\nedge', 'edge\r\nedge'],
  ['edge\r\nedge', 'edge', 'edge'],
  ['edge', 'edge\nedge', 'edge\nedge'],
  [
    '\uFEFF\uFEFFa\r\nb\uFEFFc',
    '\uFEFF\uFEFFa\nb!\uFEFFc',
    '\uFEFF\uFEFFa\r\nb!\uFEFFc',
  ],
]) {
  test(`source input saves and reopens exact code units: ${JSON.stringify(before)} to ${JSON.stringify(after)}`, () =>
    run((editor, root) => {
      editor.loadDocument({ ...input, format: 'txt', text: before! })
      const baseline = editor.snapshot()
      const plain = root.querySelector('textarea')!
      plain.value = after!
      plain.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
      )
      expect(editor.snapshot().text).toBe(expected)
      if (before === expected) expect(editor.snapshot()).toEqual(baseline)
      else {
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(before)
        expect(editor.redo()).toBe(true)
        expect(editor.snapshot().text).toBe(expected)
      }
      editor.loadDocument({
        ...input,
        generation: 2,
        format: 'txt',
        text: editor.snapshot().text,
      })
      expect(editor.snapshot().text).toBe(expected)
    }))
}

test('repeated leading and internal BOMs retain exact saved Markdown and visible marks', () =>
  run(async (editor, root) => {
    const text = '\uFEFF\uFEFFbefore after\uFEFFend\r\n'
    editor.loadDocument({ ...input, text })
    editor.setEditingMode('source')
    const plain = root.querySelector('textarea')!
    plain.setSelectionRange(0, plain.value.length)
    const copied = await editor.clipboardSnapshot('selection')
    expect(copied.markdown).toBe(text)
    expect(copied.text).toBe('\uFEFFbefore after\uFEFFend')
    editor.setEditingMode('formatted')
    expect(editor.snapshot().text).toBe(text)
    editor.loadDocument({
      ...input,
      generation: 2,
      text: editor.snapshot().text,
    })
    expect(editor.snapshot().text).toBe(text)
  }))

test('clipboard retains MIME spelling and all byte values in a large portable image', () => {
  const bytes = Uint8Array.from({ length: 262144 }, (_, index) => index % 256)
  const mimeType = 'IMAGE/PNG'
  return run(
    async (editor) => {
      const text = '![Asset](opaque.png)\n'
      editor.loadDocument({ ...input, text })
      const copied = await editor.clipboardSnapshot()
      expect(copied.images[0]?.image?.mimeType).toBe(mimeType)
      const html = new DOMParser().parseFromString(copied.html, 'text/html')
      const url = html.querySelector('img')!.getAttribute('src')!
      expect(url.startsWith(`data:${mimeType};base64,`)).toBe(true)
      expect(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).toEqual(
        Buffer.from(bytes),
      )
      expect(editor.snapshot().text).toBe(text)
    },
    { ...adapter, exportImage: async () => ({ bytes, mimeType }) },
  )
})

test('clipboard coerces adapter MIME for validation without replacing its value', () => {
  const mimeType = { toString: () => 'IMAGE/PNG' } as unknown as string
  return run(
    async (editor) => {
      editor.loadDocument({ ...input, text: '![Asset](opaque.png)\n' })
      const copied = await editor.clipboardSnapshot()
      expect(copied.images[0]?.error).toBeUndefined()
      expect(copied.images[0]?.image?.mimeType).toBe(mimeType)
      const html = new DOMParser().parseFromString(copied.html, 'text/html')
      expect(html.querySelector('img')?.getAttribute('src')).toBe(
        'data:IMAGE/PNG;base64,AP8=',
      )
    },
    {
      ...adapter,
      exportImage: async () => ({ bytes: new Uint8Array([0, 255]), mimeType }),
    },
  )
})

test.each([
  'image/svg+xml',
  'image/unknown',
  'image/png;charset=utf-8',
  'image/png ',
  'image/png\n',
  'image/png\r',
  'image/png\r\n',
  'image/png\u2028',
  'image/png\u2029',
])('clipboard refuses unsupported or decorated MIME %j', (mimeType) =>
  run(
    async (editor) => {
      editor.loadDocument({ ...input, text: '![Asset](opaque.png)\n' })
      const copied = await editor.clipboardSnapshot()
      expect(copied.images[0]?.error).toBe(
        'The image format cannot be exported.',
      )
      expect(copied.html).not.toContain('<img')
    },
    {
      ...adapter,
      exportImage: async () => ({ bytes: new Uint8Array([0, 255]), mimeType }),
    },
  ),
)

test.each([
  ['data:image/png;base64,AP8=', true],
  ['data:image/png;base64,A P\t8=\n', true],
  ['data:IMAGE/PNG;base64,AP8=', false],
  ['DATA:image/png;base64,AP8=', false],
  ['data:image/png;charset=utf-8;base64,AP8=', false],
  ['data:image/svg+xml;base64,AP8=', false],
  ['data:image/unknown;base64,AP8=', false],
  ['data:image/png\n;base64,AP8=', false],
  ['data:image/png;base64,%%%', false],
  ['data:image/png;base64,A', false],
] as const)(
  'HTML paste applies its own MIME and base64 rules: %j',
  (url, accepted) => {
    const imported = vi.fn(adapter.importImage)
    return run(
      async (editor) => {
        editor.loadDocument({ ...input, text: '' })
        await editor.paste({
          text: 'Asset',
          html: `<p><img src="${url}" alt="Asset"></p>`,
        })
        expect(imported).toHaveBeenCalledTimes(accepted ? 1 : 0)
        if (accepted) {
          expect(imported.mock.calls[0]?.[0]).toMatchObject({
            mimeType: 'image/png',
            bytes: new Uint8Array([0, 255]),
          })
          expect(editor.snapshot().text).toContain('imported.png')
        } else expect(editor.snapshot().text).not.toContain('imported.png')
        const saved = editor.snapshot().text
        editor.loadDocument({ ...input, generation: 2, text: saved })
        expect(editor.snapshot().text).toBe(saved)
      },
      { ...adapter, importImage: imported },
    )
  },
)

test('print lowercases the copied MIME while clipboard preserves its spelling', async () => {
  const bytes = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  const revoke = vi.fn()
  const OriginalURL = URL
  vi.stubGlobal(
    'URL',
    class extends OriginalURL {
      static createObjectURL = () => 'blob:portable-image-test'
      static revokeObjectURL = revoke
    },
  )
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1
      naturalHeight = 1
      onload?: () => void
      onerror?: () => void
      set src(value: string) {
        if (value) queueMicrotask(() => this.onload?.())
      }
    },
  )
  try {
    await run(
      async (editor) => {
        editor.loadDocument({ ...input, text: '![Asset](opaque.png)\n' })
        const copied = await editor.clipboardSnapshot()
        expect(copied.images[0]?.image?.mimeType).toBe('IMAGE/PNG')
        const printed = await editor.printableSnapshot()
        expect(printed.assets[0]?.mimeType).toBe('image/png')
        expect(printed.assets[0]?.bytes).toEqual(bytes)
        const html = new DOMParser().parseFromString(printed.html, 'text/html')
        expect(html.querySelector('img')?.getAttribute('src')).toBe(
          `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
        )
        expect(revoke).toHaveBeenCalledWith('blob:portable-image-test')
      },
      {
        ...adapter,
        exportImage: async () => ({ bytes, mimeType: 'IMAGE/PNG' }),
      },
    )
  } finally {
    vi.unstubAllGlobals()
  }
})
