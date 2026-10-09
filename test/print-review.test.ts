import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { closeHistory, undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  InkKitEditor,
  type ImageAdapter,
  type PortableImage,
  type FileAdapter,
} from '../src/index'
import { setCommentVisibility } from '../src/comments'

const renderer = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: renderer }))
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII='
const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0))
const alternatePNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8AAQv8BD/kD/YURmXYAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
)
const portable = (): PortableImage => ({
  bytes: pngBytes.slice(),
  mimeType: 'image/png',
  filename: 'authored.png',
})
const originalURL = URL
let decoderFailure = false
let rasterFailure = false
let sequence = 0

beforeEach(() => {
  decoderFailure = false
  rasterFailure = false
  renderer.render.mockResolvedValue({
    svg: '<svg viewBox="0 0 100 50"><text>Diagram</text></svg>',
  })
  const blobs = new Map<string, Blob>()
  vi.stubGlobal(
    'URL',
    class extends originalURL {
      static createObjectURL = vi.fn((blob: Blob) => {
        const url = `blob:print-review-${++sequence}`
        blobs.set(url, blob)
        return url
      })
      static revokeObjectURL = vi.fn((url: string) => blobs.delete(url))
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
        const blob = blobs.get(value)
        if (!blob) {
          queueMicrotask(() => this.onerror?.())
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const bytes = new Uint8Array(reader.result as ArrayBuffer)
          const png =
            blob.type === 'image/png' &&
            [pngBytes, alternatePNG].some(
              (known) =>
                bytes.length === known.length &&
                bytes.every((byte, index) => byte === known[index]),
            )
          const svg =
            blob.type === 'image/svg+xml' &&
            new TextDecoder().decode(bytes).startsWith('<svg')
          if ((png && !decoderFailure) || (svg && !rasterFailure))
            this.onload?.()
          else this.onerror?.()
        }
        reader.readAsArrayBuffer(blob)
      }
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect() {},
    drawImage() {},
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/png;base64,${pngBase64}`,
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const images: ImageAdapter = {
  presentation() {
    return { url: 'private://print-image' }
  },
  async importImage() {
    return { reference: 'images/imported.png' }
  },
  async exportImage() {
    return portable()
  },
}
const input = {
  documentId: 'print-review',
  generation: 1,
  format: 'md' as const,
}
async function run(
  callback: (
    editor: InkKitEditor,
    root: HTMLElement,
    ctx: Ctx,
  ) => Promise<void>,
  adapter?: ImageAdapter,
  files?: FileAdapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, stateChanged() {}, copy() {}, openLink() {} },
    { images: adapter, files },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await callback(editor, root, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const body = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html').body

test('print exports the complete semantic model beyond selection and folded nested bodies', () =>
  run(async (editor, root, ctx) => {
    const source =
      '# Complete title\n\n[Reference][Target] and note[^one] ==highlight==.\n\n> [!NOTE]- Folded outer\n> Outer complete body.\n>\n> > [!TIP]- Folded inner\n> > NESTED_FINAL_BODY\n\n| Head | Other |\n| --- | --- |\n| Last cell | Table end |\n\nDOCUMENT_END\n\n[Target]: https://example.com/print "Target title"\n[^one]: FOOTNOTE_BODY\n\n    FOOTNOTE_CONTINUATION\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)),
    )
    root.style.height = '20px'
    const before = editor.snapshot()
    const printed = await editor.printableSnapshot(1)
    expect(printed).toMatchObject({
      documentId: input.documentId,
      generation: 1,
      revision: before.revision,
      format: 'md',
      assets: [],
      warnings: [],
    })
    const document = new DOMParser().parseFromString(printed.html, 'text/html')
    expect(document.querySelector('style')?.textContent).toBe(printed.styles)
    expect(printed.styles).toMatch(/@(?:media|page)/)
    expect(document.body.textContent).toContain('NESTED_FINAL_BODY')
    expect(document.body.textContent).toContain('DOCUMENT_END')
    expect(document.body.textContent).toContain('FOOTNOTE_CONTINUATION')
    expect(document.querySelector('table tr:last-child td')?.textContent).toBe(
      'Last cell',
    )
    expect(document.querySelector('mark')?.textContent).toBe('highlight')
    expect(
      document.querySelector('a[href="https://example.com/print"]')
        ?.textContent,
    ).toBe('Reference')
    expect(document.querySelector('sup a')).not.toBeNull()
    expect(
      document.querySelector(
        'button,[contenteditable],.copy,[data-inkkit-folded]',
      ),
    ).toBeNull()
    expect('markdown' in printed).toBe(false)
    expect(editor.snapshot()).toEqual(before)
  }))

test('print structurally excludes revealed comments and comment-bearing reference provenance', () =>
  run(async (editor, _root, ctx) => {
    const source =
      'Public <!--PRIVATE_INLINE--> %%PRIVATE_OBSIDIAN%% [safe][label<!--PRIVATE_LABEL-->] note[^one].\n\n<!--PRIVATE_BLOCK-->\n\n<div>Literal visible <!--PRIVATE_LITERAL--></div>\n\n[unused]: https://example.com/unused "PRIVATE_UNUSED"\n[label<!--PRIVATE_LABEL-->]: https://example.com/public\n[^one]: Public footnote <!--PRIVATE_FOOTNOTE-->\n'
    editor.loadDocument({ ...input, text: source })
    setCommentVisibility(ctx.get(editorViewCtx), true)
    const before = editor.snapshot()
    const printed = await editor.printableSnapshot()
    const content = body(printed.html)
    expect(printed.html).not.toContain('PRIVATE_')
    expect(content.textContent).toContain('Public footnote')
    expect(content.textContent).toContain('Literal visible')
    expect(
      content.querySelector(
        '[data-inkkit-reference],[data-inkkit-footnote-reference],.inkkit-comment,button',
      ),
    ).toBeNull()
    expect(
      content.querySelector('a[href="https://example.com/public"]'),
    ).not.toBeNull()
    expect(editor.snapshot()).toEqual(before)
  }))

test('TXT printing keeps punctuation, entities and comment-looking source literal', () =>
  run(async (editor, root) => {
    const text =
      '**literal** &#x20; <!--literal-->\r\nlast <script>literal()</script>'
    editor.loadDocument({ ...input, format: 'txt', text })
    root.querySelector('textarea')!.setSelectionRange(0, 1)
    const printed = await editor.printableSnapshot()
    expect(printed.format).toBe('txt')
    expect(body(printed.html).querySelector('pre')?.textContent).toBe(
      text.replaceAll('\r\n', '\n'),
    )
    expect(body(printed.html).querySelector('strong,script')).toBeNull()
    expect(printed.assets).toEqual([])
  }))

test('immediate editing and undo produce current complete printable revisions', () =>
  run(async (editor, _root, ctx) => {
    editor.loadDocument({ ...input, text: 'Initial\n' })
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('!', 8))
    const edited = await editor.printableSnapshot()
    expect(body(edited.html).textContent).toContain('Initial!')
    expect(edited.revision).toBe(editor.snapshot().revision)
    undo(view.state, view.dispatch)
    const reverted = await editor.printableSnapshot()
    expect(body(reverted.html).textContent).toContain('Initial')
    expect(body(reverted.html).textContent).not.toContain('Initial!')
    expect(reverted.revision).toBeGreaterThan(edited.revision)
  }))

test('portable assets follow full document DOM order, including duplicate authored images', () =>
  run(
    async (editor) => {
      const diagram = `flowchart LR\nPrint${++sequence} --> B`
      editor.loadDocument({
        ...input,
        text: `![First](images/a.png)\n\n~~~mermaid\n${diagram}\n~~~\n\n![Duplicate](images/a.png)\n\n![Last](images/b.png)\n`,
      })
      const printed = await editor.printableSnapshot()
      expect(printed.assets).toHaveLength(4)
      expect(printed.assets.map((asset) => asset.bytes)).toEqual([
        alternatePNG,
        pngBytes,
        alternatePNG,
        pngBytes,
      ])
      const elements = [...body(printed.html).querySelectorAll('img')]
      expect(elements).toHaveLength(4)
      expect(
        elements.every((element) =>
          element.src.startsWith('data:image/png;base64,'),
        ),
      ).toBe(true)
      expect(printed.html).not.toContain('private://')
      expect(printed.warnings).toEqual([])
    },
    {
      ...images,
      async exportImage(reference) {
        return {
          ...portable(),
          bytes: reference === 'images/a.png' ? alternatePNG : pngBytes,
          filename: reference,
        }
      },
    },
  ))

test('returned portable bytes are isolated from later adapter mutation', () =>
  run(
    async (editor) => {
      editor.loadDocument({ ...input, text: '![Asset](images/a.png)\n' })
      const printed = await editor.printableSnapshot()
      const bytes = printed.assets[0]!.bytes.slice()
      exposed.bytes.fill(0)
      expect(printed.assets[0]!.bytes).toEqual(bytes)
    },
    {
      ...images,
      async exportImage() {
        return exposed
      },
    },
  ))
const exposed = portable()

test('an unavailable adapter rejects rather than returning partial printed content', () =>
  run(async (editor) => {
    editor.loadDocument({
      ...input,
      text: 'Before\n\n![Unavailable](images/missing.png)\n\nAfter\n',
    })
    await expect(editor.printableSnapshot()).rejects.toMatchObject({
      code: 'image-unavailable',
    })
  }))

for (const fixture of [
  {
    name: 'empty bytes',
    image: { bytes: new Uint8Array(), mimeType: 'image/png' },
  },
  {
    name: 'bad signature',
    image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
  },
  { name: 'MIME mismatch', image: { bytes: pngBytes, mimeType: 'image/jpeg' } },
  {
    name: 'undecodable PNG',
    image: {
      bytes: Uint8Array.from(pngBytes, (value, index) =>
        index === 45 ? value ^ 1 : value,
      ),
      mimeType: 'image/png',
    },
  },
])
  test(`invalid authored image rejects print: ${fixture.name}`, () =>
    run(
      async (editor) => {
        editor.loadDocument({ ...input, text: '![Asset](images/a.png)\n' })
        await expect(editor.printableSnapshot()).rejects.toMatchObject({
          code: 'image-unavailable',
        })
      },
      {
        ...images,
        async exportImage() {
          return fixture.image
        },
      },
    ))

test('unsupported Mermaid retains readable code and reports a useful warning', () =>
  run(async (editor) => {
    editor.loadDocument({
      ...input,
      text: 'Before\n\n~~~~mermaid\nmindmap\nRoot\n~~~~\n\nAfter\n',
    })
    const printed = await editor.printableSnapshot()
    expect(body(printed.html).querySelector('pre code')?.textContent).toBe(
      'mindmap\nRoot',
    )
    expect(body(printed.html).textContent).toContain('Before')
    expect(body(printed.html).textContent).toContain('After')
    expect(printed.warnings).toEqual([
      expect.objectContaining({
        code: 'diagram-unavailable',
        message: expect.stringMatching(/not supported/i),
      }),
    ])
    expect(printed.assets).toEqual([])
  }))

test('valid rendered Mermaid with unavailable rasterisation rejects complete print output', () =>
  run(async (editor) => {
    rasterFailure = true
    editor.loadDocument({
      ...input,
      text: `~~~mermaid\nflowchart LR\nRaster${++sequence} --> B\n~~~\n`,
    })
    await expect(editor.printableSnapshot()).rejects.toMatchObject({
      code: 'diagram-unavailable',
    })
  }))

test('invalid Mermaid grammar retains source and reports the renderer parse error', () =>
  run(async (editor) => {
    renderer.render.mockRejectedValue(new Error('Parse error at line 2'))
    editor.loadDocument({
      ...input,
      text: `~~~mermaid\nflowchart LR\nInvalid${++sequence}[\n~~~\n`,
    })
    const printed = await editor.printableSnapshot()
    expect(body(printed.html).querySelector('pre code')?.textContent).toContain(
      '[',
    )
    expect(printed.warnings).toEqual([
      expect.objectContaining({
        code: 'diagram-unavailable',
        message: expect.stringContaining('Parse error'),
      }),
    ])
  }))

for (const mutation of [
  'edit',
  'edit then undo',
  'replacement',
  'same identity reload',
  'composition',
  'pending import',
  'destroy',
] as const) {
  test(`print rejects stale completion after ${mutation}`, () =>
    run(
      async (editor, _root, ctx) => {
        editor.loadDocument({
          ...input,
          text: 'Text\n\n![Asset](images/a.png)\n',
        })
        let release!: (image: PortableImage) => void
        let releaseImport!: (value: { reference: string }) => void
        const adapter = (
          editor as unknown as { options: { images: ImageAdapter } }
        ).options.images
        adapter.exportImage = () =>
          new Promise((resolve) => {
            release = resolve
          })
        adapter.importImage = () =>
          new Promise((resolve) => {
            releaseImport = resolve
          })
        const exporting = editor.printableSnapshot()
        const code =
          mutation === 'composition'
            ? 'composition'
            : mutation === 'pending import'
              ? 'operation-pending'
              : mutation === 'destroy'
                ? 'destroyed'
                : 'stale-document'
        const rejected = expect(exporting).rejects.toMatchObject({ code })
        await vi.waitFor(() => expect(release).toBeTypeOf('function'))
        const view = ctx.get(editorViewCtx)
        let pending: Promise<void> | undefined
        if (mutation === 'edit' || mutation === 'edit then undo') {
          view.dispatch(closeHistory(view.state.tr).insertText('!', 1))
          if (mutation === 'edit then undo') undo(view.state, view.dispatch)
        } else if (mutation === 'replacement')
          editor.loadDocument({
            ...input,
            documentId: 'replacement',
            generation: 2,
            text: 'Replacement',
          })
        else if (mutation === 'same identity reload')
          editor.reloadDocument({ ...input, text: 'Replacement' })
        else if (mutation === 'composition')
          Object.defineProperty(view, 'composing', {
            value: true,
            writable: true,
            configurable: true,
          })
        else if (mutation === 'pending import') {
          pending = editor.paste({ text: '', images: [portable()] })
          await vi.waitFor(() => expect(releaseImport).toBeTypeOf('function'))
        } else await editor.destroy()
        release(portable())
        await rejected
        if (mutation === 'composition')
          (view as unknown as { composing: boolean }).composing = false
        if (pending) {
          releaseImport({ reference: 'images/imported.png' })
          await pending
        }
      },
      { ...images },
    ))
}

test('print rejects pending imports, composition, stale generations and unloaded editors immediately', () =>
  run(async (editor, root) => {
    await expect(editor.printableSnapshot()).rejects.toMatchObject({
      code: 'not-ready',
    })
    editor.loadDocument({ ...input, format: 'txt', text: 'Complete' })
    await expect(editor.printableSnapshot(0)).rejects.toMatchObject({
      code: 'stale-document',
    })
    const textarea = root.querySelector('textarea')!
    textarea.dispatchEvent(new Event('compositionstart'))
    await expect(editor.printableSnapshot()).rejects.toMatchObject({
      code: 'composition',
    })
    textarea.dispatchEvent(new Event('compositionend'))
    expect(body((await editor.printableSnapshot()).html).textContent).toContain(
      'Complete',
    )
  }))

test('print keeps nested task state and table alignment without input controls', () =>
  run(async (editor) => {
    editor.loadDocument({
      ...input,
      text: '- [x] Complete task\n  - [ ] Nested task\n\n| Left | Right |\n| :--- | ---: |\n| Alpha | Omega |\n',
    })
    const printed = await editor.printableSnapshot()
    const content = body(printed.html)
    expect(
      [...content.querySelectorAll('.inkkit-print-task-marker')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['[x] ', '[ ] '])
    expect(content.querySelector('input,button')).toBeNull()
    expect(
      [...content.querySelectorAll('tbody td')].map(
        (cell) => (cell as HTMLElement).style.textAlign,
      ),
    ).toEqual(['left', 'right'])
  }))

test('referenced footnotes have working local targets with complete multi-paragraph bodies', () =>
  run(async (editor) => {
    editor.loadDocument({
      ...input,
      text: 'One[^Note] and again[^note].\n\n[^Note]: First paragraph.\n\n    Final paragraph.\n',
    })
    const content = body((await editor.printableSnapshot()).html)
    const references = [...content.querySelectorAll<HTMLAnchorElement>('sup a')]
    expect(references).toHaveLength(2)
    expect(references[0]!.getAttribute('href')).toBe(
      references[1]!.getAttribute('href'),
    )
    const target = content.querySelector(references[0]!.getAttribute('href')!)
    expect(target?.textContent).toContain('First paragraph.')
    expect(target?.textContent).toContain('Final paragraph.')
  }))

test('editing while Mermaid rendering is awaited rejects rather than returning older printable source', () =>
  run(async (editor, _root, ctx) => {
    let finish!: (value: { svg: string }) => void
    renderer.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    editor.loadDocument({
      ...input,
      text: `~~~mermaid\nflowchart LR\nAwaited${++sequence} --> B\n~~~\n`,
    })
    const exporting = editor.printableSnapshot()
    const rejected = expect(exporting).rejects.toMatchObject({
      code: 'stale-document',
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('Changed', 1))
    finish({ svg: '<svg viewBox="0 0 100 50"><text>Diagram</text></svg>' })
    await rejected
  }))

test('a failed awaited image export still reports a changed document', () =>
  run(
    async (editor, _root, ctx) => {
      let fail!: (error: Error) => void
      const adapter = (
        editor as unknown as { options: { images: ImageAdapter } }
      ).options.images
      adapter.exportImage = () =>
        new Promise((_resolve, reject) => {
          fail = reject
        })
      editor.loadDocument({ ...input, text: '![Asset](images/a.png)\n' })
      const exporting = editor.printableSnapshot()
      const rejected = expect(exporting).rejects.toMatchObject({
        code: 'stale-document',
      })
      await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('Changed', 1))
      fail(new Error('Storage became unavailable'))
      await rejected
    },
    { ...images },
  ))

test('normal code preserves comment-looking text while actual author comments are excluded', () =>
  run(async (editor) => {
    editor.loadDocument({
      ...input,
      text: 'Actual <!--PRIVATE_AUTHOR--> comment.\n\n```txt\n<!--VISIBLE_CODE-->\n%%VISIBLE_CODE%%\n```\n',
    })
    const printed = await editor.printableSnapshot()
    expect(printed.html).not.toContain('PRIVATE_AUTHOR')
    expect(body(printed.html).querySelector('pre code')?.textContent).toBe(
      '<!--VISIBLE_CODE-->\n%%VISIBLE_CODE%%',
    )
  }))

for (const fixture of [
  {
    name: 'fenced code',
    source: '```md\n![literal](images/a.png)\n```\n',
    visible: '![literal](images/a.png)',
  },
  {
    name: 'inline code',
    source: 'Visible `![literal](images/a.png)` content.\n',
    visible: '![literal](images/a.png)',
  },
  {
    name: 'frontmatter',
    source: '---\nimage: "![opaque](images/a.png)"\n---\n\nPublic body.\n',
    visible: 'Public body.',
  },
  {
    name: 'hidden comments',
    source:
      'Public <!--![private](images/a.png)--> %%![private](images/b.png)%% body.\n',
    visible: 'Public',
  },
  {
    name: 'raw HTML',
    source: '<div><img src="private://opaque" alt="Opaque image"></div>\n',
    visible: 'Opaque image',
  },
  {
    name: 'unresolved image reference',
    source: '![unresolved][unknown]\n',
    visible: '![unresolved][unknown]',
  },
])
  test(`literal imagery does not require an adapter: ${fixture.name}`, () =>
    run(async (editor) => {
      editor.loadDocument({ ...input, text: fixture.source })
      const printed = await editor.printableSnapshot()
      expect(printed.assets).toEqual([])
      expect(body(printed.html).textContent).toContain(fixture.visible)
      expect(body(printed.html).querySelector('img')).toBeNull()
    }))

test('TXT image-looking source remains literal without an adapter', () =>
  run(async (editor) => {
    editor.loadDocument({
      ...input,
      format: 'txt',
      text: '![literal](images/a.png)',
    })
    const printed = await editor.printableSnapshot()
    expect(printed.assets).toEqual([])
    expect(body(printed.html).querySelector('pre')?.textContent).toBe(
      '![literal](images/a.png)',
    )
  }))

test.each(['wiki', 'path'] as const)(
  'resolved %s images keep portable bytes, useful names and width in copy and print',
  (kind) => {
    const seen: { kind: string; width?: number }[] = []
    return run(
      async (editor) => {
        const source =
          kind === 'wiki' ? '![[photo|240]]\n' : '![Photo|240](opaque.png)\n'
        editor.loadDocument({ ...input, text: source })
        const copied = await editor.clipboardSnapshot()
        expect(copied.text).toBe('Resolved photo')
        expect(copied.html).toContain('width="240"')
        expect(copied.html).toContain(`data:image/png;base64,${pngBase64}`)
        expect(copied.html).not.toContain('private://')
        expect(copied.markdown).toBe(source)
        const printed = await editor.printableSnapshot()
        expect(
          body(printed.html).querySelector('img')?.getAttribute('alt'),
        ).toBe('Resolved photo')
        expect(
          body(printed.html).querySelector('img')?.getAttribute('width'),
        ).toBe('240')
        expect(printed.html).not.toContain('private://')
        expect(printed.assets).toHaveLength(1)
        expect(printed.assets[0]!.bytes).toEqual(pngBytes)
        expect(printed.warnings).toEqual([])
        expect(seen).toEqual([
          { kind, width: 240 },
          { kind, width: 240 },
        ])
        expect(editor.snapshot().text).toBe(source)
      },
      undefined,
      {
        resolve: async () => ({
          kind: 'image',
          label: 'Resolved photo',
          url: 'private://photo',
        }),
        exportImage: async (reference) => {
          seen.push({ kind: reference.kind, width: reference.width })
          return portable()
        },
      },
    )
  },
)

test('optional files retain legacy path image exports but never use them for named images', () => {
  const exported = vi.fn(async () => portable())
  return run(
    async (editor) => {
      editor.loadDocument({ ...input, text: '![Path|120](opaque.png)\n' })
      expect(
        (await editor.clipboardSnapshot()).images[0]?.image?.bytes,
      ).toEqual(pngBytes)
      expect((await editor.printableSnapshot()).assets).toHaveLength(1)
      expect(exported).toHaveBeenCalledTimes(2)
      editor.loadDocument({ ...input, text: '![[named|120]]\n' })
      expect((await editor.clipboardSnapshot()).images[0]?.error).toMatch(
        /portable export/i,
      )
      await expect(editor.printableSnapshot()).rejects.toMatchObject({
        code: 'image-unavailable',
      })
      expect(exported).toHaveBeenCalledTimes(2)
    },
    { ...images, exportImage: exported },
    {
      resolve: async () => ({ kind: 'image', url: 'private://photo' }),
    },
  )
})

test('reload promptly cancels a held image decoder and releases its object URL', () => {
  let decoding = false
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1
      naturalHeight = 1
      onload?: () => void
      onerror?: () => void
      set src(_value: string) {
        decoding = true
      }
    },
  )
  return run(
    async (editor) => {
      const document = { ...input, text: '![[photo]]\n' }
      editor.loadDocument(document)
      const printing = editor.printableSnapshot()
      const rejected = expect(printing).rejects.toMatchObject({
        code: 'stale-document',
      })
      await vi.waitFor(() => expect(decoding).toBe(true))
      editor.reloadDocument(document)
      await rejected
      expect(URL.revokeObjectURL).toHaveBeenCalled()
    },
    undefined,
    {
      resolve: async () => ({ kind: 'image', url: 'private://photo' }),
      exportImage: async () => portable(),
    },
  )
})
