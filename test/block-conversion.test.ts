import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  InkKitEditor,
  type EditorOptions,
  type FormatCommand,
  type ImageAdapter,
} from '../src/index'
import { semanticSignature } from '../src/preserve'

const refusal = expect.objectContaining({
  name: 'InkKitError',
  code: 'preservation',
})

const images: ImageAdapter = {
  presentation: (reference) => ({ url: `blob:image/${reference}` }),
  importImage: async () => ({ reference: 'imported.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
  }),
}

interface Session {
  editor: InkKitEditor
  view: EditorView
  ctx: Ctx
  errors: Error[]
  text: () => string
}

async function open<T>(
  markdown: string,
  run: (session: Session) => T | Promise<T>,
  options: { visible?: boolean; select?: boolean } & EditorOptions = {},
): Promise<T> {
  const { visible = true, select: _select, ...editorOptions } = options
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    },
    editorOptions,
  )
  editor.loadDocument({
    documentId: 'conversion',
    generation: 1,
    format: 'md',
    text: markdown,
  })
  editor.setCommentsVisible(visible)
  const ctx = ctxOf(editor)
  const view = ctx.get(editorViewCtx)
  try {
    return await run({
      editor,
      view,
      ctx,
      errors,
      text: () => editor.snapshot().text,
    })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

/** Puts the caret `offset` characters into the first text that contains `find`. */
function caret(view: EditorView, find: string, offset = 0) {
  let at: number | undefined
  view.state.doc.descendants((node, pos) => {
    if (at != null) return false
    const index = node.isText ? node.text!.indexOf(find) : -1
    if (index >= 0) at = pos + index + offset
  })
  if (at == null) throw new Error(`No text ${find}`)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
  )
}

/** Selects the whole of the textblock that holds the caret. */
function selectBlock(view: EditorView) {
  const { $from } = view.state.selection
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, $from.start(), $from.end()),
    ),
  )
}

function codeTexts(view: EditorView): string[] {
  const found: string[] = []
  view.state.doc.descendants((node) => {
    if (node.type.name === 'code_block') found.push(node.textContent)
  })
  return found
}

/** The saved text reopens as the document the edit produced. */
function expectReopens({ ctx, view, text }: Session) {
  const reopened = ctx.get(parserCtx)(text())
  expect(semanticSignature(reopened)).toBe(semanticSignature(view.state.doc))
}

async function convert(
  markdown: string,
  find: string,
  command: FormatCommand = 'codeBlock',
  options: { visible?: boolean; select?: boolean } & EditorOptions = {},
) {
  return open(
    markdown,
    (session) => {
      caret(session.view, find)
      if (options.select) selectBlock(session.view)
      session.editor.format(command)
      expect(session.errors).toEqual([])
      expectReopens(session)
      return { text: session.text(), code: codeTexts(session.view) }
    },
    options,
  )
}

test('a paragraph turned into a code block keeps its visible comments as source', async () => {
  for (const comment of ['<!--note-->', '%%note%%']) {
    const markdown = `A ${comment} B\n`
    expect(await convert(markdown, 'A')).toEqual({
      text: `\`\`\`\nA ${comment} B\n\`\`\`\n`,
      code: [`A ${comment} B`],
    })
  }
})

test('a hidden comment beside the caret refuses the conversion and changes nothing', async () => {
  for (const comment of ['<!--note-->', '%%note%%']) {
    const markdown = `A ${comment} B\n`
    await open(
      markdown,
      ({ editor, view, errors, text }) => {
        caret(view, 'A')
        const before = view.state.doc
        expect(() => editor.format('codeBlock')).toThrow(refusal)
        expect(errors).toEqual([])
        expect(view.state.doc.eq(before)).toBe(true)
        expect(text()).toBe(markdown)
      },
      { visible: false },
    )
  }
})

