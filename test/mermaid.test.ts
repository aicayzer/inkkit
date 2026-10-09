import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import {
  InkKitEditor,
  type EditorEvents,
  type ImageAdapter,
} from '../src/index'
import {
  diagramImage,
  renderDiagram,
  safeDiagramSVG,
  validateDiagram,
} from '../src/mermaid'
import { Preservation } from '../src/preserve'
import { withEditor } from './harness'

const renderer = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: renderer }))

const cleanSVG =
  '<svg viewBox="0 0 100 50"><text x="5" y="20">Diagram</text></svg>'
let sequence = 0
const source = () => `flowchart LR\nA${++sequence} --> B`
const originalURL = URL
const diagramBytes = new Uint8Array([4, 5, 6])
const imageBytes = new Uint8Array([1, 2, 3])

beforeEach(() => {
  renderer.initialize.mockReset()
  renderer.render.mockReset().mockResolvedValue({ svg: cleanSVG })
  vi.stubGlobal(
    'URL',
    class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:inkkit-diagram-test')
      static revokeObjectURL = vi.fn()
    },
  )
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void
      onerror?: () => void
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,BAUG',
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
      ...events,
    },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await callback(editor, root, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = {
  documentId: 'mermaid-tests',
  generation: 1,
  format: 'md' as const,
}
const images: ImageAdapter = {
  presentation() {
    return undefined
  },
  async importImage() {
    return { reference: 'images/imported.png' }
  },
  async exportImage() {
    return { bytes: imageBytes, mimeType: 'image/png' }
  },
}

for (const diagram of [
  'flowchart LR\nA --> B',
  'graph TD\nA --> B',
  'sequenceDiagram\nAlice->>Bob: Hello',
  'classDiagram\nclass A',
  'stateDiagram-v2\n[*] --> A',
  'stateDiagram\n[*] --> A',
  'erDiagram\nA ||--|| B : owns',
  'pie\n"A" : 1',
])
  test(`accepts bounded diagram syntax: ${diagram.split('\n')[0]}`, () => {
    expect(() => validateDiagram(diagram)).not.toThrow()
  })

for (const attack of [
  '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B',
  '---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\nA-->B',
  'flowchart LR\nA[<img src="https://example.com/a.png">]',
  'flowchart LR\nA[&#x3c;script&#x3e;]',
  'flowchart LR\nA@{ img: "https://example.com/a.png" }',
  'flowchart LR\nclick A callback',
  'flowchart LR\nclick A "javascript:alert(1)"',
  'flowchart LR\nA[$$x$$]',
  'flowchart LR\nstyle A fill:url(/tracking)',
  'flowchart LR\nclassDef unsafe fill:u\\72l(/tracking)',
  'flowchart LR\nlinkStyle 0 stroke:#f00',
  'mindmap\nRoot',
  'flowchart LR\n' + 'x'.repeat(30000),
])
  test(`unsafe or unsupported input never reaches renderer: ${attack.slice(0, 60)}`, async () => {
    await expect(renderDiagram(attack)).rejects.toThrow()
    expect(renderer.render).not.toHaveBeenCalled()
  })

test('safe SVG strips executable elements, resources and handlers but keeps fragment markers', () => {
  const result = safeDiagramSVG(
    '<svg viewBox="0 0 100 50" onload="alert(1)"><script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject><image href="https://example.com/pixel"/><a href="javascript:alert(1)"><text>link</text></a><style>@import "/pixel";</style><path marker-end="url(#arrow)" style="fill:url(/pixel)" onclick="alert(1)"/></svg>',
  )
  expect(result).not.toMatch(
    /script|foreignObject|<image|<a\b|onload|onclick|\/pixel|javascript:/i,
  )
  expect(result).toContain('url(#arrow)')
})

test('safe SVG removes resource CSS from the SVG root', () => {
  expect(
    safeDiagramSVG(
      '<svg viewBox="0 0 100 50" style="fill:url(https://example.com/pixel)"><rect width="10" height="10"/></svg>',
    ),
  ).not.toContain('example.com')
})

test('safe SVG rejects escaped CSS resources before insertion', () => {
  expect(
    safeDiagramSVG(
      '<svg viewBox="0 0 100 50"><style>rect{fill:u\\72l(/pixel)}</style><rect width="10" height="10"/></svg>',
    ),
  ).not.toContain('/pixel')
})

test('rendering locks safe configuration and removes its temporary DOM', async () => {
  await renderDiagram(source())
  expect(renderer.initialize).toHaveBeenCalledWith(
    expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      maxEdges: 500,
      secure: expect.arrayContaining([
        'securityLevel',
        'htmlLabels',
        'dompurifyConfig',
        'themeCSS',
      ]),
    }),
  )
  expect(
    document.querySelector('[aria-hidden="true"][style*="-100000px"]'),
  ).toBeNull()
})

