import { ctxOf, optionsOf } from './editor-access'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Schema } from '@milkdown/kit/prose/model'
import * as pele from 'pele'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import {
  InkKitEditor,
  type EditorEvents,
  type InkKitError,
  type ImageAdapter,
} from '../src/index'
import {
  diagramImage,
  renderDiagram,
  registerDiagram,
  DiagramStore,
} from '../src/mermaid'
import { renderPele, safeDiagramSVG } from '../src/pele'
import { validateDiagram } from '../src/diagram-validation'
import { Preservation } from '../src/preserve'
import { withEditor } from './harness'

vi.mock('pele', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pele')>()
  return { ...actual, render: vi.fn(actual.render) }
})

const renderer = {
  render: vi.fn<(source: string) => string | Promise<string>>(),
}

const cleanSVG =
  '<svg viewBox="0 0 100 50"><text x="5" y="20">Diagram</text></svg>'
let sequence = 0
const source = () => `flowchart LR\nA${++sequence} --> B`
const originalURL = URL
const diagramBytes = new Uint8Array([4, 5, 6])
const imageBytes = new Uint8Array([1, 2, 3])

beforeEach(() => {
  vi.mocked(pele.render).mockClear()
  renderer.render.mockReset().mockResolvedValue(cleanSVG)
  registerDiagram((source) => {
    validateDiagram(source)
    return renderer.render(source)
  })
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
  registerDiagram(renderPele)
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
      copy() {},
      openLink() {},
      ...events,
    },
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

for (const label of [
  'flowchart TD\nA[Click to upload image] --> B',
  'flowchart TD\nA[Style guide] --> B[Link icon]',
  'graph TD\nA[icon] --> B[href] --> C[callback]',
  'flowchart TD\nA["classDef and linkStyle"] --> B',
  'flowchart TD\nA -- click here --> B',
  'flowchart TD\nA -->|Click me| B',
  'flowchart TD\nA{Link broken?} --> B{{Image}}',
  'flowchart TD\nsubgraph Style guide\nA --> B\nend',
  'flowchart TD\nA["Fontawesome icons"] --> B\n%% click the link, style it',
  'sequenceDiagram\nA->>B: Send link',
  'sequenceDiagram\nparticipant A as Image service\nNote over A,B: click the style icon',
  'classDiagram\nclass Account {\n+String icon\n+String link\n}\nAccount --> Account : click',
  'stateDiagram-v2\nstate "Click to start" as S\nS --> T : style guide\nS : image icon href',
  'erDiagram\nA ||--|| B : "Click link"\nA {\nstring link\nstring style\n}',
  'pie title Style guide\n"click" : 1\n"link" : 2\n"image" : 3',
  'flowchart TD\nA[CLICK] --> B[LINKSTYLE]',
])
  test(`accepts directive words as plain label text: ${label.replace(/\n/g, ' | ')}`, () => {
    expect(() => validateDiagram(label)).not.toThrow()
  })

for (const attack of [
  '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA[Click]-->B',
  'flowchart LR\nA[Click]-->B\n%%{init: {"securityLevel":"loose"}}%%',
  'flowchart LR\nA[Click]-->B;  %%{init: {}}%%',
  '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B',
  '---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\nA-->B',
  'flowchart LR\nA-->B\n\n\t ---\nconfig: {}\n---',
  'flowchart LR\r\nA-->B\r\n\r\n  ---',
  'flowchart LR\nA-->B\u2028 ---',
  'flowchart LR\nA[<img src="https://example.com/a.png">]',
  'flowchart LR\nA[&#x3c;script&#x3e;]',
  'flowchart LR\nA@{ img: "https://example.com/a.png" }',
  'flowchart LR\nclick A "javascript:alert(1)"',
  'flowchart LR\nA[$$x$$]',
  'flowchart LR\nstyle A fill:url(/tracking)',
  'flowchart LR\nclassDef unsafe fill:u\\72l(/tracking)',
  'flowchart LR\nA --> B\nclassDef c mask-image:image-set("/pixel" 1x)',
  'flowchart LR\nA --> B\nclassDef c mask:-WEBKIT-IMAGE-SET("/pixel" 1x)',
  'flowchart LR\nA --> B\nclassDef c fill:cross-fade("/a", "/b", 50%)',
  'flowchart LR\nA[image-set ("/pixel" 1x)] --> B',
  'mindmap\nRoot',
  'flowchart LR\n' + 'x'.repeat(30000),
])
  test(`unsafe or unsupported input never reaches renderer: ${attack.slice(0, 60)}`, async () => {
    await expect(renderDiagram(attack)).rejects.toThrow()
    expect(renderer.render).not.toHaveBeenCalled()
  })

test('a run of blank lines takes the configuration check no longer than a line of text', () => {
  const time = (filler: string) => {
    const source = 'flowchart LR\nA --- B\n' + filler.repeat(29_000)
    const start = performance.now()
    expect(() => validateDiagram(source)).not.toThrow()
    return performance.now() - start
  }
  time('x')
  time('\n')
  // A busy machine only slows a sample, so compare the fastest of several,
  // taken in turn.
  let lines = Infinity
  let blank = Infinity
  for (let i = 0; i < 5; i++) {
    lines = Math.min(lines, time('x'))
    blank = Math.min(blank, time('\n'))
  }
  // Rescanning the blank lines that follow each line start took 400 ms here.
  expect(blank).toBeLessThan(lines * 5 + 50)
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

for (const resource of [
  'image-set("/pixel" 1x)',
  '-webkit-image-set("/pixel" 1x)',
  'IMAGE-SET ("/pixel" 1x)',
  'cross-fade("/pixel", "/other", 50%)',
  '-webkit-cross-fade("/pixel", "/other", 50%)',
  'image("/pixel")',
  'src("/pixel")',
  'element(#pixel)',
  '-moz-element(#pixel)',
])
  test(`safe SVG removes CSS resource functions: ${resource}`, () => {
    const result = safeDiagramSVG(
      `<svg viewBox="0 0 100 50"><style>rect{mask-image:${resource}}</style><rect width="10" height="10" style='mask-image:${resource}'/><rect width="10" height="10" mask='${resource}'/></svg>`,
    )
    expect(result).not.toMatch(/pixel/)
    expect(result).toContain('<rect')
  })

test('Pele parses before layout and keeps rendering bounded and offline', () => {
  const layout = vi.mocked(pele.render).mockReturnValueOnce({
    svg: cleanSVG,
    width: 100,
    height: 50,
    links: [],
    type: 'flowchart',
    mermaidType: 'flowchart-v2',
  })
  expect(renderPele(source())).toContain('<svg')
  expect(layout).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'flowchart', nodes: expect.any(Map) }),
    expect.objectContaining({
      fontFamily: 'Arial, sans-serif',
      limit: 30000,
      maxEdges: 500,
      links: false,
      images: false,
      autoDirection: false,
      idPrefix: expect.any(String),
    }),
  )
  expect(
    document.querySelector('[aria-hidden="true"][style*="-100000px"]'),
  ).toBeNull()
})

