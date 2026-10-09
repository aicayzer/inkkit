import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { closeHistory, undo } from '@milkdown/kit/prose/history'
import { InkKitEditor } from '../src/index'

const renderer = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: renderer }))
const originalURL = URL

beforeEach(() => {
  renderer.render.mockResolvedValue({
    svg: '<svg viewBox="0 0 100 50"><text>Diagram</text></svg>',
  })
  vi.stubGlobal(
    'URL',
    class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:diagram-review')
      static revokeObjectURL = vi.fn()
    },
  )
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect() {},
    drawImage() {},
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
  callback: (editor: InkKitEditor, ctx: Ctx) => Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
  })
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await callback(editor, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const input = { documentId: 'review', generation: 1, format: 'md' as const }

test('rich copy preserves distinct authored fences for duplicate diagrams', () =>
  run(async (editor) => {
    const diagram = 'flowchart LR\nDuplicate --> B'
    const first = `~~~~mermaid  \n${diagram}\n~~~~~~  \n`
    const second = `\x60\x60\x60mermaid\n${diagram}\n\x60\x60\x60\n`
    editor.loadDocument({ ...input, text: first + '\n' + second })
    const clip = await editor.clipboardSnapshot()
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    expect(editor.snapshot().text).toBe(first + '\n' + second)
  }))

test('invalid diagram rich paste retains its authored fence without inserting export warnings', () =>
  run(async (editor) => {
    const authored = '~~~~mermaid  \r\nmindmap\r\nRoot\r\n~~~~~~  \r\n'
    editor.loadDocument({ ...input, text: authored })
    const clip = await editor.clipboardSnapshot()
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    expect(editor.snapshot().text).toBe(authored)
  }))

test('rich roundtrip retains fences within an authored blockquote', () =>
  run(async (editor) => {
    const authored =
      '> ~~~~mermaid  \n> flowchart LR\n> Quoted --> B\n> ~~~~~~  \n'
    editor.loadDocument({ ...input, text: authored })
    const clip = await editor.clipboardSnapshot()
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    expect(editor.snapshot().text).toBe(authored)
  }))

test('rich roundtrip retains CRLF fences within an authored blockquote', () =>
  run(async (editor) => {
    const authored =
      '> ~~~~mermaid  \r\n> flowchart LR\r\n> QuotedCRLF --> B\r\n> ~~~~~~  \r\n'
    editor.loadDocument({ ...input, text: authored })
    const clip = await editor.clipboardSnapshot()
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    expect(editor.snapshot().text).toBe(authored)
  }))

test('editing and undo preserve fences on distinct duplicate diagram occurrences', () =>
  run(async (editor, ctx) => {
    const diagram = 'flowchart LR\nDuplicateEdited --> B'
    const first = `~~~~mermaid  \n${diagram}\n~~~~~~  \n`
    const second = `\x60\x60\x60mermaid\n${diagram}\n\x60\x60\x60\n`
    const authored = first + '\n' + second
    editor.loadDocument({ ...input, text: authored })
    const clip = await editor.clipboardSnapshot()
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    const view = ctx.get(editorViewCtx)
    view.dispatch(closeHistory(view.state.tr))
    const start =
      view.state.doc.firstChild!.nodeSize +
      1 +
      diagram.indexOf('DuplicateEdited')
    view.dispatch(view.state.tr.insertText('Changed', start, start + 15))
    expect(editor.snapshot().text).toBe(
      first + '\n' + second.replace('DuplicateEdited', 'Changed'),
    )
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(authored)
  }))

test('rich roundtrip retains opaque diagram source with Unicode and BOM', () =>
  run(async (editor) => {
    const authored =
      '\uFEFF~~~~mermaid  \r\nflowchart LR\r\nA[こんにちは] --> B[Éclair]\r\n~~~~~~  \r\n'
    editor.loadDocument({ ...input, text: authored })
    const clip = await editor.clipboardSnapshot()
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: clip.text, html: clip.html })
    expect(editor.snapshot().text).toBe(authored.slice(1))
  }))

test('incoming code provenance does not change an existing paragraph after undo and editing', () =>
  run(async (editor, ctx) => {
    const authored = '__Before__\n\n_After_\n'
    editor.loadDocument({ ...input, text: authored })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, view.state.doc.content.size - 1),
      ),
    )
    await editor.paste({
      text: '',
      markdown: '~~~~mermaid\nflowchart LR\nIncoming --> B\n~~~~\n',
    })
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(authored)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.content.size - 1),
    )
    expect(editor.snapshot().text).toBe('__Before__\n\n_After!_\n')
  }))

test('the equivalent ordinary paragraph edit preserves its authored emphasis', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: '__Before__\n\n_After_\n' })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.content.size - 1),
    )
    expect(editor.snapshot().text).toBe('__Before__\n\n_After!_\n')
  }))

test('pasted diagram retains its authored fence after editing and undo', () =>
  run(async (editor, ctx) => {
    const authored =
      '~~~~mermaid  \r\nflowchart LR\r\nPasted --> B\r\n~~~~~~  \r\n'
    editor.loadDocument({ ...input, text: '' })
    await editor.paste({ text: '', markdown: authored })
    expect(editor.snapshot().text).toBe(authored)
    const view = ctx.get(editorViewCtx)
    view.dispatch(closeHistory(view.state.tr))
    const from = 1 + view.state.doc.firstChild!.textContent.indexOf('Pasted')
    view.dispatch(view.state.tr.insertText('Edited', from, from + 6))
    expect(editor.snapshot().text).toBe(authored.replace('Pasted', 'Edited'))
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(authored)
  }))
