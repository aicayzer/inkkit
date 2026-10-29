import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { RichTextMark } from '../../../src/core'
import {
  ctxOf,
  doc,
  para,
  rich,
  richSnapshot,
  select,
  type,
  withRichEditor,
} from './harness'

const t = (value: string, ...marks: RichTextMark[]) =>
  marks.length
    ? { type: 'text' as const, text: value, marks }
    : { type: 'text' as const, text: value }

describe('Markdown input rules do nothing in RTF', () => {
  const typed = [
    '# ',
    '## ',
    '> ',
    '- ',
    '* ',
    '1. ',
    '```',
    '``` ',
    '---',
    '***',
    '[ ] ',
    '- [ ] ',
    '==mark==',
    '**bold**',
    '*em*',
    '_em_',
    '~~gone~~',
    '`code`',
    '<u>under</u>',
    '<sup>2</sup>',
    '[[Wiki]]',
    'https://example.com ',
    '> [!NOTE] ',
  ]
  for (const value of typed)
    test(JSON.stringify(value), () =>
      withRichEditor({ wikiLinks: { open() {} } }, ({ editor }) => {
        editor.loadDocument(rich(doc(para())))
        type(editor, value)
        expect(richSnapshot(editor).document).toEqual(doc(para(value)))
      }),
    )

  test('smart punctuation still applies', () =>
    withRichEditor({ textInput: { smartPunctuation: true } }, ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      type(editor, '"Hi" -- ok')
      expect(richSnapshot(editor).document).toEqual(doc(para('“Hi” – ok')))
    }))
})

describe('commands for what RTF cannot hold are unavailable', () => {
  test('in a paragraph', () =>
    withRichEditor(
      {
        images: {
          presentation: () => undefined,
          importImage: async () => ({ reference: 'x' }),
          exportImage: async () => ({
            bytes: new Uint8Array(),
            mimeType: 'image/png',
          }),
        },
      },
      ({ editor }) => {
        editor.loadDocument(rich(doc(para('Text'))))
        select(editor, 'Text')
        const { commands } = editor.commandState()
        for (const command of [
          'heading1',
          'heading2',
          'heading3',
          'heading4',
          'heading5',
          'heading6',
          'paragraph',
          'highlight',
          'codeBlock',
          'quote',
          'taskList',
          'toggleTask',
        ] as const) {
          expect(commands.format[command], command).toBe(false)
          expect(editor.format(command), command).toBe(false)
        }
        expect(commands.insertImages).toBe(false)
        expect(commands.appendImages).toBe(false)
        expect(commands.insertFootnote).toBe(false)
        expect(commands.editReferenceDefinition).toBe(false)
        expect(editor.insertImages([{ reference: 'x', alt: 'X' }])).toBe(false)
        expect(editor.appendImages([{ reference: 'x', alt: 'X' }])).toBe(false)
        expect(editor.insertFootnote()).toBe(false)
        expect(richSnapshot(editor)).toMatchObject({
          document: doc(para('Text')),
          dirty: false,
        })
      },
    ))

  test('heading shortcuts do nothing', () =>
    withRichEditor(
      {
        keymap: { heading1: ['Mod-1'], codeBlock: ['Mod-e'], quote: ['Mod-q'] },
      },
      ({ editor }) => {
        editor.loadDocument(rich(doc(para('Text'))))
        select(editor, 'Text')
        const { generation } = editor.commandState()
        for (const key of ['1', 'e', 'q'])
          editor.keyDown({ key, metaKey: true }, generation)
        expect(richSnapshot(editor)).toMatchObject({
          document: doc(para('Text')),
          dirty: false,
        })
      },
    ))

  test('the guard refuses a transaction that would add a heading, and changes nothing', () =>
    withRichEditor({}, ({ editor, changes }) => {
      editor.loadDocument(rich(doc(para('Text'))))
      const view = ctxOf(editor).get(editorViewCtx)
      const before = view.state
      const { schema } = view.state
      view.dispatch(
        view.state.tr.setBlockType(1, 5, schema.nodes.heading!, { level: 1 }),
      )
      view.dispatch(
        view.state.tr.insert(
          view.state.doc.content.size,
          schema.nodes.hr!.create(),
        ),
      )
      view.dispatch(
        view.state.tr.addMark(1, 5, schema.marks.highlight!.create()),
      )
      view.dispatch(view.state.tr.insertText('a b', 1))
      expect(view.state.doc).toBe(before.doc)
      expect(changes).toEqual([])
      expect(editor.undo()).toBe(false)
      expect(richSnapshot(editor)).toMatchObject({ revision: 0, dirty: false })
    }))

  test('the guard refuses a task, a second paragraph in an item and a list ten deep', () =>
    withRichEditor({}, ({ editor }) => {
      let list: never = {
        type: 'list',
        ordered: false,
        items: [{ blocks: [para('9')] }],
      } as never
      for (let level = 8; level >= 1; level--)
        list = {
          type: 'list',
          ordered: false,
          items: [{ blocks: [para(String(level)), list] }],
        } as never
      editor.loadDocument(rich(doc(list)))
      const view = ctxOf(editor).get(editorViewCtx)
      const before = view.state.doc
      let deepest = -1
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'list_item') deepest = pos
      })
      const item = view.state.doc.nodeAt(deepest)!
      view.dispatch(
        view.state.tr.setNodeMarkup(deepest, undefined, {
          ...item.attrs,
          checked: false,
        }),
      )
      view.dispatch(
        view.state.tr.insert(
          deepest + item.nodeSize - 1,
          view.state.schema.nodes.paragraph!.create(),
        ),
      )
      // Tab on the deepest item would make a tenth level.
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, deepest + 2),
        ),
      )
      expect(view.state.doc).toBe(before)
      const { generation } = editor.commandState()
      editor.keyDown({ key: 'Tab' }, generation)
      expect(view.state.doc).toBe(before)
    }))
})

