import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { withEditor } from './harness'
import { Preservation } from '../src/preserve'

for (const repeated of [false, true]) {
  for (const formatted of [false, true]) {
    test(`distant edits retain source in 1,000 ${formatted ? 'formatted' : 'plain'} ${repeated ? 'repeated' : 'distinct'} paragraphs`, async () => {
      const source =
        Array.from(
          { length: 1000 },
          (_, index) =>
            (formatted ? '__kept__ [link](/keep) ' : '') +
            (repeated ? 'A repeated paragraph.' : `Paragraph ${index}.`),
        ).join('\n\n') + '\n'
      await withEditor(source, (editor) => {
        const view = editor.ctx.get(editorViewCtx)
        const preservation = new Preservation(editor.ctx, source)
        view.dispatch(view.state.tr.insertText('First ', 1))
        const first = view.state.doc
        const firstSource = formatted
          ? source.replace('__kept__', '__First kept__')
          : 'First ' + source
        expect(preservation.serialize(first)).toBe(firstSource)
        view.dispatch(
          view.state.tr.insertText(' Last', view.state.doc.content.size - 1),
        )
        const expected = firstSource.trimEnd() + ' Last\n'
        expect(preservation.serialize(view.state.doc)).toBe(expected)
        expect(editor.ctx.get(parserCtx)(expected).eq(view.state.doc)).toBe(
          true,
        )
        expect(preservation.serialize(first)).toBe(firstSource)
      })
    })
  }
}

test('distant replacements and intervening inserted blocks retain untouched authored syntax', async () => {
  const source =
    Array.from({ length: 1000 }, (_, index) => `__Paragraph ${index}__`).join(
      '\n\n',
    ) + '\n'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preservation = new Preservation(editor.ctx, source)
    view.dispatch(view.state.tr.insertText('First ', 1))
    const paragraph = view.state.schema.nodes.paragraph!.create(
      null,
      view.state.schema.text('Inserted'),
    )
    const middle = Array.from(
      { length: 500 },
      (_, index) => view.state.doc.child(index).nodeSize,
    ).reduce((sum, size) => sum + size, 0)
    view.dispatch(view.state.tr.insert(middle, paragraph))
    view.dispatch(
      view.state.tr.insertText(' Last', view.state.doc.content.size - 1),
    )
    const saved = preservation.serialize(view.state.doc)
    expect(saved).toBe(
      source
        .replace('__Paragraph 0__', '__First Paragraph 0__')
        .replace('__Paragraph 500__', 'Inserted\n\n__Paragraph 500__')
        .replace('__Paragraph 999__', '__Paragraph 999 Last__'),
    )
  })
})

test('unmatchable large rewrites still fail within the correspondence work budget', async () => {
  const source = Array.from(
    { length: 1100 },
    (_, index) => `__Before ${index}__ [kept](/target)`,
  ).join('\n\n')
  await withEditor(source, (editor) => {
    const after = editor.ctx.get(parserCtx)(
      Array.from(
        { length: 1100 },
        (_, index) => `__After ${index}__ [kept](/target)`,
      ).join('\n\n'),
    )
    expect(() => new Preservation(editor.ctx, source).serialize(after)).toThrow(
      'too many blocks',
    )
  })
})

test('plain paragraph validation retains indentation, trailing spaces, CRLF and unsupported neighbours', async () => {
  const source =
    '__Authored__\r\n\r\n  Ordinary words  \r\n\r\n<section>__unsupported__</section>\r\n'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preservation = new Preservation(editor.ctx, source)
    view.dispatch(
      view.state.tr.insertText(
        'More ',
        view.state.doc.firstChild!.nodeSize + 1,
      ),
    )
    const saved = preservation.serialize(view.state.doc)
    expect(saved).toBe(source.replace('Ordinary', 'More Ordinary'))
    expect(editor.ctx.get(parserCtx)(saved).eq(view.state.doc)).toBe(true)
  })
})

for (const source of [
  '# EDIT __authored__\n\nBody\n',
  'EDIT __authored__\n=================\n\nBody\n',
  'EDIT _emphasis_ and `code`\n\n<section>unsupported</section>\n',
  'EDIT\n\n---\n\nFollowing\n',
  '<section>\nEDIT inside unsupported HTML\n</section>\n\nEditable EDIT\n',
  'EDIT [kept][ref]\n\n[ref]: /target\n',
  'EDIT\n\n[unresolved]\n\n[ref]: /target\n',
]) {
  test(`independent text edits agree with whole-document parsing: ${JSON.stringify(source)}`, async () => {
    await withEditor(source, (editor) => {
      const view = editor.ctx.get(editorViewCtx)
      const preservation = new Preservation(editor.ctx, source)
      let at: number | undefined
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.includes('EDIT'))
          at = pos + node.text!.lastIndexOf('EDIT') + 4
      })
      expect(at).toBeDefined()
      view.dispatch(view.state.tr.insertText('!', at!))
      const saved = preservation.serialize(view.state.doc)
      const last = source.lastIndexOf('EDIT') + 4
      expect(saved).toBe(source.slice(0, last) + '!' + source.slice(last))
      const reopened = editor.ctx.get(parserCtx)(saved)
      const normalise = (doc: typeof reopened) =>
        JSON.stringify(doc.toJSON(), (key, value) =>
          key === 'id' ? undefined : value,
        )
      expect(normalise(reopened)).toBe(normalise(view.state.doc))
    })
  })
}

test('local text validation cannot hide a newly resolved shortcut reference', async () => {
  const source = '[Old]\n\n[New]: /target\n'
  await withEditor(source, (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const preservation = new Preservation(editor.ctx, source)
    view.dispatch(view.state.tr.insertText('New', 2, 5))
    // Parsing the first block alone sees plain text; the full source would link it.
    expect(
      editor.ctx
        .get(parserCtx)('[New]')
        .firstChild!.eq(view.state.doc.firstChild!),
    ).toBe(true)
    expect(() => preservation.serialize(view.state.doc)).toThrow(
      'cannot be reopened',
    )
  })
})
