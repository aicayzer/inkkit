import { ctxOf } from './editor-access'
import { fixtures } from '../scripts/interop/consumer/fixtures'
import { roundTrip } from './harness'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import {
  DOMParser as ProseParser,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { redoDepth, undoDepth } from '@milkdown/kit/prose/history'
import {
  InkKitEditor,
  type CaretState,
  type EditorOptions,
  type InkKitError,
} from '../src/core'

interface Session {
  editor: InkKitEditor
  view: EditorView
  errors: InkKitError[]
  states: CaretState[]
  generation(): number
  load(text: string, format?: 'md' | 'txt'): void
  /** Selects `word`, or puts the caret `caret` characters into it. */
  select(word: string, caret?: number): void
  /** Types `text` one character at a time, as a keyboard would. */
  type(text: string): void
  /** Saves, reopens the saved bytes, and checks they read back as shown. */
  reopens(): string
}

async function open(
  body: (session: Session) => void | Promise<void>,
  options?: EditorOptions,
): Promise<void> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: InkKitError[] = []
  const states: CaretState[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      error: (error) => errors.push(error),
      commandStateChanged: (state) => states.push(state.caret),
      copy() {},
      openLink() {},
    },
    options,
  )
  const view = ctxOf(editor).get(editorViewCtx)
  let generation = 0
  const session: Session = {
    editor,
    view,
    errors,
    states,
    generation: () => generation,
    load(text, format = 'md') {
      editor.loadDocument({
        documentId: 'marks',
        generation: ++generation,
        format,
        text,
      })
    },
    select(word, caret) {
      let from = -1
      view.state.doc.descendants((node, pos) => {
        if (from < 0 && node.isText && node.text!.includes(word))
          from = pos + node.text!.indexOf(word)
      })
      if (from < 0) throw new Error(`No ${word}`)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            from + (caret ?? 0),
            caret === undefined ? from + word.length : from + caret,
          ),
        ),
      )
    },
    type(text) {
      for (const character of text) {
        const { from, to } = view.state.selection
        const handled = view.someProp('handleTextInput', (handler) =>
          handler(view, from, to, character, () =>
            view.state.tr.insertText(character, from, to),
          ),
        )
        if (!handled) view.dispatch(view.state.tr.insertText(character))
      }
    },
    reopens() {
      const saved = editor.snapshot().text
      const shown = view.state.doc.toJSON()
      session.load(saved)
      expect(editor.snapshot().text).toBe(saved)
      expect(view.state.doc.toJSON()).toEqual(shown)
      return saved
    },
  }
  try {
    await body(session)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

/** The text each mark covers, as `name:text`, in document order. */
function marked(doc: ProseNode): string[] {
  const found: string[] = []
  doc.descendants((node) => {
    for (const mark of node.marks)
      if (['underline', 'superscript', 'subscript'].includes(mark.type.name))
        found.push(
          `${mark.type.name}:${node.isText ? node.text : node.type.name}`,
        )
  })
  return found
}

function literals(doc: ProseNode): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type.name === 'literal_markdown') count++
  })
  return count
}

