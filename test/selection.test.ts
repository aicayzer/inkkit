import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/editor'

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

const lines = (...values: string[]) => values.join('\n\n')

/** Mounts two editors, the second after the first, and an outside paragraph and field. */
async function withPage(
  run: (page: {
    one: InkKitEditor
    two: InkKitEditor
    first: EditorView
    second: EditorView
    outside: HTMLElement
    field: HTMLInputElement
  }) => void | Promise<void>,
) {
  const outside = document.createElement('p')
  outside.textContent = 'Outside text'
  const field = document.createElement('input')
  document.body.append(outside, field)
  try {
    await withEditor(async (one, firstCtx) => {
      one.loadDocument({
        documentId: 'one',
        format: 'md',
        text: lines('First paragraph', 'More of the first'),
        generation: 1,
      })
      await withEditor(async (two, secondCtx) => {
        two.loadDocument({
          documentId: 'two',
          format: 'md',
          text: 'Second paragraph',
          generation: 1,
        })
        // jsdom has no focused window until one says so.
        window.dispatchEvent(new Event('focus'))
        await run({
          one,
          two,
          first: firstCtx.get(editorViewCtx),
          second: secondCtx.get(editorViewCtx),
          outside,
          field,
        })
      })
    })
  } finally {
    outside.remove()
    field.remove()
  }
}

const select = (view: EditorView, from: number, to: number) =>
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
  )
const rootOf = (view: EditorView) => view.dom.closest('.inkkit-root')!
const active = (view: EditorView) =>
  rootOf(view).classList.contains('inkkit-selection-active')
/** What a user does by dragging across text outside the editors. */
function selectOutside(node: Node, collapsed = false) {
  const range = document.createRange()
  range.selectNodeContents(node)
  if (collapsed) range.collapse(true)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

test('only the editor that last took a selection paints, and destroying it clears the page', async () => {
  await withPage(({ first, second }) => {
    select(first, 1, 6)
    expect(paintedText()).toEqual(['First'])
    select(second, 1, 7)
    expect(paintedText()).toEqual(['Second'])
    select(first, 1, 3)
    expect(paintedText()).toEqual(['Fi'])
    select(second, 1, 4)
    expect(paintedText()).toEqual(['Sec'])
  })
  expect(CSS.highlights.has('inkkit-selection')).toBe(false)
})

test('a view whose document changes does not take the selection from the focused editor', async () => {
  await withPage(({ one, two, first, second }) => {
    one.focus()
    select(first, 1, 6)
    expect(active(first)).toBe(true)
    // A background editor given a selection, as a host sync does, leaves the focused one in charge.
    two.loadDocument({
      documentId: 'two',
      format: 'md',
      text: 'Reloaded',
      generation: 2,
    })
    select(second, 1, 4)
    expect(paintedText()).toEqual(['First'])
  })
})

test('focus and window activity choose the active colour without changing the document', async () => {
  await withPage(({ one, two, first, second, field }) => {
    one.focus()
    select(first, 1, 6)
    const before = one.snapshot()
    expect(active(first)).toBe(true)
    expect(active(second)).toBe(false)
    window.dispatchEvent(new Event('blur'))
    expect(active(first)).toBe(false)
    expect(paintedText()).toEqual(['First'])
    window.dispatchEvent(new Event('focus'))
    expect(active(first)).toBe(true)
    field.focus()
    expect(active(first)).toBe(false)
    two.focus()
    expect(active(first)).toBe(false)
    expect(active(second)).toBe(true)
    expect(one.snapshot()).toEqual(before)
  })
})

test('a selection kept while focus is in a host field stays until a selection is made elsewhere', async () => {
  await withPage(({ one, first, field, outside }) => {
    one.focus()
    select(first, 1, 6)
    field.focus()
    // Focusing a field moves the document selection into it without selecting anything.
    selectOutside(field.parentElement!, true)
    expect(active(first)).toBe(false)
    expect(paintedText()).toEqual(['First'])
    selectOutside(outside)
    expect(paintedText()).toEqual([])
    one.focus()
    select(first, 1, 6)
    expect(paintedText()).toEqual(['First'])
    expect(active(first)).toBe(true)
  })
})

test('a read-only editor, which takes no focus, paints the selection the user makes in it as active', async () => {
  await withPage(({ one, first }) => {
    one.setEditable(false)
    select(first, 1, 6)
    const range = document.createRange()
    range.setStart(first.dom.querySelector('p')!.firstChild!, 0)
    range.setEnd(first.dom.querySelector('p')!.firstChild!, 5)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    select(first, 1, 6)
    expect(paintedText()).toEqual(['First'])
    expect(active(first)).toBe(true)
  })
})

test('a click on page text clears a selection the editor no longer holds', async () => {
  await withPage(({ one, first, outside }) => {
    one.focus()
    select(first, 1, 6)
    outside.setAttribute('tabindex', '-1')
    outside.focus()
    selectOutside(outside, true)
    expect(paintedText()).toEqual([])
  })
})

test('a host blur keeps the selection in the inactive colour until something else is selected', async () => {
  await withPage(({ one, first, outside }) => {
    one.focus()
    select(first, 1, 6)
    const before = one.snapshot()
    // The window resigns: the host blurs the editor, which also empties the document selection.
    one.blur()
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new Event('selectionchange'))
    expect(document.getSelection()!.rangeCount).toBe(0)
    expect(first.state.selection.empty).toBe(false)
    expect(active(first)).toBe(false)
    expect(paintedText()).toEqual(['First'])
    expect(one.snapshot()).toEqual(before)
    // The user returns and selects text outside the editors.
    window.dispatchEvent(new Event('focus'))
    expect(paintedText()).toEqual(['First'])
    selectOutside(outside)
    expect(paintedText()).toEqual([])
    expect(first.state.selection.empty).toBe(false)
    // Focusing the editor again shows the kept selection as active.
    one.focus()
    select(first, 1, 6)
    expect(active(first)).toBe(true)
    expect(paintedText()).toEqual(['First'])
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