test('a rejected renderer does not poison subsequent diagram rendering', async () => {
  renderer.render.mockRejectedValueOnce(new Error('Malformed diagram'))
  await expect(renderDiagram(source())).rejects.toThrow('Malformed diagram')
  await expect(renderDiagram(source())).resolves.toContain('<svg')
  expect(
    document.querySelector('[aria-hidden="true"][style*="-100000px"]'),
  ).toBeNull()
})

test('a transient renderer failure can be retried without editing the authored diagram', async () => {
  const diagram = source()
  renderer.render.mockRejectedValueOnce(
    new Error('Renderer temporarily unavailable'),
  )
  await expect(renderDiagram(diagram)).rejects.toThrow(
    'temporarily unavailable',
  )
  await expect(renderDiagram(diagram)).resolves.toContain('<svg')
})

test('portable diagram bounds oversized rasters and releases blob URLs', async () => {
  renderer.render.mockResolvedValueOnce({
    svg: '<svg viewBox="0 0 100000 50000"><rect width="100" height="50"/></svg>',
  })
  const dimensions: number[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    function (this: HTMLCanvasElement) {
      dimensions.push(this.width, this.height)
      return 'data:image/png;base64,BAUG'
    },
  )
  const result = await diagramImage(source())
  expect(dimensions).toEqual([4096, 2048])
  expect(result).toMatchObject({ bytes: diagramBytes, mimeType: 'image/png' })
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:inkkit-diagram-test')
})

for (const authored of [
  '__Before__\r\n\r\n~~~~mermaid  \r\nflowchart LR\r\nA --> B\r\n~~~~~~  \r\n\r\n_After_\r\n',
  '> ~~~~mermaid\r\n> flowchart LR\r\n> A --> B\r\n> ~~~~\r\n',
  '- Item\n\n  ~~~~mermaid\n  flowchart LR\n  A --> B\n  ~~~~\n',
])
  test(`editing diagram retains authored fences and surroundings: ${JSON.stringify(authored.slice(0, 45))}`, async () => {
    await withEditor(authored, (editor) => {
      const view = editor.ctx.get(editorViewCtx)
      const preserve = new Preservation(editor.ctx, authored)
      let from = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block')
          from = pos + 1 + node.textContent.indexOf('A --> B')
      })
      view.dispatch(view.state.tr.insertText('C', from, from + 1))
      const edited = preserve.serialize(view.state.doc)
      expect(edited).toBe(authored.replace('A --> B', 'C --> B'))
      expect(editor.ctx.get(parserCtx)(edited).eq(view.state.doc)).toBe(true)
    })
  })

test('diagram editing, undo, snapshot and save/reopen preserve authored bytes', () =>
  run(async (editor, _root, ctx) => {
    const authored =
      '~~~~mermaid\r\n' + source().replaceAll('\n', '\r\n') + '\r\n~~~~\r\n'
    editor.loadDocument({ ...input, text: authored })
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('x', 1))
    expect(editor.snapshot().text).toBe(
      authored.replace('flowchart', 'xflowchart'),
    )
    undo(view.state, view.dispatch)
    expect(editor.snapshot()).toMatchObject({ text: authored, dirty: false })
    editor.loadDocument({
      ...input,
      generation: 2,
      text: editor.snapshot().text,
    })
    expect(editor.snapshot().text).toBe(authored)
  }))