test('a selected paragraph with hidden comments becomes code that keeps them', async () => {
  for (const comment of ['<!--note-->', '%%note%%']) {
    expect(
      await convert(`A ${comment} B\n`, 'A', 'codeBlock', {
        visible: false,
        select: true,
      }),
    ).toEqual({
      text: `\`\`\`\nA ${comment} B\n\`\`\`\n`,
      code: [`A ${comment} B`],
    })
  }
})

test('code keeps every inline element as its authored Markdown', async () => {
  const cases: Array<[string, string]> = [
    ['A[^1] B\n\n[^1]: Note.\n', 'A[^1] B'],
    ['A  \nB\n', 'A  \nB'],
    ['A\\\nB\n', 'A\\\nB'],
    ['A\nB\n', 'A\nB'],
    ['A <br> B\n', 'A <br> B'],
    [
      'A **b** __c__ _d_ `e` ~~f~~ ==g== B\n',
      'A **b** __c__ _d_ `e` ~~f~~ ==g== B',
    ],
    [
      'A [l](https://example.com "T") [r][ref] <https://auto.example> B\n\n[ref]: https://example.org\n',
      'A [l](https://example.com "T") [r][ref] <https://auto.example> B',
    ],
    ['a * b &amp; c\\_d\n', 'a * b &amp; c\\_d'],
  ]
  for (const [markdown, code] of cases) {
    const result = await convert(markdown, markdown.slice(0, 1))
    expect(result.code, markdown).toEqual([code])
    expect(result.text, markdown).toBe(
      markdown.replace(code + '\n', '```\n' + code + '\n```\n'),
    )
  }
})

test('code keeps images and wiki links as their Markdown', async () => {
  expect(
    await convert('A ![alt](picture.png "Title") B\n', 'A', 'codeBlock', {
      images,
    }),
  ).toEqual({
    text: '```\nA ![alt](picture.png "Title") B\n```\n',
    code: ['A ![alt](picture.png "Title") B'],
  })
  expect(
    await convert('A [[Page#Part|Alias]] B\n', 'A', 'codeBlock', {
      wikiLinks: { open() {} },
    }),
  ).toEqual({
    text: '```\nA [[Page#Part|Alias]] B\n```\n',
    code: ['A [[Page#Part|Alias]] B'],
  })
})

test('a heading becomes code that holds its text and comments, not its marker', async () => {
  expect(await convert('# A <!--n--> **B**\n\nNext\n', 'A')).toEqual({
    text: '```\nA <!--n--> **B**\n```\n\nNext\n',
    code: ['A <!--n--> **B**'],
  })
})

test('a paragraph in a quote, callout or list item keeps its own spelling without their markers', async () => {
  for (const [markdown, saved] of [
    [
      '> A <!--n-->\n> __B__ _c_\n',
      '> ```\n> A <!--n-->\n> __B__ _c_\n> ```\n',
    ],
    // A lazy line has no quote marker.
    ['> A <!--n-->\n__B__ _c_\n', '> ```\n> A <!--n-->\n> __B__ _c_\n> ```\n'],
    [
      '> [!NOTE]\n> A <!--n-->\n> __B__ _c_\n',
      '> [!NOTE]\n> ```\n> A <!--n-->\n> __B__ _c_\n> ```\n',
    ],
  ] as Array<[string, string]>) {
    const result = await convert(markdown, 'A')
    expect(result.code, markdown).toEqual(['A <!--n-->\n__B__ _c_'])
    expect(result.text, markdown).toBe(saved)
  }
  await open('- A <!--n-->\n  __B__ _c_\n- next\n', (session) => {
    caret(session.view, 'A')
    session.editor.format('codeBlock')
    // A list item's first block stays a paragraph, so nothing changes.
    expect(codeTexts(session.view)).toEqual([])
  })
  await open('- first\n\n  A <!--n-->\n  __B__ _c_\n', (session) => {
    caret(session.view, 'A')
    session.editor.format('codeBlock')
    expect(session.errors).toEqual([])
    expect(codeTexts(session.view)).toEqual(['A <!--n-->\n__B__ _c_'])
    expectReopens(session)
  })
})