// Each loads formatted, saves byte for byte and reopens with the same marks.
// Several of these loaded as literal blocks before the marks existed.
const formatted: Array<[string, string, string[]]> = [
  ['underline', 'Before <u>under</u> after\n', ['underline:under']],
  [
    'superscript and subscript',
    'E = mc<sup>2</sup> and H<sub>2</sub>O\n',
    ['superscript:2', 'subscript:2'],
  ],
  [
    'CRLF and a byte order mark',
    '﻿One <u>two</u>\r\n\r\nThree <sup>four</sup>\r\n',
    ['underline:two', 'superscript:four'],
  ],
  [
    'Unicode and combining characters',
    'Café <u>naïve 日本語 👩🏽‍💻</u> x<sub>é</sub>\n',
    ['underline:naïve 日本語 👩🏽‍💻', 'subscript:é'],
  ],
  [
    'entities and escapes inside',
    '<u>a &amp; b \\* c</u> and <sup>&copy;</sup>\n',
    ['underline:a & b * c', 'superscript:©'],
  ],
  [
    'a soft line break inside',
    '<u>first line\nsecond line</u> end\n',
    ['underline:first line', 'underline:hardbreak', 'underline:second line'],
  ],
  [
    'a list item',
    '- <u>item</u> one\n- x<sup>2</sup>\n',
    ['underline:item', 'superscript:2'],
  ],
  [
    'a table cell',
    '| A | B |\n| - | - |\n| <u>cell</u> | H<sub>2</sub>O |\n',
    ['underline:cell', 'subscript:2'],
  ],
  ['a quote', '> Quoted <u>text</u>\n', ['underline:text']],
  ['a callout', '> [!NOTE]\n> Called <sup>out</sup>\n', ['superscript:out']],
  ['a heading', '## Head <u>line</u>\n', ['underline:line']],
  [
    'a link label',
    '[<u>label</u>](https://example.com) and <u>[out](/o)</u>\n',
    ['underline:label', 'underline:out'],
  ],
  [
    'beside autolinks',
    '<https://example.com><u>after</u> and https://example.com <sup>n</sup>\n',
    ['underline:after', 'superscript:n'],
  ],
  [
    'a bare address inside',
    '<u>https://example.com</u>\n',
    ['underline:https://example.com'],
  ],
  [
    'nested with the other marks',
    '**<u>bold</u>** *<sup>it</sup>* ~~<sub>gone</sub>~~ ==<u>lit</u>== <u>**in** *side* `code`</u>\n',
    [
      'underline:bold',
      'superscript:it',
      'subscript:gone',
      'underline:lit',
      'underline:in',
      'underline: ',
      'underline:side',
      'underline: ',
      'underline:code',
    ],
  ],
  [
    'underline holding superscript',
    '<u>x<sup>2</sup></u> and <sub><u>y</u></sub>\n',
    [
      'underline:x',
      'underline:2',
      'superscript:2',
      'underline:y',
      'subscript:y',
    ],
  ],
  [
    'a footnote reference and definition',
    'Note<sup>[^1]</sup> here\n\n[^1]: Body <u>text</u>\n',
    ['superscript:footnote_reference', 'underline:text'],
  ],
  [
    'a comment inside',
    '<u>a <!-- hidden --> b</u> %%x%%\n',
    ['underline:a ', 'underline:comment_inline', 'underline: b'],
  ],
]

for (const [name, source, expected] of formatted)
  test(`tags load as marks and save unchanged: ${name}`, () =>
    open(async ({ editor, view, load, reopens }) => {
      load(source)
      expect(literals(view.state.doc)).toBe(0)
      expect(
        marked(view.state.doc).filter((entry) => !entry.endsWith(': ')),
      ).toEqual(expected.filter((entry) => !entry.endsWith(': ')))
      expect(editor.snapshot().text).toBe(source)
      expect(reopens()).toBe(source)
      // The writer's own form of the document is stable too.
      const canonical = await roundTrip(source.replace(/^\uFEFF/, ''))
      expect(await roundTrip(canonical)).toBe(canonical)
    }))

// These keep today's literal block, byte for byte, beside an edit elsewhere.
const literal: Array<[string, string]> = [
  ['uppercase tags', '<U>upper</U>'],
  ['an attribute', '<u class="x">styled</u>'],
  ['an unquoted attribute', '<sup id=a>1</sup>'],
  ['a space in the tag', '<u >spaced</u >'],
  ['an unpaired opening tag', 'Open <u>only'],
  ['an unpaired closing tag', 'Close only</sub>'],
  ['crossing tags', '<u><sup>x</u></sup>'],
  ['nested underline', '<u><u>twice</u></u>'],
  ['superscript in subscript', '<sub><sup>both</sup></sub>'],
  ['underline nested through bold', '<u>**<u>deep</u>**</u>'],
  ['an empty pair', 'Empty <u></u> pair'],
  ['a pair holding only spaces', 'Blank <sup> </sup> pair'],
  ['a pair split by formatting', '<u>**split</u>**'],
  ['other HTML beside a pair', '<u>kept</u> and <b>bold</b>'],
  ['an HTML block', '<u>\nblock\n</u>'],
]