test('a Pele parse error is reported before layout', () => {
  const layout = vi.mocked(pele.render)
  expect(() => renderPele('flowchart TD\nA[Unclosed')).toThrow()
  expect(layout).not.toHaveBeenCalled()
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
  renderer.render.mockResolvedValueOnce(
    '<svg viewBox="0 0 100000 50000"><rect width="100" height="50"/></svg>',
  )
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
    const clip = await editor.clipboardSnapshot('selection')
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
      ctxOf(editor).get(editorViewCtx).state,
      ctxOf(editor).get(editorViewCtx).dispatch,
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

test('a diagram that cannot render is reported once, by its preview; its copy describes itself', async () => {
  const errors: InkKitError[] = []
  await run(
    async (editor) => {
      editor.loadDocument({
        ...input,
        text: '~~~mermaid\nmindmap\nRoot\n~~~\n',
      })
      await vi.waitFor(() => expect(errors).toHaveLength(1))
      expect(errors[0]).toMatchObject({ code: 'diagram-unavailable' })
      expect(errors[0]!.cause).toBeInstanceOf(Error)
      const copied = await editor.clipboardSnapshot()
      expect(copied.diagrams?.[0]?.error).toEqual(expect.any(String))
      expect(errors).toHaveLength(1)
    },
    undefined,
    { error: (error) => errors.push(error) },
  )
})

test('partial diagram source copy remains readable source rather than a rendered diagram', () =>
  run(async (editor, _root, ctx) => {
    const diagram = source()
    editor.loadDocument({ ...input, text: `~~~mermaid\n${diagram}\n~~~\n` })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 12)),
    )
    const clip = await editor.clipboardSnapshot('selection')
    expect(clip.text).toBe(diagram.slice(0, 11))
    expect(clip.diagrams ?? []).toEqual([])
    expect(clip.html).not.toContain('<figure')
  }))