test('a newly inserted closing-fence run enlarges authored backtick fences without losing source', async () => {
  const fence = String.fromCharCode(96).repeat(4)
  const authored = `${fence}mermaid  note\nflowchart LR\nA --> B\n${fence}\n`
  await withEditor(authored, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preserve = new Preservation(editor.ctx, authored)
    const from = 1 + view.state.doc.firstChild!.textContent.indexOf('A --> B')
    view.dispatch(view.state.tr.insertText(`C\n${fence}\nD`, from, from + 7))
    const enlarged = String.fromCharCode(96).repeat(5)
    const saved = preserve.serialize(view.state.doc)
    expect(saved).toBe(
      `${enlarged}mermaid  note\nflowchart LR\nC\n${fence}\nD\n${enlarged}\n`,
    )
    const semantic = (value: unknown) =>
      JSON.stringify(value, (key, item) =>
        key === 'authoredFence' ? undefined : item,
      )
    expect(semantic(editor.ctx.get(parserCtx)(saved).toJSON())).toBe(
      semantic(view.state.doc.toJSON()),
    )
  })
})

test('diagram-only selection preserves its complete authored Markdown fence', () =>
  run(async (editor, _root, ctx) => {
    const diagram = source()
    const authored = `~~~~mermaid  \n${diagram}\n~~~~~~  `
    editor.loadDocument({ ...input, text: `Before\n\n${authored}\n\nAfter\n` })
    const view = ctx.get(editorViewCtx)
    const start = view.state.doc.firstChild!.nodeSize
    const block = view.state.doc.child(1)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(
          view.state.doc,
          start + 1,
          start + block.nodeSize - 1,
        ),
      ),
    )
    const clip = await editor.clipboardSnapshot(false)
    expect(clip.markdown.trimEnd()).toBe(authored.trimEnd())
    expect(clip.diagrams?.[0]?.source).toBe(diagram)
    expect(clip.html).not.toContain('Before')
    expect(clip.html).not.toContain('After')
  }))

test('diagram-rich HTML roundtrip retains editable source and surrounding content', () =>
  run(async (editor) => {
    const diagram = source()
    editor.loadDocument({
      ...input,
      text: `Before\n\n~~~~mermaid\n${diagram}\n~~~~\n\nAfter\n`,
    })
    const clip = await editor.clipboardSnapshot()
    expect(clip.markdown).toBe(editor.snapshot().text)
    expect(clip.diagrams).toEqual([
      {
        source: diagram,
        image: expect.objectContaining({ bytes: diagramBytes }),
      },
    ])
    expect(clip.html).toContain('data:image/png;base64,BAUG')
    expect(clip.html.indexOf('Before')).toBeLessThan(
      clip.html.indexOf('<figure'),
    )
    expect(clip.html.indexOf('After')).toBeGreaterThan(
      clip.html.indexOf('<figure'),
    )
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    expect(editor.snapshot().text).toContain(`\n${diagram}\n`)
    expect(editor.snapshot().text).toContain('Before')
    expect(editor.snapshot().text).toContain('After')
    undo(
      (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
        editorViewCtx,
      ).state,
      (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
        editorViewCtx,
      ).dispatch,
    )
    expect(editor.snapshot().text).toBe('')
  }))

test('diagram-only rich paste preserves the authored fence, whitespace and line endings', () =>
  run(async (editor) => {
    const diagram = source()
    const authored = `~~~~mermaid  \r\n${diagram.replaceAll('\n', '\r\n')}\r\n~~~~~~  \r\n`
    editor.loadDocument({ ...input, text: authored })
    const clip = await editor.clipboardSnapshot()
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    expect(editor.snapshot().text).toBe(authored)
  }))

test('mixed authored images and diagrams retain native attachment DOM order', () =>
  run(
    async (editor) => {
      const diagram = source()
      editor.loadDocument({
        ...input,
        text: `![First](images/first.png)\n\n~~~mermaid\n${diagram}\n~~~\n\n![Last](images/last.png)\n`,
      })
      const clip = await editor.clipboardSnapshot()
      expect(clip.images.map((entry) => entry.image?.bytes)).toEqual([
        imageBytes,
        diagramBytes,
        imageBytes,
      ])
      const parsed = new DOMParser().parseFromString(clip.html, 'text/html')
      expect(
        [...parsed.querySelectorAll('img')].map((node) =>
          node.getAttribute('data-inkkit-image-slot'),
        ),
      ).toEqual(['0', '1', '2'])
      editor.loadDocument({ ...input, generation: 2, text: '' })
      await editor.paste({ text: clip.text, html: clip.html })
      expect(editor.snapshot().text).toContain(diagram)
      expect(
        editor.snapshot().text.match(/images\/imported.png/g),
      ).toHaveLength(2)
    },
    { ...images, importImage: vi.fn(images.importImage) },
  ))