for (const [name, block] of literal)
  test(`tags that cannot pair stay literal: ${name}`, () =>
    open(({ editor, view, load, select, reopens }) => {
      const source = `Edit me\r\n\r\n${block.replaceAll('\n', '\r\n')}\r\n`
      load(source)
      expect(literals(view.state.doc)).toBe(1)
      expect(marked(view.state.doc)).toEqual([])
      expect(editor.snapshot().text).toBe(source)
      select('me', 2)
      editor.insertText('!', 1)
      expect(editor.snapshot().text).toBe(source.replace('me', 'me!'))
      reopens()
    }))

test('a pair crossing blocks stays literal', () =>
  open(({ editor, view, load }) => {
    const source = 'One <u>open\n\nclosed</u> two\n'
    load(source)
    expect(literals(view.state.doc)).toBe(2)
    expect(editor.snapshot().text).toBe(source)
  }))

test('tags in code are code', () =>
  open(({ editor, view, load, reopens }) => {
    const source =
      'Span `<u>x</u>` here\n\n```html\n<u>y</u>\n```\n\n    <sup>z</sup>\n'
    load(source)
    expect(marked(view.state.doc)).toEqual([])
    expect(literals(view.state.doc)).toBe(0)
    expect(view.state.doc.child(0).textContent).toBe('Span <u>x</u> here')
    expect(editor.snapshot().text).toBe(source)
    reopens()
  }))

test('an edit in one block keeps every other block byte for byte', () =>
  open(({ editor, load, select }) => {
    const blocks = [
      'Top <u>one</u> &amp; x<sup>2</sup>',
      '- H<sub>2</sub>O\r\n- <u>*it*</u>',
      '| <u>A</u> | B |\r\n| - | - |\r\n| c | <sup>d</sup> |',
      '<U>literal</U> and <u class=x>y</u>',
      '> [!TIP]\r\n> <u>tip</u>',
      'Edit <u>this</u> line',
      'Last <sub>low</sub>',
    ]
    const source = blocks.join('\r\n\r\n') + '\r\n'
    load(source)
    select('this', 2)
    editor.insertText('X', 1)
    expect(editor.snapshot().text).toBe(source.replace('this', 'thXis'))
    select('Edit', 0)
    editor.insertText('Now ', 1)
    expect(editor.snapshot().text).toBe(
      source.replace('Edit <u>this', 'Now Edit <u>thXis'),
    )
  }))

test('format applies, reports and removes each mark, saving the source around it', () =>
  open(({ editor, view, load, select, states, reopens }) => {
    const source = 'Keep &amp; **bold** words\r\n\r\nOther <u>kept</u>\r\n'
    for (const [command, tag] of [
      ['underline', 'u'],
      ['superscript', 'sup'],
      ['subscript', 'sub'],
    ] as const) {
      load(source)
      select('words')
      expect(editor.commandState().commands.format[command]).toBe(true)
      expect(editor.format(command)).toBe(true)
      expect(states.at(-1)!.marks).toContain(command)
      const applied = source.replace('words', `<${tag}>words</${tag}>`)
      expect(editor.snapshot().text).toBe(applied)
      expect(reopens()).toBe(applied)
      select('words')
      expect(editor.format(command)).toBe(true)
      expect(states.at(-1)!.marks).not.toContain(command)
      expect(editor.snapshot().text).toBe(source)
      editor.undo()
      expect(editor.snapshot().text).toBe(applied)
      editor.redo()
      expect(editor.snapshot().text).toBe(source)
      expect(marked(view.state.doc)).toEqual(['underline:kept'])
    }
  }))

