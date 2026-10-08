import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor } from '../src/editor'

async function withEditor(
  run: (editor: InkKitEditor, ctx: Ctx) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
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
  return Array.from(CSS.highlights.get('selection') ?? [], (range) =>
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