test('native mixed HTML paste associates image bytes after restoring diagram source', async () => {
  const importImage = vi.fn<ImageAdapter['importImage']>(async () => ({
    reference: 'images/imported.png',
  }))
  const lastBytes = new Uint8Array([7, 8, 9])
  await run(
    async (editor) => {
      const diagram = source()
      editor.loadDocument({
        ...input,
        text: `![First](images/first.png)\n\n~~~mermaid\n${diagram}\n~~~\n\n![Last](images/last.png)\n`,
      })
      const clip = await editor.clipboardSnapshot()
      editor.loadDocument({ ...input, generation: 2, text: '' })
      await editor.paste({
        text: clip.text,
        html: clip.html,
        images: clip.images.map((entry) => entry.image!),
      })
      expect(
        importImage.mock.calls.map(
          (call) => (call[0] as { bytes: Uint8Array }).bytes,
        ),
      ).toEqual([imageBytes, lastBytes])
      expect(editor.snapshot().text).toContain(diagram)
    },
    {
      ...images,
      importImage,
      async exportImage(reference) {
        return {
          bytes: reference.includes('last') ? lastBytes : imageBytes,
          mimeType: 'image/png',
        }
      },
    },
  )
})

test('renderer and raster failures retain source and report useful clipboard fallback', () =>
  run(async (editor) => {
    editor.loadDocument({
      ...input,
      text: 'Before\n\n~~~mermaid\nmindmap\nRoot\n~~~\n\nAfter\n',
    })
    const clip = await editor.clipboardSnapshot()
    expect(clip.diagrams?.[0]?.error).toMatch(/not supported/)
    expect(clip.html).toContain('Diagram unavailable:')
    expect(clip.html).toContain('mindmap\nRoot')
    expect(clip.text).toContain('Before')
    expect(clip.text).toContain('After')
    const diagram = source()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    editor.loadDocument({
      ...input,
      generation: 2,
      text: `~~~mermaid\n${diagram}\n~~~\n`,
    })
    const failed = await editor.clipboardSnapshot()
    expect(failed.diagrams?.[0]?.error).toMatch(/unavailable/)
    expect(
      new DOMParser()
        .parseFromString(failed.html, 'text/html')
        .querySelector('code')?.textContent,
    ).toBe(diagram)
    expect(failed.images).toEqual([])
  }))

test('partial diagram source copy remains readable source rather than a rendered diagram', () =>
  run(async (editor, _root, ctx) => {
    const diagram = source()
    editor.loadDocument({ ...input, text: `~~~mermaid\n${diagram}\n~~~\n` })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 12)),
    )
    const clip = await editor.clipboardSnapshot(false)
    expect(clip.text).toBe(diagram.slice(0, 11))
    expect(clip.diagrams ?? []).toEqual([])
    expect(clip.html).not.toContain('<figure')
  }))

test('replacing a document during diagram export rejects stale completion', () =>
  run(async (editor) => {
    let finish!: (value: { svg: string }) => void
    renderer.render.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    editor.loadDocument({ ...input, text: `~~~mermaid\n${source()}\n~~~\n` })
    const exporting = editor.clipboardSnapshot()
    const rejected = expect(exporting).rejects.toMatchObject({
      code: 'stale-document',
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    editor.loadDocument({
      ...input,
      documentId: 'new',
      generation: 2,
      text: 'Replacement',
    })
    finish({ svg: cleanSVG })
    await rejected
    expect(editor.snapshot().text).toBe('Replacement')
  }))

test('pending authored-image import prevents exporting a document containing diagrams', () =>
  run(
    async (editor) => {
      let finish!: (value: { reference: string }) => void
      const deferred: ImageAdapter = (
        editor as unknown as { options: { images: ImageAdapter } }
      ).options.images
      deferred.importImage = () =>
        new Promise((resolve) => {
          finish = resolve
        })
      editor.loadDocument({
        ...input,
        text: `~~~mermaid\n${source()}\n~~~\n\nAfter\n`,
      })
      const pending = editor.paste({
        text: '',
        images: [{ bytes: imageBytes, mimeType: 'image/png' }],
      })
      await expect(editor.clipboardSnapshot()).rejects.toMatchObject({
        code: 'operation-pending',
      })
      finish({ reference: 'images/imported.png' })
      await pending
    },
    { ...images },
  ))