describe('paste into RTF keeps what RTF can hold', () => {
  test('HTML headings become bold paragraphs, code blocks code paragraphs, images go', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({
        text: 'Title',
        html:
          '<h1>Title</h1><p>Some <u>under</u>, x<sup>2</sup>, H<sub>2</sub>O, <s>gone</s>, <b>b</b>, <i>i</i>, <code>c</code> and <a href="https://example.com/">link</a><br>next</p>' +
          '<pre>line 1\nline 2</pre><img src="data:image/png;base64,AAAA" alt="pic"><blockquote><p>Quoted</p></blockquote><hr>' +
          '<ul><li>one<ul><li>nested</li></ul></li></ul><ol start="3"><li>three</li></ol>' +
          '<table><tr><th>H</th><td>V</td></tr><tr><td>a</td><td>b</td></tr></table>',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para(t('Title', { type: 'bold' })),
          para(
            'Some ',
            t('under', { type: 'underline' }),
            ', x',
            t('2', { type: 'superscript' }),
            ', H',
            t('2', { type: 'subscript' }),
            'O, ',
            t('gone', { type: 'strikethrough' }),
            ', ',
            t('b', { type: 'bold' }),
            ', ',
            t('i', { type: 'italic' }),
            ', ',
            t('c', { type: 'code' }),
            ' and ',
            t('link', { type: 'link', href: 'https://example.com/' }),
            { type: 'break' },
            'next',
          ),
          para(t('line 1', { type: 'code' })),
          para(t('line 2', { type: 'code' })),
          para('Quoted'),
          {
            type: 'list',
            ordered: false,
            items: [
              {
                blocks: [
                  para('one'),
                  {
                    type: 'list',
                    ordered: false,
                    items: [{ blocks: [para('nested')] }],
                  },
                ],
              },
            ],
          },
          {
            type: 'list',
            ordered: true,
            start: 3,
            items: [{ blocks: [para('three')] }],
          },
          {
            type: 'table',
            rows: [
              [{ content: [t('H')] }, { content: [t('V')] }],
              [{ content: [t('a')] }, { content: [t('b')] }],
            ],
          },
        ),
      )
    }))

  // A pasted paragraph that joins the paragraph at the caret takes that paragraph's alignment, as
  // typed text would; a whole paragraph keeps its own.
  test('styled spans from a word processor keep their marks and alignment', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({
        text: 'x',
        html: '<b style="font-weight:normal"><p>first</p><p style="text-align:center"><span style="font-weight:700">Bold</span> <span style="font-style:italic;text-decoration:underline">both</span> <span style="vertical-align:super">up</span></p><p>last</p></b>',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para('first'),
          {
            type: 'paragraph',
            align: 'center',
            content: [
              t('Bold', { type: 'bold' }),
              t(' '),
              t('both', { type: 'italic' }, { type: 'underline' }),
              t(' '),
              t('up', { type: 'superscript' }),
            ],
          },
          para('last'),
        ),
      )
    }))

  test('an unsafe link keeps its text, and no script runs', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      const ran = globalThis as { inkkitRan?: boolean }
      ran.inkkitRan = false
      await editor.paste({
        text: 'bad',
        html: '<p><a href="javascript:window.inkkitRan=true">bad</a><script>window.inkkitRan=true</script><img src="x" onerror="window.inkkitRan=true"> <a href="data:text/html,x">data</a></p>',
      })
      expect(richSnapshot(editor).document).toEqual(doc(para('bad data')))
      expect(ran.inkkitRan).toBe(false)
    }))

  test('a host link scheme is kept', () =>
    withRichEditor({ linkSchemes: ['things'] }, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({ text: 't', html: '<a href="things:///show">t</a>' })
      expect(richSnapshot(editor).document).toEqual(
        doc(para(t('t', { type: 'link', href: 'things:///show' }))),
      )
    }))

  test('plain text pastes as paragraphs and keeps the marks around it', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para(t('ab', { type: 'bold' })))))
      select(editor, 'a', { caret: 'end' })
      await editor.paste({ text: 'one\r\ntwo three' })
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para(t('aone', { type: 'bold' })),
          para(
            t('two', { type: 'bold' }),
            { type: 'break' },
            t('threeb', { type: 'bold' }),
          ),
        ),
      )
    }))

  test('Markdown source pastes as its text, unparsed', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({
        text: 'ignored',
        html: '<b>ignored</b>',
        markdown: '# Title\n\n**bold**',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc(para('# Title'), para(), para('**bold**')),
      )
    }))

  test('pasteAsPlainText and native text with line endings make paragraphs', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      expect(editor.pasteAsPlainText('a\nb')).toBe(true)
      expect(editor.insertText('\nc', editor.commandState().generation)).toBe(
        true,
      )
      expect(richSnapshot(editor).document).toEqual(
        doc(para('a'), para('b'), para('c')),
      )
    }))

  test('a paste into a table cell keeps to the cell', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(
        rich(doc({ type: 'table', rows: [[{ content: [t('cell')] }]] })),
      )
      select(editor, 'cell', { caret: 'end' })
      await editor.paste({
        text: '',
        html: '<p>one</p><ul><li>two</li></ul><table><tr><td>x</td><td>y</td></tr></table>',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc({
          type: 'table',
          rows: [
            [
              {
                content: [
                  t('cellone'),
                  { type: 'break' },
                  t('two'),
                  { type: 'break' },
                  t('x\ty'),
                ],
              },
            ],
          ],
        }),
      )
    }))
})