test('a conversion keeps CRLF line endings and the blocks it did not reach', async () => {
  expect(await convert('Keep  *this*\r\n\r\nA <!--n-->\r\nB\r\n', 'A')).toEqual(
    {
      text: 'Keep  *this*\r\n\r\n```\r\nA <!--n-->\r\nB\r\n```\r\n',
      code: ['A <!--n-->\nB'],
    },
  )
})

test('several selected paragraphs each keep their source', () =>
  open('A <!--a-->\n\nB %%b%%\n', (session) => {
    const { view, editor, text } = session
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(
          view.state.doc,
          1,
          view.state.doc.content.size - 1,
        ),
      ),
    )
    editor.format('codeBlock')
    expect(session.errors).toEqual([])
    expect(text()).toBe('```\nA <!--a-->\n```\n\n```\nB %%b%%\n```\n')
    expectReopens(session)
  }))

test('undo after a conversion restores the authored paragraph', () =>
  open('A <!--note--> **B**\n', ({ editor, view, text }) => {
    caret(view, 'A')
    editor.format('codeBlock')
    expect(text()).toBe('```\nA <!--note--> **B**\n```\n')
    undo(view.state, view.dispatch)
    expect(text()).toBe('A <!--note--> **B**\n')
  }))

test('typing a fence at the start of a paragraph keeps the rest as source', () =>
  open('A <!--note--> B\n', (session) => {
    const { editor, view, text } = session
    caret(view, 'A')
    for (const character of '``` ') editor.insertText(character, 1)
    expect(session.errors).toEqual([])
    expect(text()).toBe('```\nA <!--note--> B\n```\n')
    expectReopens(session)
  }))

test('code turned back into text keeps every character and line', async () => {
  const cases: FormatCommand[] = ['codeBlock', 'paragraph']
  for (const command of cases) {
    const result = await convert(
      '```\nfirst <!--x--> **b**\nsecond %%y%%\n```\n',
      'first',
      command,
    )
    expect(result.code).toEqual([])
    expect(result.text).toBe(
      String.raw`first \<!--x--> \*\*b\*\*` +
        '\n' +
        String.raw`second \%%y\%%` +
        '\n',
    )
  }
})

test('blank, indented and heading lines of code keep their place in the text', async () => {
  for (const [markdown, command, saved] of [
    ['```\nfirst\n\nthird\n```\n', 'paragraph', 'first&#xA;\nthird\n'],
    [
      '```\nfirst\n    indented\n```\n',
      'paragraph',
      'first\n&#x20;   indented\n',
    ],
    [
      '```\nfirst\n# second\n- third\n```\n',
      'paragraph',
      'first\n\\# second\n\\- third\n',
    ],
    ['```\nfirst\nsecond\n```\n', 'heading2', 'first\nsecond\n------\n'],
  ] as Array<[string, FormatCommand, string]>) {
    const result = await convert(markdown, 'first', command)
    expect(result, markdown).toEqual({ text: saved, code: [] })
  }
})

for (const ending of ['\n', '\r\n'])
  test(`code trailing spaces stay text beside a soft break (${JSON.stringify(ending)})`, async () => {
    const markdown =
      '__Before__ &amp;\n\n```\nfirst  \nsecond\n```\n\nAfter&#33;\n'.replaceAll(
        '\n',
        ending,
      )
    const saved =
      '__Before__ &amp;\n\nfirst &#x20;\nsecond\n\nAfter&#33;\n'.replaceAll(
        '\n',
        ending,
      )
    await open(markdown, async (session) => {
      const { editor, view, errors, text } = session
      caret(view, 'first')
      editor.format('paragraph')
      expect(errors).toEqual([])
      expect(text()).toBe(saved)
      expectReopens(session)
      const readable = editor.textSnapshot().text
      expect(readable).toBe('Before &\nfirst  \nsecond\nAfter!')
      const copied = await editor.clipboardSnapshot()
      expect(copied.text).toBe('Before &\n\nfirst  \nsecond\n\nAfter!')
      expect(copied.markdown).toBe(saved)
      expect(copied.html).toContain('first  <br data-type="softbreak">second')
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot()).toMatchObject({ text: markdown, dirty: false })
      expect(editor.redo()).toBe(true)
      expect(text()).toBe(saved)
      expectReopens(session)
      editor.loadDocument({
        documentId: 'reopened',
        generation: 2,
        format: 'md',
        text: saved,
      })
      expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
      expect(editor.textSnapshot().text).toBe(readable)
      const reopened = await editor.clipboardSnapshot()
      expect(reopened.text).toBe(copied.text)
      expect(reopened.html).toBe(copied.html)
      expect(reopened.markdown).toBe(saved)
    })
  })

