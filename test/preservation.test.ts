import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { withEditor } from './harness'
import { Preservation, PreservationError } from '../src/preserve'

const sources = [
  '__bold__\n\nEDIT',
  '\uFEFF__bold__\r\n\r\nEDIT\r\n',
  '---\ntitle: draft\n---\n\nEDIT\n',
  '+++\ntitle = "draft"\n+++\nBody directly after metadata\n\nEDIT\n',
  '[A][ref]\n\n[ref]: https://example.com "Title"\n\nEDIT\n',
  '<section>Keep **this**</section>\n\nEDIT\n',
  '![Image](images/local.png)\n\nEDIT\n',
  '* First\n* Second\n\n\n\nEDIT\n',
  '    code\n\nEDIT\n',
  '| A | B |\n| :--- | ---: |\n| café | **value** |\n\nEDIT\n',
  'Note[^ref]\n\n[^ref]: Keep this\n\nEDIT\n',
  'One\n\n<br />\n\nEDIT\n',
]
for (const source of sources) {
  test(`preserves untouched source beside an edit: ${JSON.stringify(source)}`, async () => {
    await withEditor(source, (editor) => {
      const view = editor.ctx.get(editorViewCtx)
      const preservation = new Preservation(editor.ctx, source)
      expect(preservation.serialize(view.state.doc)).toBe(source)
      view.dispatch(
        view.state.tr.insertText('!', view.state.doc.content.size - 1),
      )
      const result = preservation.serialize(view.state.doc)
      expect(result).toBe(source.replace('EDIT', 'EDIT!'))
      expect(editor.ctx.get(parserCtx)(result).eq(view.state.doc)).toBe(true)
    })
  })
}

test('undo restores original bytes and an inserted block preserves previous source', async () => {
  const source = '__bold__\n\n_last_'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preservation = new Preservation(editor.ctx, source)
    const original = view.state.doc
    const paragraph = view.state.schema.nodes.paragraph!.create(
      null,
      view.state.schema.text('New'),
    )
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph))
    expect(preservation.serialize(view.state.doc)).toBe(source + '\n\nNew\n')
    expect(preservation.serialize(original)).toBe(source)
  })
})

test('deleting a block does not alter identical neighbours', async () => {
  const source = '__same__\n\nREMOVE\n\n__same__\n'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preservation = new Preservation(editor.ctx, source)
    const from = view.state.doc.firstChild!.nodeSize
    view.dispatch(
      view.state.tr.delete(from, from + view.state.doc.child(1).nodeSize),
    )
    expect(preservation.serialize(view.state.doc)).toBe(
      '__same__\n\n__same__\n',
    )
  })
})

test('clearing a document produces empty Markdown and preserves a BOM', async () => {
  for (const source of ['Text\n', '\uFEFFText\r\n']) {
    await withEditor(source, (editor) => {
      const empty = editor.ctx.get(parserCtx)('')
      expect(new Preservation(editor.ctx, source).serialize(empty)).toBe(
        source.startsWith('\uFEFF') ? '\uFEFF' : '',
      )
    })
  }
})

test('unsafe adjacent list reconstruction fails without rewriting untouched blocks', async () => {
  await withEditor('- One\n\nBetween\n\n- Two\n', (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preservation = new Preservation(
      editor.ctx,
      '- One\n\nBetween\n\n- Two\n',
    )
    const start = view.state.doc.firstChild!.nodeSize
    view.dispatch(
      view.state.tr.delete(start, start + view.state.doc.child(1).nodeSize),
    )
    expect(() => preservation.serialize(view.state.doc)).toThrow(
      PreservationError,
    )
    expect(view.state.doc.childCount).toBe(2)
  })
})