test('a mark toggled across existing marks reopens, and undo and redo restore the bytes', () =>
  open(({ editor, view, load, reopens }) => {
    const source = 'Plain **bold** and *it* [link](/l) `code` end\n'
    load(source)
    const { doc } = view.state
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(doc, 3, doc.content.size - 3),
      ),
    )
    editor.format('underline')
    const underlined = 'Pl<u>ain **bold** and *it* [link](/l) `code` e</u>nd\n'
    expect(editor.snapshot().text).toBe(underlined)
    editor.format('superscript')
    const both =
      'Pl<u><sup>ain **bold** and *it* [link](/l) `code` e</sup></u>nd\n'
    expect(editor.snapshot().text).toBe(both)
    expect(reopens()).toBe(both)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(
          view.state.doc,
          3,
          view.state.doc.content.size - 3,
        ),
      ),
    )
    // Subscript replaces superscript, which it excludes.
    editor.format('subscript')
    expect(editor.snapshot().text).toBe(both.replaceAll('sup>', 'sub>'))
    editor.format('underline')
    expect(editor.snapshot().text).toBe(
      'Pl<sub>ain **bold** and *it* [link](/l) `code` e</sub>nd\n',
    )
    editor.undo()
    expect(editor.snapshot().text).toBe(both.replaceAll('sup>', 'sub>'))
    editor.redo()
    editor.format('subscript')
    expect(editor.snapshot().text).toBe(source)
  }))

test('a toggle over part of an existing mark removes it there, then extends it', () =>
  open(({ editor, view, load }) => {
    const source = 'One <u>two three</u> four\n'
    load(source)
    const { doc } = view.state
    const at = doc.textContent.indexOf('three') + 1
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(doc, at, at + 'three four'.length),
      ),
    )
    editor.format('underline')
    expect(editor.snapshot().text).toBe('One <u>two</u> three four\n')
    editor.format('underline')
    expect(editor.snapshot().text).toBe('One <u>two three four</u>\n')
    editor.undo()
    editor.undo()
    expect(editor.snapshot().text).toBe(source)
  }))

test('typing inside, at either edge and deleting keep the authored source', () =>
  open(({ editor, view, load, select, reopens, generation }) => {
    const source =
      'a <u>keep &amp; this</u> b\r\n\r\nNext &amp; <sup>n</sup>\r\n'
    load(source)
    select('keep', 2)
    editor.insertText('X', generation())
    expect(editor.snapshot().text).toBe(source.replace('keep', 'keXep'))
    reopens()
    load(source)
    select('this', 4)
    editor.insertText('Y', generation())
    // Inclusive at its end, as bold is.
    expect(editor.snapshot().text).toBe(source.replace('this', 'thisY'))
    reopens()
    load(source)
    select('keep', 0)
    editor.insertText('Z', generation())
    expect(editor.snapshot().text).toBe(source.replace('<u>keep', 'Z<u>keep'))
    reopens()
    load(source)
    select('keep &amp; this'.replace('&amp;', '&'))
    view.dispatch(view.state.tr.deleteSelection())
    expect(editor.snapshot().text).toBe(
      source.replace('<u>keep &amp; this</u>', ''),
    )
    editor.undo()
    expect(editor.snapshot().text).toBe(source)
    editor.redo()
    expect(editor.snapshot().text).toBe(
      source.replace('<u>keep &amp; this</u>', ''),
    )
    editor.undo()
    select('keep ')
    view.dispatch(view.state.tr.deleteSelection())
    expect(editor.snapshot().text).toBe(source.replace('keep ', ''))
    reopens()
  }))