test('a code line turns into a heading that keeps its characters', async () => {
  expect(
    await convert('```\nTitle <!--x-->\n```\n', 'Title', 'heading2'),
  ).toEqual({ text: '## Title \\<!--x-->\n', code: [] })
})

/** Puts the caret at the start (`-1`) or end (`1`) of the `index`th top-level block. */
function edge(view: EditorView, index: number, dir: -1 | 1) {
  let pos = 0
  for (let i = 0; i < index; i++) pos += view.state.doc.child(i).nodeSize
  const at = dir < 0 ? pos + 1 : pos + view.state.doc.child(index).nodeSize - 1
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
  )
}

const press = (editor: InkKitEditor, key: string) =>
  editor.keyDown({ key, code: key }, editor.snapshot().generation)

test('joining a paragraph or heading into code keeps it as source', async () => {
  for (const [markdown, index, dir, key, saved] of [
    [
      '```\ncode\n```\n\nA <!--n--> **B**\n',
      0,
      1,
      'Delete',
      '```\ncodeA <!--n--> **B**\n```\n',
    ],
    [
      '```\ncode\n```\n\nA %%n%% [l](https://example.com)\n',
      1,
      -1,
      'Backspace',
      '```\ncodeA %%n%% [l](https://example.com)\n```\n',
    ],
    [
      '```\ncode\n```\n\n# A <!--n--> **B**\n',
      0,
      1,
      'Delete',
      '```\ncodeA <!--n--> **B**\n```\n',
    ],
  ] as Array<[string, number, -1 | 1, string, string]>) {
    await open(markdown, (session) => {
      edge(session.view, index, dir)
      expect(press(session.editor, key)).toBe(true)
      expect(session.errors, markdown).toEqual([])
      expect(session.text(), markdown).toBe(saved)
      expectReopens(session)
      // The caret is where the two blocks met.
      expect(session.view.state.selection.from).toBe(5)
    })
  }
})

test('joining code into a paragraph keeps its lines', async () => {
  for (const [index, dir, key] of [
    [0, 1, 'Delete'],
    [1, -1, 'Backspace'],
  ] as Array<[number, -1 | 1, string]>) {
    await open('A <!--n-->\n\n```\nx\ny\n```\n', (session) => {
      edge(session.view, index, dir)
      expect(press(session.editor, key)).toBe(true)
      expect(session.errors).toEqual([])
      expect(session.text()).toBe('A <!--n-->x\ny\n')
      expectReopens(session)
    })
  }
})

test('an empty block beside code is still removed by the join', () =>
  open('```\ncode\n```\n\n<br />\n\nNext\n', (session) => {
    expect(session.view.state.doc.child(1).content.size).toBe(0)
    edge(session.view, 1, -1)
    press(session.editor, 'Backspace')
    expect(session.errors).toEqual([])
    expect(session.view.state.doc.childCount).toBe(2)
    expect(codeTexts(session.view)).toEqual(['code'])
  }))

