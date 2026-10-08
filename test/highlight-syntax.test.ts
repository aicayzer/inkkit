import { expect, test } from 'vitest'
import {
  Editor,
  commandsCtx,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { dialect, serialize, stringifyOptions } from '../src/dialect'
import {
  inlineHighlight,
  toggleHighlightCommand,
} from '../src/inline-highlight'
import { Preservation } from '../src/preserve'
import { clipboardContent } from '../src/clipboard'
import { InkKitEditor, type CaretState } from '../src/editor'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'

async function withHighlight(
  source: string,
  run: (editor: Editor) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, source)
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(dialect.filter((plugin) => !inlineHighlight.includes(plugin)))
    .use(inlineHighlight)
    .create()
  try {
    await run(editor)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function markedText(doc: ProseNode): string[] {
  const found: string[] = []
  doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some((mark) => mark.type.name === 'highlight')
    )
      found.push(node.text!)
  })
  return found
}

for (const [source, marked] of [
  ['Before ==highlight== after\n', ['highlight']],
  ['a==b==c and ==first== ==second==\n', ['b', 'first', 'second']],
  [
    '==__bold__ *emphasis* [link](/target) `code`==\n',
    ['bold', ' ', 'emphasis', ' ', 'link', ' ', 'code'],
  ],
  [
    '__outer ==inner==__ and ==outer __inner__==\n',
    ['inner', 'outer ', 'inner'],
  ],
  ['\\==literal== and ==a \\= b==\n', ['a = b']],
  ['==outside== `==literal==`\n\n```text\n==literal==\n```\n', ['outside']],
  ['Note[^Note]\n\n[^Note]: ==body==\n', ['body']],
  ['==first\nsecond==\n', ['first', 'second']],
  [
    '| Highlight | Other |\n| --- | --- |\n| ==cell== | ~~strike~~ |\n',
    ['cell'],
  ],
  ['[==Display==][Label]\n\n[Label]: /target\n', ['Display']],
] as const) {
  test(`highlight parses nested inline content and reopens: ${JSON.stringify(source)}`, async () => {
    await withHighlight(source, (editor) => {
      const ctx = editor.ctx
      const view = ctx.get(editorViewCtx)
      expect(markedText(view.state.doc)).toEqual(marked)
      const saved = serialize(ctx)
      expect(markedText(ctx.get(parserCtx)(saved))).toEqual(marked)
      expect(new Preservation(ctx, source).serialize(view.state.doc)).toBe(
        source,
      )
    })
  })
}

test('unsupported delimiter counts, spacing and unclosed syntax remain literal beside an edit', async () => {
  const source = '=one= ===three=== == missing== ==missing == ==== ==unclosed\n'
  await withHighlight(source, (editor) => {
    const ctx = editor.ctx
    const view = ctx.get(editorViewCtx)
    const preservation = new Preservation(ctx, source)
    expect(markedText(view.state.doc)).toEqual([])
    view.dispatch(
      view.state.tr.insertText('!', view.state.doc.content.size - 1),
    )
    const saved = preservation.serialize(view.state.doc)
    expect(saved).toBe(source.replace('\n', '!\n'))
    expect(markedText(ctx.get(parserCtx)(saved))).toEqual([])
  })
})

test('highlight leaf editing preserves authored entities and nested marker spelling', async () => {
  const source = 'Before ==café &amp; __bold__== after\n'
  await withHighlight(source, (editor) => {
    const ctx = editor.ctx
    const view = ctx.get(editorViewCtx)
    const original = view.state.doc
    const preservation = new Preservation(ctx, source)
    let bold = 0
    original.descendants((node, pos) => {
      if (node.text === 'bold') bold = pos
    })
    view.dispatch(view.state.tr.insertText('!', bold + 4))
    const saved = preservation.serialize(view.state.doc)
    expect(saved).toBe('Before ==café &amp; __bold!__== after\n')
    expect(ctx.get(parserCtx)(saved).eq(view.state.doc)).toBe(true)
    expect(preservation.serialize(original)).toBe(source)
    const tree = ctx.get(remarkCtx).parse(source)
    const paragraph = tree.children[0]!
    if (!('children' in paragraph)) throw new Error('Expected paragraph')
    const highlight = paragraph.children.find(
      (node) => node.type === 'highlight',
    )!
    expect(
      source.slice(
        highlight.position!.start.offset!,
        highlight.position!.end.offset!,
      ),
    ).toBe('==café &amp; __bold__==')
  })
})