test('source selection export reuses the edited diagram cached by a whole-document export', () =>
  run(async (editor, root) => {
    const fence = '~~~~mermaid  \r\nflowchart LR\r\nA --> Target\r\n~~~~~~  '
    const authored = `__Before__ café\r\n\r\n${fence}\r\n\r\n_After_\r\n`
    const edited = authored.replace('A --> Target', 'B --> Target')
    const editedFence = fence.replace('A --> Target', 'B --> Target')
    const editedDiagram = 'flowchart LR\nB --> Target'
    editor.loadDocument({ ...input, text: authored })
    expect(editor.setEditingMode('source')).toBe(true)
    const plain = root.querySelector('textarea')!
    const at = plain.value.indexOf('A --> Target')
    plain.setSelectionRange(at, at + 1)
    plain.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText' }),
    )
    plain.setRangeText('B', at, at + 1, 'end')
    plain.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
    )
    expect(editor.snapshot().text).toBe(edited)

    const whole = await editor.clipboardSnapshot()
    expect(whole.markdown).toBe(edited)
    expect(whole.diagrams?.[0]?.source).toBe(editedDiagram)
    expect(
      renderer.render.mock.calls.filter(([text]) => text === editedDiagram),
    ).toHaveLength(1)
    const callsAfterWholeExport = renderer.render.mock.calls.length
    const saved = editor.snapshot()
    const selectedFence = editedFence.replaceAll('\r\n', '\n')
    const start = plain.value.indexOf(selectedFence)
    expect(start).toBeGreaterThanOrEqual(0)
    plain.setSelectionRange(start, start + selectedFence.length)

    const selection = await editor.clipboardSnapshot('selection')
    expect(selection.markdown).toBe(editedFence)
    expect(selection.diagrams?.[0]?.source).toBe(editedDiagram)
    expect(selection.html).toContain('<figure')
    expect(selection.html).not.toContain('Before')
    expect(selection.html).not.toContain('After')
    expect(renderer.render).toHaveBeenCalledTimes(callsAfterWholeExport)
    expect(editor.snapshot()).toEqual(saved)
    expect(editor.snapshot().text).toBe(edited)
  }))

test('replacing a document during diagram export rejects stale completion', () =>
  run(async (editor) => {
    let finish!: (value: string) => void
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
    finish(cleanSVG)
    await rejected
    expect(editor.snapshot().text).toBe('Replacement')
  }))