test('typed tags become the mark, unless the text is code or the tag is not exact', () =>
  open(({ editor, view, load, select, type, generation }) => {
    load('Type here\n')
    select('here', 4)
    type(' <u>under</u>')
    expect(marked(view.state.doc)).toEqual(['underline:under'])
    type(' after')
    expect(editor.snapshot().text).toBe('Type here <u>under</u> after\n')
    editor.undo()
    load('Type here\n')
    select('here', 4)
    // Buffered text applies the rule that its end completes.
    editor.insertText(' H<sub>2</sub>', generation())
    expect(marked(view.state.doc)).toEqual(['subscript:2'])
    expect(editor.snapshot().text).toBe('Type here H<sub>2</sub>\n')
    editor.undo()
    expect(editor.snapshot().text).toBe('Type here\n')
    load('Type `code` here\n')
    select('code', 2)
    type('<u>x</u>')
    expect(marked(view.state.doc)).toEqual([])
    expect(editor.snapshot().text).toBe('Type `co<u>x</u>de` here\n')
    load('Type here\n')
    select('here', 4)
    type(' <U>x</U>')
    expect(marked(view.state.doc)).toEqual([])
    const saved = editor.snapshot().text
    load(saved)
    expect(view.state.doc.textContent).toBe('Type here <U>x</U>')
    load('Already <u>under</u>\n')
    select('under', 5)
    type('<u>x</u>')
    expect(marked(view.state.doc)).toEqual(['underline:under<u>x</u>'])
    expect(editor.snapshot().text).toBe(
      'Already <u>under\\<u\\>x\\</u\\></u>\n',
    )
  }))

test('the marks have no default keys, take host keys and do nothing in source or TXT', () =>
  open(({ editor, load, select }) => {
    load('Some words\n')
    select('words')
    const key = { key: 'u', code: 'KeyU', metaKey: true }
    expect(editor.keyDown(key, 1)).toBe(false)
    editor.setKeymap({ underline: ['Mod-u'], superscript: ['Mod-.'] })
    expect(editor.keyDown(key, 1)).toBe(true)
    expect(editor.snapshot().text).toBe('Some <u>words</u>\n')
    expect(editor.keyDown({ key: '.', code: 'Period', metaKey: true }, 1)).toBe(
      true,
    )
    expect(editor.snapshot().text).toBe('Some <u><sup>words</sup></u>\n')
    editor.setEditingMode('source')
    const { format } = editor.commandState().commands
    expect([format.underline, format.superscript, format.subscript]).toEqual([
      false,
      false,
      false,
    ])
    load('<u>Literal</u>\r\n', 'txt')
    editor.format('underline')
    expect(editor.snapshot().text).toBe('<u>Literal</u>\r\n')
  }))

test('copy and print write the marks as u, sup and sub elements', () =>
  open(async ({ editor, load }) => {
    const source =
      'A <u>under</u>, x<sup>2</sup>, H<sub>2</sub>O and a note[^n]\n\n[^n]: Note\n'
    load(source)
    const copied = await editor.clipboardSnapshot()
    const template = document.createElement('template')
    template.innerHTML = copied.html
    expect(template.content.querySelector('u')!.textContent).toBe('under')
    const sups = [...template.content.querySelectorAll('sup')]
    expect(
      sups.map((sup) => sup.hasAttribute('data-inkkit-footnote-reference')),
    ).toEqual([false, true])
    expect(template.content.querySelector('sub')!.textContent).toBe('2')
    expect(copied.text).toContain('A under, x2, H2O')
    expect(copied.markdown).toBe(source)
    const printed = await editor.printableSnapshot()
    template.innerHTML = printed.html
    expect(template.content.querySelector('u')!.textContent).toBe('under')
    expect(template.content.querySelector('sup')!.textContent).toBe('2')
    expect(template.content.querySelector('sub')!.textContent).toBe('2')
  }))

test('superscript and footnote references parse from HTML as themselves', () =>
  open(({ view, load }) => {
    load('x<sup>2</sup> and a note[^n]\n\n[^n]: Note\n')
    const schema = view.state.schema
    const reread = ProseParser.fromSchema(schema).parse(view.dom)
    expect(marked(reread)).toEqual(['superscript:2'])
    let references = 0
    reread.descendants((node) => {
      if (node.type.name === 'footnote_reference') {
        references++
        expect(node.marks).toEqual([])
      }
    })
    expect(references).toBe(1)
  }))

