import { describe, expect, test } from 'vitest'
import type { RichTextBlock, RichTextDocument } from '../../../src/core'
import { richTextFormat } from '../../../src/formats/rich-text'
import {
  doc,
  para,
  rich,
  richSnapshot,
  select,
  withRichEditor,
} from './harness'

type List = RichTextBlock & { type: 'list' }

const list = (ordered: boolean, ...items: RichTextBlock[][]): List => ({
  type: 'list',
  ordered,
  items: items.map((blocks) => ({ blocks })),
})

/** A list `levels` deep whose innermost item holds `text`. */
function deep(levels: number, text: string): List {
  let inner = list(false, [para(text)])
  for (let level = levels - 1; level >= 1; level--)
    inner = list(false, [para(`level ${level}`), inner])
  return inner
}

/** The items of the innermost list holding `text`. */
function itemsAround(
  document: RichTextDocument,
  text: string,
): string[] | undefined {
  let found: string[] | undefined
  const visit = (block: RichTextBlock) => {
    if (block.type !== 'list') return
    const texts = block.items.map((item) => {
      const first = item.blocks[0] as { content: { text?: string }[] }
      return first.content.map((inline) => inline.text ?? '\n').join('')
    })
    if (texts.some((value) => value.includes(text))) found = texts
    for (const item of block.items) item.blocks.forEach(visit)
  }
  document.blocks.forEach(visit)
  return found
}

describe('a paste of several lines into a list item makes sibling items', () => {
  for (const ordered of [false, true])
    test(`plain text into a ${ordered ? 'numbered' : 'bulleted'} item`, () =>
      withRichEditor({}, async ({ editor }) => {
        editor.loadDocument(rich(doc(list(ordered, [para('abcd')]))))
        select(editor, 'ab', { caret: 'end' })
        await editor.paste({ text: 'X\nY' })
        expect(richSnapshot(editor).document).toEqual(
          doc(list(ordered, [para('abX')], [para('Ycd')])),
        )
      }))

  test('HTML paragraphs, native text and a trailing line ending', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(list(false, [para('ab')]))))
      select(editor, 'a', { caret: 'end' })
      await editor.paste({ text: '', html: '<p>p1</p><p>p2</p>' })
      expect(itemsAround(richSnapshot(editor).document, 'p1')).toEqual([
        'ap1',
        'p2b',
      ])
      select(editor, 'p2', { caret: 'end' })
      const { generation } = editor.commandState()
      expect(editor.insertText('m\nn', generation)).toBe(true)
      expect(itemsAround(richSnapshot(editor).document, 'p1')).toEqual([
        'ap1',
        'p2m',
        'nb',
      ])
      await editor.paste({ text: 'Z\n' })
      expect(itemsAround(richSnapshot(editor).document, 'p1')).toEqual([
        'ap1',
        'p2m',
        'nZ',
        'b',
      ])
    }))

  test('into an empty item and at the deepest level', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(deep(9, 'x'))))
      select(editor, 'x')
      await editor.paste({ text: 'one\ntwo' })
      expect(itemsAround(richSnapshot(editor).document, 'one')).toEqual([
        'one',
        'two',
      ])
      editor.loadDocument(rich(doc(list(true, [para('a')], [para()]))))
      select(editor, 'a', { caret: 'end' })
      // The caret moves into the empty second item.
      await editor.paste({ text: '\nq\nr' })
      expect(richSnapshot(editor).document).toEqual(
        doc(list(true, [para('a')], [para('q')], [para('r')], [para()])),
      )
    }))

  test('a pasted list nests under the item before it', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(list(false, [para('ab')]))))
      select(editor, 'a', { caret: 'end' })
      await editor.paste({
        text: '',
        html: '<p>head</p><ul><li>n1</li><li>n2</li></ul><p>tail</p>',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc(
          list(
            false,
            [para('ahead'), list(false, [para('n1')], [para('n2')])],
            [para('tailb')],
          ),
        ),
      )
    }))

  test('levels deeper than nine are lifted to the ninth, not dropped', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(deep(8, 'here'))))
      select(editor, 'here', { caret: 'end' })
      await editor.paste({
        text: '',
        html: '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>',
      })
      const snapshot = richSnapshot(editor).document
      // `a` nests at level nine; `b` and `c` would be deeper, so they join it there.
      expect(itemsAround(snapshot, 'a')).toEqual(['a', 'b', 'c'])
      expect(JSON.stringify(snapshot)).toContain('"text":"c"')
    }))

  test('a deep list pasted outside a list keeps nine levels and lifts the rest', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      let html = ''
      for (let level = 11; level >= 1; level--)
        html = `<ul><li>l${level}${html}</li></ul>`
      await editor.paste({ text: '', html })
      const snapshot = richSnapshot(editor).document
      expect(itemsAround(snapshot, 'l9')).toEqual(['l9', 'l10', 'l11'])
    }))
})

test('a paste or plain insertion the document refuses fails instead of doing nothing', () =>
  withRichEditor({}, async ({ editor }) => {
    editor.loadDocument(rich(doc(para('ab'))))
    select(editor, 'a', { caret: 'end' })
    // Every edit refused, as the guard refuses one RTF can't hold.
    const behaviour = richTextFormat.richText as { allows: unknown }
    const allows = behaviour.allows
    behaviour.allows = () => false
    try {
      await expect(editor.paste({ text: 'x\ny' })).rejects.toMatchObject({
        code: 'preservation',
      })
      expect(() => editor.pasteAsPlainText('x')).toThrow(
        expect.objectContaining({ code: 'preservation' }),
      )
      expect(editor.insertText('x', editor.commandState().generation)).toBe(
        false,
      )
    } finally {
      behaviour.allows = allows
    }
    expect(richSnapshot(editor)).toMatchObject({
      document: doc(para('ab')),
      revision: 0,
    })
  }))
