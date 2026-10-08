import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { serialize } from '../src/dialect'
import {
  footnoteDefinitions,
  normaliseLabel,
  referenceDefinitions,
} from '../src/references'
import { withEditor } from './harness'

test('reference styles and shared definitions remain authored references', async () => {
  const source =
    '[Full][MiXeD] and [Mixed][] and [Mixed]\n\n[MiXeD]: https://example.com "Title"\n\n[unused]: /keep\n'
  await withEditor(source, (editor) => {
    const { doc } = editor.ctx.get(editorViewCtx).state
    const marks: string[] = []
    doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type.name === 'link') {
          marks.push(mark.attrs.referenceType)
          expect(mark.attrs.href).toBe('https://example.com')
        }
      }
    })
    expect(marks).toEqual(['full', 'collapsed', 'shortcut'])
    expect(referenceDefinitions(doc).size).toBe(2)
    expect(serialize(editor.ctx)).toBe(source)
  })
})

test('footnotes retain repeated references and editable multi-block definitions', async () => {
  const source =
    'Note[^MiXeD] and again[^mixed].\n\n[^MiXeD]: **First**\n\n    Second paragraph.\n'
  await withEditor(source, (editor) => {
    const { doc } = editor.ctx.get(editorViewCtx).state
    expect(doc.firstChild?.child(1).type.name).toBe('footnote_reference')
    const definition = footnoteDefinitions(doc).get('mixed')!.node
    expect(definition.childCount).toBe(2)
    expect(definition.attrs.label).toBe('MiXeD')
    const markdown = serialize(editor.ctx)
    expect(markdown).toContain('[^MiXeD]')
    expect(editor.ctx.get(parserCtx)(markdown).eq(doc)).toBe(true)
  })
})

test('definition edits refresh all resolved links and implicit text edits keep their target', async () => {
  await withEditor('[Label][] and [Label]\n\n[Label]: /old\n', (editor) => {
    const view = editor.ctx.get(editorViewCtx)
    const definition = referenceDefinitions(view.state.doc).get('label')!
    view.dispatch(
      view.state.tr.setNodeMarkup(definition.pos, undefined, {
        ...definition.node.attrs,
        url: '/new',
      }),
    )
    const hrefs: string[] = []
    view.state.doc.descendants((node) => {
      for (const mark of node.marks)
        if (mark.type.name === 'link') hrefs.push(mark.attrs.href)
    })
    expect(hrefs).toEqual(['/new', '/new'])
    view.dispatch(view.state.tr.insertText('Changed', 1, 6))
    expect(serialize(editor.ctx)).toContain('[Changed][Label]')
  })
})

test('unresolved and escaped references and code stay source-safe', async () => {
  await withEditor(
    'Unresolved[^missing]\n\n[Text][missing]\n\n`[^missing]`\n\n\\[literal]\n',
    (editor) => {
      const { doc } = editor.ctx.get(editorViewCtx).state
      expect(doc.child(0).type.name).toBe('literal_markdown')
      expect(doc.child(1).type.name).toBe('literal_markdown')
      expect(doc.child(2).type.name).toBe('paragraph')
      expect(doc.child(3).type.name).toBe('paragraph')
    },
  )
  expect(normaliseLabel(' Mixed\n Label ')).toBe('mixed label')
})

test('unsupported and unresolved footnote body blocks retain the editable definition wrapper', async () => {
  const source =
    'Text[^note]\n\n[^note]: Editable first paragraph.\n\n    <section>Raw HTML\n    second line</section>\n\n    Unresolved [Text][missing].\n'
  await withEditor(source, (editor) => {
    const { doc } = editor.ctx.get(editorViewCtx).state
    const definition = footnoteDefinitions(doc).get('note')!.node
    expect(definition.childCount).toBe(3)
    expect(definition.child(0).type.name).toBe('paragraph')
    expect(definition.child(1).type.name).toBe('literal_markdown')
    expect(definition.child(1).textContent).toBe(
      '<section>Raw HTML\nsecond line</section>',
    )
    expect(definition.child(2).type.name).toBe('literal_markdown')
    expect(editor.ctx.get(parserCtx)(serialize(editor.ctx)).eq(doc)).toBe(true)
  })
})
