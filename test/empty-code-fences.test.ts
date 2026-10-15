import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { InkKitEditor } from '../src/index'

const input = { documentId: 'fences', format: 'md' as const }

async function withNote(
  run: (editor: InkKitEditor, ctx: Ctx, errors: Error[]) => unknown,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    await run(
      editor,
      (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx,
      errors,
    )
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const codeBlocks = (ctx: Ctx) => {
  const blocks: string[] = []
  ctx.get(editorViewCtx).state.doc.descendants((node) => {
    if (node.type.name === 'code_block') blocks.push(node.textContent)
  })
  return blocks
}

const empty: [string, string][] = [
  ['a backtick fence', '```\n```\n'],
  ['a fence with an info string', '```js\n```\n'],
  ['a tilde fence', '~~~\n~~~\n'],
  ['a tilde fence with an info string', '~~~ python\n~~~\n'],
  ['a longer fence', '````\n````\n'],
  ['a fence with carriage returns', '```js\r\n```\r\n'],
  ['a fence between paragraphs', 'Before\n\n```\n```\n\nAfter\n'],
  ['an unclosed fence', '```\n'],
  ['a fence in a list item', '- Item\n\n  ```\n  ```\n'],
  ['a fence holding a blank line', '```\n\n```\n'],
]

for (const [name, source] of empty)
  test(`a note with ${name} that is empty opens and saves unchanged`, () =>
    withNote((editor, ctx, errors) => {
      editor.loadDocument({ ...input, generation: 1, text: source })
      expect(codeBlocks(ctx)).toEqual([''])
      expect(editor.snapshot().text).toBe(source)
      expect(errors).toEqual([])
    }))

for (const [name, source, cleared] of [
  ['a backtick fence', '```js\nconst a = 1\n```\n', '```js\n```\n'],
  ['a tilde fence', '~~~\nline one\nline two\n~~~\n', '~~~\n~~~\n'],
  [
    'a fence with carriage returns',
    '```js\r\nconst a = 1\r\n```\r\n',
    '```js\r\n```\r\n',
  ],
  [
    'a fence between paragraphs',
    'Before\n\n```\ncode\n```\n\nAfter\n',
    'Before\n\n```\n```\n\nAfter\n',
  ],
] as [string, string, string][])
  test(`clearing the code in ${name} saves an empty code block`, () =>
    withNote((editor, ctx, errors) => {
      editor.loadDocument({ ...input, generation: 1, text: source })
      const view = ctx.get(editorViewCtx)
      let from = 0,
        to = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block') {
          from = pos + 1
          to = pos + node.nodeSize - 1
        }
      })
      view.dispatch(view.state.tr.delete(from, to))
      expect(errors).toEqual([])
      expect(codeBlocks(ctx)).toEqual([''])
      const saved = editor.snapshot().text
      expect(saved).toBe(cleared)
      editor.undo()
      expect(editor.snapshot().text).toBe(source)
      editor.loadDocument({ ...input, generation: 2, text: saved })
      expect(codeBlocks(ctx)).toEqual([''])
      expect(editor.snapshot().text).toBe(saved)
      expect(errors).toEqual([])
    }))

for (const [name, source, typed] of [
  ['a fence', '```js\n```\n', '```js\nx\n```\n'],
  ['a tilde fence', '~~~\r\n~~~\r\n', '~~~\r\nx\r\n~~~\r\n'],
  [
    'a fence in a list item',
    '- Item\n\n  ```\n  ```\n',
    '- Item\n\n  ```\n  x\n  ```\n',
  ],
] as [string, string, string][])
  test(`typing into an empty code block in ${name} saves the code inside the fence`, () =>
    withNote((editor, ctx, errors) => {
      editor.loadDocument({ ...input, generation: 1, text: source })
      const view = ctx.get(editorViewCtx)
      let at = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block') at = pos + 1
      })
      view.dispatch(view.state.tr.insertText('x', at))
      expect(errors).toEqual([])
      expect(editor.snapshot().text).toBe(typed)
      editor.undo()
      expect(editor.snapshot().text).toBe(source)
    }))

test('clearing then typing into a list item whose code starts with a blank line keeps the code inside the fence', () =>
  withNote((editor, ctx, errors) => {
    editor.loadDocument({
      ...input,
      generation: 1,
      text: '- Item\n\n  ```\n\n  code\n  ```\n',
    })
    const view = ctx.get(editorViewCtx)
    let from = 0,
      to = 0
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block') {
        from = pos + 1
        to = pos + node.nodeSize - 1
      }
    })
    view.dispatch(view.state.tr.delete(from, to))
    view.dispatch(view.state.tr.insertText('x', from))
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe('- Item\n\n  ```\n  x\n  ```\n')
  }))

test('clearing an unclosed fence keeps its line ending', () =>
  withNote((editor, ctx, errors) => {
    editor.loadDocument({
      ...input,
      generation: 1,
      text: 'Before\n\n```\ncode\n',
    })
    const view = ctx.get(editorViewCtx)
    let from = 0,
      to = 0
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block') {
        from = pos + 1
        to = pos + node.nodeSize - 1
      }
    })
    view.dispatch(view.state.tr.delete(from, to))
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe('Before\n\n```\n')
  }))

test('editing beside an empty code block in a list item keeps the fence', () =>
  withNote((editor, ctx, errors) => {
    const source = '- Item\n\n  ```\n  ```\n'
    editor.loadDocument({ ...input, generation: 1, text: source })
    const view = ctx.get(editorViewCtx)
    let at = 0
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'Item')
        at = pos + 5
    })
    view.dispatch(view.state.tr.insertText('s', at))
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe('- Items\n\n  ```\n  ```\n')
  }))