test('highlight toggle emits semantic ordinary copy and Markdown syntax', async () => {
  await withHighlight('alpha beta\n', (editor) => {
    const ctx = editor.ctx
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)),
    )
    expect(ctx.get(commandsCtx).call(toggleHighlightCommand.key)).toBe(true)
    expect(serialize(ctx)).toBe('==alpha== beta\n')
    const copied = clipboardContent(view.state.doc.content, view.state.schema)
    expect(copied.text).toBe('alpha beta')
    expect(copied.html).toContain('<mark>alpha</mark>')
    expect(ctx.get(commandsCtx).call(toggleHighlightCommand.key)).toBe(true)
    expect(serialize(ctx)).toBe('alpha beta\n')
  })
})

test('a highlighted URL reopens with its target', async () => {
  await withHighlight('https://example.com\n', (editor) => {
    const ctx = editor.ctx
    const view = ctx.get(editorViewCtx)
    const from = 1,
      to = view.state.doc.content.size - 1
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, from, to),
      ),
    )
    ctx.get(commandsCtx).call(toggleHighlightCommand.key)
    const saved = serialize(ctx)
    const reopened = ctx.get(parserCtx)(saved)
    expect(markedText(reopened)).toEqual(['https://example.com'])
    expect(
      reopened.firstChild!.firstChild!.marks.find(
        (mark) => mark.type.name === 'link',
      )?.attrs.href,
    ).toBe('https://example.com')
  })
})

test('typing only spaces after enabling highlight remains snapshot-safe', async () => {
  await withHighlight('', (editor) => {
    const ctx = editor.ctx
    const view = ctx.get(editorViewCtx)
    const preservation = new Preservation(ctx, '')
    ctx.get(commandsCtx).call(toggleHighlightCommand.key)
    view.dispatch(view.state.tr.insertText('  '))
    expect(() => preservation.serialize(view.state.doc)).not.toThrow()
  })
})

test('a punctuation-only highlight inside a word remains snapshot-safe', async () => {
  await withHighlight('a.b\n', (editor) => {
    const ctx = editor.ctx
    const view = ctx.get(editorViewCtx)
    const preservation = new Preservation(ctx, 'a.b\n')
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)),
    )
    ctx.get(commandsCtx).call(toggleHighlightCommand.key)
    const saved = preservation.serialize(view.state.doc)
    expect(markedText(ctx.get(parserCtx)(saved))).toEqual(['.'])
  })
})

for (const [source, expected] of [
  ['Before ==**bold**=', ['bold']],
  ['Before \\==literal=', []],
  ['Before ===literal=', []],
  ['Before == spaced=', []],
  ['Before `==literal=`', []],
] as const) {
  test(`typed highlight uses parser delimiter rules: ${JSON.stringify(source)}`, async () => {
    await withHighlight(source.replaceAll('\\', '\\\\'), (editor) => {
      const ctx = editor.ctx
      const view = ctx.get(editorViewCtx)
      const end = view.state.doc.content.size - 1
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
      )
      const handled = view.someProp('handleTextInput', (handler) =>
        handler(view, end, end, '=', () => view.state.tr.insertText('=', end)),
      )
      if (!handled) view.dispatch(view.state.tr.insertText('=', end))
      expect(markedText(view.state.doc)).toEqual(expected)
      expect(markedText(ctx.get(parserCtx)(serialize(ctx)))).toEqual(expected)
      if (expected.length) {
        expect(view.state.doc.textContent).toBe('Before bold')
        expect(
          view.state.doc.firstChild!.lastChild!.marks.map(
            (mark) => mark.type.name,
          ),
        ).toContain('strong')
      }
    })
  })
}

async function withFacade(
  run: (
    editor: InkKitEditor,
    ctx: Ctx,
    states: CaretState[],
  ) => Promise<void> | void,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const states: CaretState[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged(state) {
      states.push(state)
    },
    copy() {},
    openLink() {},
  })
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await run(editor, ctx, states)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const input = { documentId: 'highlight', generation: 1, format: 'md' as const }

