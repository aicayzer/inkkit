import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { InkKitEditor, InkKitError } from '../src/core'
import { renderDiagram } from '../src/mermaid'

// Each test file has its own module graph, so nothing here registers Mermaid.
const loaded = vi.hoisted(() => ({ count: 0 }))
vi.mock('mermaid', () => {
  loaded.count++
  return { default: {} }
})

const diagram = 'flowchart LR\nA --> B'
const text = `Before\n\n~~~mermaid\n${diagram}\n~~~\n\nAfter\n`
const input = { documentId: 'core', generation: 1, format: 'md' as const }

async function run(
  callback: (editor: InkKitEditor, root: HTMLElement, ctx: Ctx) => unknown,
  errors: Error[] = [],
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    },
    { rendering: { diagramPreview: true } },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    editor.loadDocument({ ...input, text })
    await callback(editor, root, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

test('the core entry renders no diagram and never loads Mermaid', async () => {
  await expect(renderDiagram(diagram)).rejects.toThrow(
    'Diagram rendering is not included in this build. The source is retained.',
  )
  expect(loaded.count).toBe(0)
})

test('diagram source stays editable and preserved without previews or errors', async () => {
  const errors: Error[] = []
  await run(async (editor, root, ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(root.querySelector('.inkkit-mermaid-preview')).toBeNull()
    const code = root.querySelector('pre code')!.cloneNode(true) as HTMLElement
    code.querySelector('.inkkit-code-controls')?.remove()
    expect(code.textContent).toBe(diagram)
    expect(editor.snapshot().text).toBe(text)
    const view = ctx.get(editorViewCtx)
    let end = 0
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block') end = pos + node.nodeSize - 1
    })
    view.dispatch(view.state.tr.insertText('\nB --> C', end))
    expect(editor.snapshot().text).toBe(
      `Before\n\n~~~mermaid\n${diagram}\nB --> C\n~~~\n\nAfter\n`,
    )
    editor.undo()
    expect(editor.snapshot().text).toBe(text)
  }, errors)
  expect(errors).toEqual([])
  expect(loaded.count).toBe(0)
})

test('copy keeps readable diagram source and reports why it is unavailable', async () => {
  const errors: Error[] = []
  await run(async (editor) => {
    const clip = await editor.clipboardSnapshot()
    expect(clip.diagrams).toEqual([
      {
        source: diagram,
        error:
          'Diagram rendering is not included in this build. The source is retained.',
      },
    ])
    expect(clip.html).toContain('Diagram unavailable:')
    expect(
      new DOMParser()
        .parseFromString(clip.html, 'text/html')
        .querySelector('code')?.textContent,
    ).toBe(diagram)
    expect(clip.images).toEqual([])
    expect(clip.text).toBe(`Before\n\n${diagram}\n\nAfter`)
    expect(loaded.count).toBe(0)
  }, errors)
  // The host left diagrams out, so a missing rendering is not an error.
  expect(errors).toEqual([])
})

test('print keeps readable diagram source with a diagram-unavailable warning', () =>
  run(async (editor) => {
    const printed = await editor.printableSnapshot()
    expect(printed.warnings).toEqual([
      {
        code: 'diagram-unavailable',
        message:
          'Diagram rendering is not included in this build. The source is retained. The source is printed below.',
      },
    ])
    const html = new DOMParser().parseFromString(printed.html, 'text/html')
    expect(html.querySelector('pre code')?.textContent).toBe(diagram)
    expect(html.querySelector('img')).toBeNull()
    expect(loaded.count).toBe(0)
  }))

test('the core entry exports the same public names as the package entry', async () => {
  const core = await import('../src/core')
  expect(core.InkKitEditor).toBe(InkKitEditor)
  expect(core.InkKitError).toBe(InkKitError)
  const main = await import('../src/index')
  expect(Object.keys(main).sort()).toEqual(Object.keys(core).sort())
})
