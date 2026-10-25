import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor } from '../src/editor'
import { setSelectionWindowActive } from '../src/selection'

async function withEditor(
  run: (editor: InkKitEditor, ctx: Ctx) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    openLink() {},
    copy() {},
  })
  try {
    await run(
      editor,
      (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx,
    )
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function paintedText(): string[] {
  return Array.from(CSS.highlights.get('inkkit-selection') ?? [], (range) =>
    (range as Range).toString(),
  )
}

test('partial selection paints its text without modifying native selection or source', async () => {
  await withEditor((editor, ctx) => {
    const source = 'First **bold** line\n\nSecond line'
    editor.loadDocument({
      documentId: 'test',
      format: 'md',
      text: source,
      generation: 1,
    })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 9)),
    )
    const selection = view.state.selection.toJSON()
    expect(paintedText()).toEqual(['rst bo'])
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(editor.snapshot().dirty).toBe(false)

    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    )
    expect(paintedText()).toEqual([])
  })
})

test('whole-document selection splits highlights across paragraphs, lists and code', async () => {
  await withEditor(async (editor, ctx) => {
    editor.loadDocument({
      documentId: 'test',
      format: 'md',
      text: 'First\nsoft **bold** line\n\nSecond paragraph\n\n- List one\n- List two\n\n```txt\ncode one\ncode two\n```',
      generation: 1,
    })
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    expect(paintedText()).toEqual([
      'Firstsoft bold line',
      'Second paragraph',
      'List one',
      'List two',
      'code one\ncode two',
    ])
    expect((await editor.clipboardSnapshot()).text).toContain(
      'First\nsoft bold line',
    )
    expect(editor.snapshot().dirty).toBe(false)
  })
})

test('separate editors retain their highlights when either selection updates or is destroyed', async () => {
  await withEditor(async (one, firstCtx) => {
    one.loadDocument({
      documentId: 'one',
      format: 'md',
      text: 'First',
      generation: 1,
    })
    const first = firstCtx.get(editorViewCtx)
    first.dispatch(
      first.state.tr.setSelection(TextSelection.create(first.state.doc, 1, 6)),
    )
    await withEditor((two, secondCtx) => {
      two.loadDocument({
        documentId: 'two',
        format: 'md',
        text: 'Second',
        generation: 1,
      })
      const second = secondCtx.get(editorViewCtx)
      second.dispatch(
        second.state.tr.setSelection(
          TextSelection.create(second.state.doc, 1, 7),
        ),
      )
      expect(paintedText()).toEqual(['First', 'Second'])
      first.dispatch(
        first.state.tr.setSelection(
          TextSelection.create(first.state.doc, 1, 3),
        ),
      )
      expect(paintedText()).toEqual(['Fi', 'Second'])
    })
    expect(paintedText()).toEqual(['Fi'])
  })
  expect(CSS.highlights.has('inkkit-selection')).toBe(false)
})

test('host and browser activity gate presentation without changing document state', async () => {
  await withEditor((editor, ctx) => {
    const view = ctx.get(editorViewCtx)
    const root = view.dom.closest<HTMLElement>('.inkkit-root')!
    setSelectionWindowActive(root, false)
    editor.loadDocument({
      documentId: 'focus',
      generation: 1,
      format: 'md',
      text: 'café 😀\r\n\r\nsecond',
    })
    view.focus()
    window.dispatchEvent(new Event('focus'))
    expect(root.classList.contains('inkkit-selection-active')).toBe(false)
    const before = editor.snapshot()
    setSelectionWindowActive(root, true)
    expect(root.classList.contains('inkkit-selection-active')).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(root.classList.contains('inkkit-selection-active')).toBe(false)
    setSelectionWindowActive(root, true)
    expect(root.classList.contains('inkkit-selection-active')).toBe(false)
    window.dispatchEvent(new Event('focus'))
    expect(root.classList.contains('inkkit-selection-active')).toBe(true)
    editor.setEditable(false)
    expect(root.classList.contains('inkkit-selection-active')).toBe(true)
    expect(editor.snapshot()).toEqual(before)
  })
})

test('engines without Custom Highlight retain native selection and focus tracking', async () => {
  const highlight = globalThis.Highlight
  Object.defineProperty(globalThis, 'Highlight', {
    configurable: true,
    writable: true,
    value: undefined,
  })
  try {
    await withEditor((editor, ctx) => {
      editor.loadDocument({
        documentId: 'fallback',
        generation: 1,
        format: 'txt',
        text: 'literal\r\ntext 😀',
      })
      const view = ctx.get(editorViewCtx)
      const root = view.dom.closest<HTMLElement>('.inkkit-root')!
      const plain = root.querySelector('textarea')!
      plain.focus()
      window.dispatchEvent(new Event('focus'))
      plain.setSelectionRange(0, 7)
      expect(view.dom.classList.contains('inkkit-painted-selection')).toBe(
        false,
      )
      expect(root.classList.contains('inkkit-selection-active')).toBe(true)
      window.dispatchEvent(new Event('blur'))
      expect(root.classList.contains('inkkit-selection-active')).toBe(false)
      expect(plain.selectionStart).toBe(0)
      expect(plain.selectionEnd).toBe(7)
      expect(editor.snapshot().dirty).toBe(false)
    })
  } finally {
    Object.defineProperty(globalThis, 'Highlight', {
      configurable: true,
      writable: true,
      value: highlight,
    })
  }
})