test('pasted HTML marks import as plain text; pasted Markdown keeps the tags as written', () =>
  open(async ({ editor, view, load }) => {
    load('')
    await editor.paste({
      text: 'under x2 H2O',
      html: '<p><u>under</u> x<sup>2</sup> H<sub>2</sub>O</p>',
    })
    expect(marked(view.state.doc)).toEqual([])
    expect(editor.snapshot().text).toBe('under x2 H2O\n')
    load('')
    await editor.paste({ text: '', markdown: 'A <u>b</u> x<sup>2</sup>\n' })
    expect(marked(view.state.doc)).toEqual(['underline:b', 'superscript:2'])
    expect(editor.snapshot().text).toBe('A <u>b</u> x<sup>2</sup>\n')
    load('Text\n')
    expect(editor.pasteAsPlainText(' <u>plain</u>')).toBe(true)
    const saved = editor.snapshot().text
    load(saved)
    expect(view.state.doc.textContent).toContain('<u>plain</u>')
    expect(marked(view.state.doc)).toEqual([])
  }))

test('a copy pasted back as HTML keeps the text, and as Markdown keeps the marks', () =>
  open(async ({ editor, view, load }) => {
    const source = 'A <u>under</u> and x<sup>2</sup>\n'
    load(source)
    const copied = await editor.clipboardSnapshot()
    load('')
    await editor.paste({ text: copied.text, html: copied.html })
    expect(marked(view.state.doc)).toEqual([])
    expect(editor.snapshot().text).toBe('A under and x2\n')
    load('')
    await editor.paste({ text: copied.text, markdown: copied.markdown })
    expect(marked(view.state.doc)).toEqual(['underline:under', 'superscript:2'])
    expect(editor.snapshot().text).toBe(source)
  }))

test('an edit whose Markdown would not reopen is refused without changing the document', () =>
  open(({ editor, view, load, errors }) => {
    load('First\n\nx y\n')
    editor.insertText('!', 1)
    const before = editor.snapshot()
    const state = view.state
    const depths = [undoDepth(state), redoDepth(state)]
    const schema = state.schema
    const underline = schema.marks.underline!.create()
    const at = state.doc.child(0).nodeSize
    const paragraph = state.doc.child(1)
    // `<u>` alone on a paragraph's first line would start an HTML block.
    view.dispatch(
      state.tr.replaceWith(at + 1, at + 1 + paragraph.content.size, [
        schema.nodes.hardbreak!.create({ isInline: true }, null, [underline]),
        schema.text('x', [underline]),
      ]),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'preservation' })
    expect(view.state).toBe(state)
    expect(editor.snapshot()).toEqual(before)
    expect([undoDepth(view.state), redoDepth(view.state)]).toEqual(depths)
  }))

test('the playground fixture loads formatted and saves unchanged', () =>
  open(({ editor, view, load, reopens }) => {
    const source = fixtures['inline-marks']!.text
    load(source)
    expect(marked(view.state.doc)).toContain('underline:underlined')
    expect(literals(view.state.doc)).toBe(1)
    expect(editor.snapshot().text).toBe(source)
    expect(reopens()).toBe(source)
  }))

test('an address inside a mark stays bare, and so does the mark beside new neighbours', () =>
  open(({ editor, view, load, select, reopens }) => {
    load('Visit https://example.com today\n')
    select('https://example.com')
    editor.format('underline')
    expect(editor.snapshot().text).toBe(
      'Visit <u>https://example.com</u> today\n',
    )
    expect(reopens()).toBe('Visit <u>https://example.com</u> today\n')
    const link = view.state.doc.firstChild!.child(1)
    expect(link.marks.map((mark) => mark.type.name).sort()).toEqual([
      'link',
      'underline',
    ])
    expect(
      link.marks.find((mark) => mark.type.name === 'link')!.attrs.form,
    ).toBe('literal')
    // A space typed against the tag changes nothing inside the pair, which
    // emphasis delimiters could not promise.
    const source = 'a<u>b &amp; c</u>d\n'
    load(source)
    select('a', 1)
    editor.insertText(' ', editor.snapshot().generation)
    expect(editor.snapshot().text).toBe('a <u>b &amp; c</u>d\n')
    reopens()
  }))
