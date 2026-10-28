import { withInputTimers } from './timing'
import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { blockDropRange } from '../src/drop-placement'
import { InkKitEditor } from '../src/editor'

async function mounted() {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error() {},
    },
    {},
  )
  const ctx = ctxOf(editor)
  return { editor, root, view: ctx.get(editorViewCtx) }
}

// The range for a point that resolves to `pos`, with `inside` the node the
// point is over, as ProseMirror's `posAtCoords` reports it.
function rangeAt(view: EditorView, pos: number, inside = -1) {
  const pointed = Object.create(view) as EditorView
  pointed.posAtCoords = () => ({ pos, inside })
  return blockDropRange(pointed, 0, 0)
}

test('dropped blocks go after the top-level block, beside a leaf or in place of an empty block', async () => {
  const { editor, root, view } = await mounted()
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: 'First words\n\n---\n\n```\ncode\n```\n\n| A |\n| - |\n| 1 |\n\n- item\n',
    })
    const positions: number[] = []
    view.state.doc.forEach((_node, offset) => positions.push(offset))
    const [paragraph, rule, code, table, list] = positions as [
      number,
      number,
      number,
      number,
      number,
    ]
    const after = (at: number) => at + view.state.doc.nodeAt(at)!.nodeSize
    // In the middle of a paragraph's text.
    expect(rangeAt(view, paragraph + 4)).toEqual({
      from: after(paragraph),
      to: after(paragraph),
    })
    // Over the rule, which is a leaf.
    expect(rangeAt(view, rule, rule)).toEqual({
      from: after(rule),
      to: after(rule),
    })
    // Inside a code block and inside a table's first cell.
    expect(rangeAt(view, code + 2)).toEqual({
      from: after(code),
      to: after(code),
    })
    expect(rangeAt(view, table + 4)).toEqual({
      from: after(table),
      to: after(table),
    })
    // Inside a list item, after the whole list.
    expect(rangeAt(view, list + 3)).toEqual({
      from: after(list),
      to: after(list),
    })
    // Between two blocks, where the drop indicator draws its line.
    expect(rangeAt(view, rule)).toEqual({ from: rule, to: rule })
  } finally {
    await editor.destroy()
    root.remove()
  }
})

test('a drop in or beside an empty paragraph replaces it', async () => {
  const { editor, root, view } = await mounted()
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: '',
    })
    const size = view.state.doc.content.size
    expect(rangeAt(view, 1)).toEqual({ from: 0, to: size })
    expect(rangeAt(view, 0)).toEqual({ from: 0, to: size })
    expect(rangeAt(view, size)).toEqual({ from: 0, to: size })
  } finally {
    await editor.destroy()
    root.remove()
  }
})

test('an empty heading or code block beside a drop is kept', async () => {
  const { editor, root, view } = await mounted()
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: '#\n\n```\n```\n',
    })
    const heading = view.state.doc.child(0)
    const code = view.state.doc.child(1)
    expect(heading.type.name).toBe('heading')
    expect(code.type.name).toBe('code_block')
    const end = heading.nodeSize
    // Inside the empty heading, and at the boundary between the two.
    expect(rangeAt(view, 1)).toEqual({ from: end, to: end })
    expect(rangeAt(view, end)).toEqual({ from: end, to: end })
    expect(rangeAt(view, end + 1)).toEqual({
      from: end + code.nodeSize,
      to: end + code.nodeSize,
    })
  } finally {
    await editor.destroy()
    root.remove()
  }
})

test('destroying the editor right after a drag ends throws nothing', async () => {
  const { editor, root, view } = await mounted()
  await withInputTimers(async () => {
    view.dom.dispatchEvent(new Event('dragleave'))
    await editor.destroy()
    root.remove()
  })
})