test('comment and literal blocks keep their syntax: they do not change type or take code in', async () => {
  for (const markdown of [
    '<!--\nnote <b>x</b>\n-->\n',
    '%%\nnote\n%%\n',
    '<div>literal <!--c--> **x**</div>\n',
  ]) {
    await open(markdown, (session) => {
      const { editor, view, text } = session
      edge(view, 0, -1)
      const { format } = editor.commandState().commands
      expect([format.codeBlock, format.paragraph, format.heading2]).toEqual([
        false,
        false,
        false,
      ])
      for (const command of [
        'codeBlock',
        'paragraph',
        'heading2',
      ] as FormatCommand[])
        editor.format(command)
      expect(session.errors).toEqual([])
      expect(text(), markdown).toBe(markdown)
    })
  }
})

test('Backspace after a visible block comment moves no text into it', () =>
  open('<!--\nnote\n-->\n\nVisible **b**\n', (session) => {
    edge(session.view, 1, -1)
    press(session.editor, 'Backspace')
    expect(session.text()).toBe('<!--\nnote\n-->\n\nVisible **b**\n')
  }))

test('Backspace and Delete do not join a comment or literal block with another kind of block', async () => {
  for (const [first, second] of [
    ['```\ncode\n```', '<!--\nnote\n-->'],
    ['```\ncode\n```', '<div>literal <!--c--> x</div>'],
    ['Visible', '<!--\nnote\n-->'],
    ['<!--\nnote\n-->', 'Visible'],
    ['<!--\nnote\n-->', '```\ncode\n```'],
    ['Para **x**', '<div>literal <!--c--> x</div>'],
    ['<div>literal <!--c--> x</div>', 'Visible'],
  ]) {
    const markdown = `${first}\n\n${second}\n`
    await open(markdown, (session) => {
      edge(session.view, 0, 1)
      press(session.editor, 'Delete')
      expect(session.text(), markdown).toBe(markdown)
      edge(session.view, 1, -1)
      press(session.editor, 'Backspace')
      expect(session.text(), markdown).toBe(markdown)
      expect(session.errors).toEqual([])
    })
  }
})

test('Backspace at the start of a heading after code lowers the heading first', () =>
  open('```\ncode\n```\n\n# A <!--n--> **B**\n', (session) => {
    edge(session.view, 1, -1)
    press(session.editor, 'Backspace')
    expect(session.text()).toBe('```\ncode\n```\n\nA <!--n--> **B**\n')
    press(session.editor, 'Backspace')
    expect(session.text()).toBe('```\ncodeA <!--n--> **B**\n```\n')
    expect(session.errors).toEqual([])
  }))

// A busy machine slows a sample but never speeds one up, so the fastest of
// several samples is the least disturbed. Converting 8 times as many
// paragraphs takes about 8 times as long when time grows linearly and 64
// times when it grows quadratically; the bound lies between.
test(
  'converting many paragraphs takes time linear in their number',
  () =>
    open('', ({ editor, view }) => {
      const sample = (count: number) => {
        editor.loadDocument({
          documentId: `many-${count}`,
          generation: editor.snapshot().generation + 1,
          format: 'md',
          text:
            Array.from(
              { length: count },
              (_, i) => `Line ${i} __b__ <!--c${i}--> _i_`,
            ).join('\n\n') + '\n',
        })
        editor.setCommentsVisible(true)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(
              view.state.doc,
              1,
              view.state.doc.content.size - 1,
            ),
          ),
        )
        const start = performance.now()
        editor.format('codeBlock')
        const elapsed = performance.now() - start
        expect(editor.snapshot().text).toContain(
          `\`\`\`\nLine ${count - 1} __b__ <!--c${count - 1}--> _i_\n\`\`\``,
        )
        return elapsed
      }
      sample(50)
      let fastestSmall = Infinity
      let fastestLarge = Infinity
      for (let i = 0; i < 5; i++) {
        fastestSmall = Math.min(fastestSmall, sample(50))
        fastestLarge = Math.min(fastestLarge, sample(400))
      }
      expect(fastestLarge).toBeLessThan(Math.max(fastestSmall, 1) * 30)
    }),
  120_000,
)
