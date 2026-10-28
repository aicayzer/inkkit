import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { InkKitEditor } from '../src/index'

// Counts the Markdown serializations that `action` makes.
function serializations(ctx: Ctx, action: () => void): number {
  const serializer = ctx.get(serializerCtx)
  let count = 0
  ctx.set(serializerCtx, (doc) => {
    count++
    return serializer(doc)
  })
  try {
    action()
  } finally {
    ctx.set(serializerCtx, serializer)
  }
  return count
}

async function run(callback: (editor: InkKitEditor, ctx: Ctx) => void) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    { changed() {}, copy() {}, openLink() {} },
    {},
  )
  const ctx = ctxOf(editor)
  try {
    callback(editor, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = { documentId: 'unedited', generation: 1, format: 'md' as const }

test('an unedited document with headings saves as loaded without serializing', () =>
  run((editor, ctx) => {
    const source =
      'Title\n=====\n\n# One #\n\n- ## Two\n\n> ### Three\n\nText *spelled* __so__.\r\n'
    editor.loadDocument({ ...input, text: source })
    let text = ''
    expect(serializations(ctx, () => (text = editor.snapshot().text))).toBe(0)
    expect(text).toBe(source)
  }))

test('an edit undone to the loaded document saves as loaded without serializing', () =>
  run((editor, ctx) => {
    const source = '# One\n\nText\n'
    editor.loadDocument({ ...input, text: source })
    editor.insertText('!', input.generation)
    expect(editor.snapshot().text).not.toBe(source)
    editor.undo()
    let text = ''
    expect(serializations(ctx, () => (text = editor.snapshot().text))).toBe(0)
    expect(text).toBe(source)
    expect(ctx.get(editorViewCtx).state.doc.firstChild?.type.name).toBe(
      'heading',
    )
  }))