test('pending authored-image import prevents exporting a document containing diagrams', () =>
  run(
    async (editor) => {
      let finish!: (value: { reference: string }) => void
      const deferred: ImageAdapter = optionsOf(editor).images!
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

const diagramSchema = new Schema({
  nodes: {
    doc: { content: 'code_block*' },
    code_block: {
      content: 'text*',
      attrs: { language: { default: 'mermaid' } },
    },
    text: {},
  },
})
const diagramDocument = (sources: string[]) =>
  diagramSchema.node(
    'doc',
    null,
    sources.map((text) =>
      diagramSchema.node(
        'code_block',
        { language: 'mermaid' },
        diagramSchema.text(text),
      ),
    ),
  )

test('exporting 100 already rendered diagrams performs no additional layout renders', async () => {
  const store = new DiagramStore()
  const sources = Array.from({ length: 100 }, source)
  store.reconcile(diagramDocument(sources))
  await Promise.all(sources.map((text) => store.render(text)))
  expect(renderer.render).toHaveBeenCalledTimes(100)
  for (const text of sources) {
    expect(await diagramImage(text, store)).toMatchObject({
      bytes: diagramBytes,
      mimeType: 'image/png',
    })
  }
  expect(renderer.render).toHaveBeenCalledTimes(100)
  store.destroy()
})

test('duplicate diagrams share geometry only within their owning document', async () => {
  const first = new DiagramStore()
  const second = new DiagramStore()
  const text = source()
  first.reconcile(diagramDocument([text, text]))
  second.reconcile(diagramDocument([text]))
  await Promise.all([
    first.render(text),
    first.render(text),
    second.render(text),
  ])
  expect(renderer.render).toHaveBeenCalledTimes(2)
  first.destroy()
  expect(await second.render(text)).toContain('<svg')
  expect(renderer.render).toHaveBeenCalledTimes(2)
  second.destroy()
})

test('reconciliation retains current diagrams and discards removed geometry', async () => {
  const store = new DiagramStore()
  const kept = source()
  const removed = source()
  store.reconcile(diagramDocument([kept, removed]))
  await Promise.all([store.render(kept), store.render(removed)])
  store.reconcile(diagramDocument([kept]))
  await store.render(kept)
  expect(renderer.render).toHaveBeenCalledTimes(2)
  store.reconcile(diagramDocument([kept, removed]))
  await store.render(removed)
  expect(renderer.render).toHaveBeenCalledTimes(3)
  store.destroy()
})

test('document replacement clears geometry even when the next source is identical', async () => {
  const store = new DiagramStore()
  const text = source()
  store.reconcile(diagramDocument([text]))
  await store.render(text)
  store.clear()
  store.reconcile(diagramDocument([text]))
  await store.render(text)
  expect(renderer.render).toHaveBeenCalledTimes(2)
  store.destroy()
})

test('a destroyed document cannot start rendering again', async () => {
  const store = new DiagramStore()
  const text = source()
  store.reconcile(diagramDocument([text]))
  await store.render(text)
  store.destroy()
  await expect(store.render(text)).rejects.toThrow()
  expect(renderer.render).toHaveBeenCalledTimes(1)
})

test('a failed document render can be retried without changing the source', async () => {
  const store = new DiagramStore()
  const text = source()
  store.reconcile(diagramDocument([text]))
  renderer.render.mockRejectedValueOnce(new Error('Temporary failure'))
  await expect(store.render(text)).rejects.toThrow('Temporary failure')
  await expect(store.render(text)).resolves.toContain('<svg')
  expect(renderer.render).toHaveBeenCalledTimes(2)
  store.destroy()
})

for (const operation of ['clear', 'destroy'] as const)
  test(`${operation} invalidates pending geometry and prevents stale reuse`, async () => {
    const store = new DiagramStore()
    const text = source()
    let finish!: (value: string) => void
    renderer.render.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    store.reconcile(diagramDocument([text]))
    const pending = store.render(text)
    const stale = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    store[operation]()
    finish(cleanSVG)
    await stale
    if (operation === 'clear') {
      store.reconcile(diagramDocument([text]))
      await store.render(text)
      expect(renderer.render).toHaveBeenCalledTimes(2)
      store.destroy()
    }
  })
