import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
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

// Literal blocks hold their authored line endings, unlike the canonical source
// that edited blocks are rebuilt from.
for (const source of [
  '---\r\ntitle: EDIT\r\n---\r\n\r\nBody\r\n',
  '<div>\r\nEDIT\r\n</div>\r\n\r\nBody\r\n',
  'Unresolved [x][missing] EDIT\r\nnext\r\n\r\nBody\r\n',
])
  test(`typing in a CRLF literal block keeps CRLF: ${JSON.stringify(source)}`, () =>
    withEditor(source, (editor) => {
      const view = editor.ctx.get(editorViewCtx)
      const preservation = new Preservation(editor.ctx, source)
      let at = -1
      view.state.doc.descendants((node, position) => {
        if (at < 0 && node.text?.includes('EDIT'))
          at = position + node.text.indexOf('EDIT') + 'EDIT'.length
      })
      view.dispatch(view.state.tr.insertText('!', at))
      expect(preservation.serialize(view.state.doc)).toBe(
        source.replace('EDIT', 'EDIT!'),
      )
      view.dispatch(view.state.tr.insertText('\nmore', at + 1))
      expect(preservation.serialize(view.state.doc)).toBe(
        source.replace('EDIT', 'EDIT!\r\nmore'),
      )
    }))

test('a rule inserted at the start of a document with a later --- line does not read back as front matter', () =>
  withEditor('Intro\n\nTitle\n---\n', (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preservation = new Preservation(editor.ctx, 'Intro\n\nTitle\n---\n')
    view.dispatch(view.state.tr.insert(0, view.state.schema.nodes.hr!.create()))
    const result = preservation.serialize(view.state.doc)
    expect(result).toBe('***\n\nIntro\n\nTitle\n---\n')
    const types = (doc: ProseNode) => doc.children.map((node) => node.type.name)
    expect(types(editor.ctx.get(parserCtx)(result))).toEqual(
      types(view.state.doc),
    )
  }))

test('an authored --- rule that comes to open the document with a later --- line is written as ***', () =>
  withEditor('x\n', (editor) => {
    const parse = editor.ctx.get(parserCtx)
    const save = (before: string, after: string) => {
      const result = new Preservation(editor.ctx, before).serialize(
        parse(after),
      )
      const types = (doc: ProseNode) =>
        doc.children.map((node) => node.type.name)
      expect(types(parse(result))).toEqual(types(parse(after)))
      return result
    }
    // Deleting the first block moves the rule to the start.
    expect(
      save(
        'Intro\n\n---\n\nPara\n\n---\n\nEnd\n',
        '***\n\nPara\n\n---\n\nEnd\n',
      ),
    ).toBe('***\n\nPara\n\n---\n\nEnd\n')
    // A rule added at the end closes what would read as front matter.
    expect(save('---\n\nPara __b__\n', '***\n\nPara __b__\n\n***\n')).toBe(
      '***\n\nPara __b__\n\n---\n',
    )
    // Without a later --- line, the authored rule keeps its bytes.
    expect(save('---\n\nPara __b__\n', '***\n\nPara __b__ edited\n')).toBe(
      '---\n\nPara __b__ edited\n',
    )
  }))

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