test('facade highlight preserves surrounding source, copies the selection and undoes to original bytes', async () => {
  await withFacade(async (editor, ctx, states) => {
    const source = 'Before __bold__ and &amp; after\r\n'
    editor.loadDocument({ ...input, text: source })
    editor.find('bold')
    editor.format('highlight')
    expect(states.at(-1)!.marks).toContain('highlight')
    const saved = editor.snapshot().text
    expect(saved).toContain(' and &amp; after\r\n')
    expect(saved).toContain('==')
    const copied = await editor.clipboardSnapshot(false)
    expect(copied.text).toBe('bold')
    const template = document.createElement('template')
    template.innerHTML = copied.html
    expect(template.content.querySelector('mark')!.textContent).toBe('bold')
    expect(copied.markdown).toContain('==')
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    editor.loadDocument({ ...input, generation: 2, text: '' })
    await editor.paste({ text: copied.text, html: copied.html })
    expect(markedText(view.state.doc)).toEqual(['bold'])
    const pasted = editor.snapshot().text
    editor.loadDocument({ ...input, generation: 3, text: pasted })
    expect(markedText(view.state.doc)).toEqual(['bold'])
  })
})

test('highlight uses the host keymap and TXT remains literal', async () => {
  await withFacade((editor, ctx) => {
    editor.loadDocument({ ...input, text: 'Selected words\n' })
    editor.find('Selected words')
    expect(editor.keyDown('h', 'KeyH', true, false, false, true, 1)).toBe(false)
    editor.setKeymap({ highlight: ['Mod-Shift-h'] })
    expect(editor.keyDown('h', 'KeyH', true, false, false, true, 1)).toBe(true)
    expect(editor.snapshot().text).toBe('==Selected words==\n')
    editor.loadDocument({
      ...input,
      generation: 2,
      format: 'txt',
      text: '==Literal text==\r\n',
    })
    editor.format('highlight')
    expect(editor.snapshot().text).toBe('==Literal text==\r\n')
  })
})

test('external semantic mark HTML imports as editable highlight', async () => {
  await withFacade(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: '' })
    await editor.paste({
      text: 'Native highlight',
      html: '<p><mark>Native <strong>highlight</strong></mark></p>',
    })
    expect(markedText(ctx.get(editorViewCtx).state.doc)).toEqual([
      'Native ',
      'highlight',
    ])
    const saved = editor.snapshot().text
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(markedText(ctx.get(editorViewCtx).state.doc)).toEqual([
      'Native ',
      'highlight',
    ])
  })
})

test('buffered typing creates a complete highlight in one insertion', async () => {
  await withFacade((editor, ctx) => {
    editor.loadDocument({ ...input, text: '' })
    editor.insertText('==buffered==', 1)
    expect(markedText(ctx.get(editorViewCtx).state.doc)).toEqual(['buffered'])
    expect(editor.snapshot().text).toBe('==buffered==\n')
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe('')
  })
})

test('buffered closing delimiters preserve earlier text and undo together', async () => {
  await withFacade((editor, ctx) => {
    const source = 'Before ==buffered\n'
    editor.loadDocument({ ...input, text: source })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, view.state.doc.content.size - 1),
      ),
    )
    editor.insertText('==', 1)
    expect(markedText(view.state.doc)).toEqual(['buffered'])
    expect(editor.snapshot().text).toBe('Before ==buffered==\n')
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
  })
})

test('buffered highlight replaces a selection in one transaction', async () => {
  await withFacade((editor, ctx) => {
    const source = 'Before replaced after\n'
    editor.loadDocument({ ...input, text: source })
    editor.find('replaced')
    editor.insertText('==buffered==', 1)
    const view = ctx.get(editorViewCtx)
    expect(markedText(view.state.doc)).toEqual(['buffered'])
    expect(editor.snapshot().text).toBe('Before ==buffered== after\n')
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
  })
})

for (const source of [
  '`==literal=X`\n',
  '<!--==literal=-->\n',
  'Before %%==literal=%% after\n',
]) {
  test(`buffered highlight delimiters remain literal inside code or comments: ${JSON.stringify(source)}`, async () => {
    await withFacade((editor, ctx) => {
      editor.loadDocument({ ...input, text: source })
      const view = ctx.get(editorViewCtx)
      let caret = 0
      view.state.doc.descendants((node, pos) => {
        if (node.isText && node.text!.includes('==literal='))
          caret = pos + node.text!.indexOf('==literal=') + '==literal='.length
      })
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)),
      )
      editor.insertText('=', 1)
      expect(markedText(view.state.doc)).toEqual([])
      expect(editor.snapshot().text).toBe(
        source.replace('==literal=', '==literal=='),
      )
    })
  })
}

test('buffered highlight syntax remains literal in TXT', async () => {
  await withFacade((editor) => {
    editor.loadDocument({ ...input, format: 'txt', text: '' })
    editor.insertText('==buffered==', 1)
    expect(editor.snapshot().text).toBe('==buffered==')
  })
})
