import { getMatchHighlights } from 'prosemirror-search'
import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import { Slice } from '@milkdown/kit/prose/model'
import { serialize } from '../src/dialect'
import { InkKitEditor, type CaretState } from '../src/editor'

async function withInkKitEditor<T>(
  markdown: string,
  run: (editor: InkKitEditor, states: CaretState[]) => T,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const states: CaretState[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged(state) {
      states.push(state)
    },
    openLink() {},
    copy() {},
  })
  editor.loadDocument({
    documentId: 'test',
    format: 'md',
    text: markdown,
    generation: 1,
  })
  try {
    return run(editor, states)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function ctxOf(editor: InkKitEditor): Ctx {
  return (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
}

function placeCaret(editor: InkKitEditor, pos: number) {
  const view = ctxOf(editor).get(editorViewCtx)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  )
}

test('a loaded document opens with the caret at its end', async () =>
  withInkKitEditor('# Heading\n\nA line.\n', (editor) => {
    const { doc, selection } = ctxOf(editor).get(editorViewCtx).state
    expect(selection.empty).toBe(true)
    expect(selection.from).toBe(doc.content.size - 1)
  }))

test('a document ending in a rule still opens with a caret', async () =>
  withInkKitEditor('A line.\n\n---\n', (editor) => {
    expect(ctxOf(editor).get(editorViewCtx).state.selection.empty).toBe(true)
  }))

test('a loaded document is not yet changed', async () =>
  withInkKitEditor('# Heading\n\nA line.\n', (editor) => {
    expect(editor.snapshot().dirty).toBe(false)
  }))

test('sequential block formatting toggles remain snapshot-safe without a final newline', async () =>
  withInkKitEditor('Selected words', (editor) => {
    for (const level of [1, 2, 3]) {
      editor.format('heading', level)
      expect(editor.snapshot().text).toBe(`${'#'.repeat(level)} Selected words`)
      editor.format('heading', level)
      expect(editor.snapshot().text).toBe('Selected words')
    }
    for (const [command, prefix] of [
      ['bulletList', '- '],
      ['orderedList', '1. '],
      ['quote', '> '],
    ] as const) {
      editor.format(command)
      const ctx = ctxOf(editor)
      const snapshot = editor.snapshot()
      expect(snapshot.text).toBe(prefix + 'Selected words')
      expect(ctx.get(parserCtx)(snapshot.text).firstChild!.type.name).toBe(
        ctx.get(editorViewCtx).state.doc.firstChild!.type.name,
      )
      editor.format(command)
      expect(editor.snapshot().text).toBe('Selected words')
    }
  }))

test('quote toggles rather than nesting', async () => {
  await withInkKitEditor('A line\n', (editor, states) => {
    placeCaret(editor, 2)
    const ctx = ctxOf(editor)
    editor.format('quote')
    expect(serialize(ctx)).toBe('> A line\n')
    expect(states.at(-1)?.quoted).toBe(true)
    expect(states.at(-1)?.block).toEqual({ type: 'paragraph' })
    editor.format('quote')
    expect(serialize(ctx)).toBe('A line\n')
    expect(states.at(-1)?.quoted).toBe(false)
  })
})

test('a list inside a quote reports both', async () => {
  await withInkKitEditor('> - item\n', (editor, states) => {
    placeCaret(editor, 4)
    expect(states.at(-1)?.quoted).toBe(true)
    expect(states.at(-1)?.block).toEqual({ type: 'bulletList' })
    editor.format('quote')
    expect(serialize(ctxOf(editor))).toBe('- item\n')
  })
})

test('quote wraps the whole list when the caret is in an item', async () => {
  await withInkKitEditor('- one\n- two\n', (editor, states) => {
    placeCaret(editor, 3)
    editor.format('quote')
    expect(serialize(ctxOf(editor))).toBe('> - one\n> - two\n')
    expect(states.at(-1)?.quoted).toBe(true)
    editor.format('quote')
    expect(serialize(ctxOf(editor))).toBe('- one\n- two\n')
  })
})

test('select all then quote toggles once', async () => {
  await withInkKitEditor('one\n\ntwo\n', (editor, states) => {
    const view = ctxOf(editor).get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    editor.format('quote')
    expect(serialize(ctxOf(editor))).toBe('> one\n>\n> two\n')
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    expect(states.at(-1)?.quoted).toBe(true)
    editor.format('quote')
    expect(serialize(ctxOf(editor))).toBe('one\n\ntwo\n')
  })
})

test('a selection reaching out of a quote is not reported as quoted', async () => {
  await withInkKitEditor('> one\n\ntwo\n', (editor, states) => {
    const view = ctxOf(editor).get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 9)),
    )
    expect(states.at(-1)?.quoted).toBe(false)
  })
})

test('inline code at a caret applies to what is typed next', async () => {
  await withInkKitEditor('A line\n', (editor, states) => {
    placeCaret(editor, 3)
    editor.format('code')
    expect(states.at(-1)?.marks).toEqual(['code'])
    const view = ctxOf(editor).get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('xy'))
    expect(serialize(ctxOf(editor))).toBe('A `xy`line\n')
    // The mark is not inclusive, so typing on leaves the code span.
    expect(states.at(-1)?.marks).toEqual([])
    placeCaret(editor, 4)
    expect(states.at(-1)?.marks).toEqual(['code'])
    editor.format('code')
    expect(serialize(ctxOf(editor))).toBe('A xyline\n')
  })
})

test('inline code toggled on and off again at a caret leaves nothing behind', async () => {
  await withInkKitEditor('A line\n', (editor, states) => {
    placeCaret(editor, 3)
    editor.format('code')
    editor.format('code')
    expect(states.at(-1)?.marks).toEqual([])
    const view = ctxOf(editor).get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('x'))
    expect(serialize(ctxOf(editor))).toBe('A xline\n')
  })
})

test('canceling a pending code mark leaves the span next to the caret alone', async () => {
  await withInkKitEditor('A `foo` b\n', (editor, states) => {
    placeCaret(editor, 6)
    editor.format('code')
    expect(states.at(-1)?.marks).toEqual(['code'])
    editor.format('code')
    expect(states.at(-1)?.marks).toEqual([])
    expect(serialize(ctxOf(editor))).toBe('A `foo` b\n')
  })
})

test('code off inside a span puts the caret back', async () => {
  await withInkKitEditor('A `foo` b\n', (editor) => {
    placeCaret(editor, 5)
    editor.format('code')
    expect(serialize(ctxOf(editor))).toBe('A foo b\n')
    const view = ctxOf(editor).get(editorViewCtx)
    expect(view.state.selection.empty).toBe(true)
    expect(view.state.selection.from).toBe(5)
  })
})

test('a list command toggles its own kind and converts the other', async () => {
  await withInkKitEditor('- one\n- two\n', (editor, states) => {
    placeCaret(editor, 3)
    expect(states.at(-1)?.block).toEqual({ type: 'bulletList' })
    editor.format('orderedList')
    expect(serialize(ctxOf(editor))).toBe('1. one\n2. two\n')
    expect(states.at(-1)?.block).toEqual({ type: 'orderedList' })
    editor.format('bulletList')
    expect(serialize(ctxOf(editor))).toBe('- one\n- two\n')
    editor.format('bulletList')
    expect(serialize(ctxOf(editor))).toBe('one\n\n- two\n')
    expect(states.at(-1)?.block).toEqual({ type: 'paragraph' })
  })
})

test('backspace at the start of a quote leaves it', async () => {
  await withInkKitEditor('> A line\n', (editor) => {
    placeCaret(editor, 2)
    const view = ctxOf(editor).get(editorViewCtx)
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      code: 'Backspace',
    })
    const handled = view.someProp('handleKeyDown', (handler) =>
      handler(view, event),
    )
    expect(handled).toBe(true)
    expect(serialize(ctxOf(editor))).toBe('A line\n')
  })
})

test('backspace at the start of a first list item that holds more lifts the whole item', async () => {
  const cases: [string, number, string][] = [
    ['- A\n  - a1\n- B\n', 3, 'A\n\n- a1\n- B\n'],
    ['Intro\n\n- A\n  - a1\n', 10, 'Intro\n\nA\n\n- a1\n'],
    ['- x\n  - A\n    - a1\n  - B\n', 8, '- x\n\n  A\n  - a1\n  - B\n'],
    ['1. A\n   1. a1\n2. B\n', 3, 'A\n\n1. a1\n2. B\n'],
    ['- [ ] A\n  - [ ] a1\n', 3, 'A\n\n- [ ] a1\n'],
    ['> - A\n>   - a1\n', 4, '> A\n>\n> - a1\n'],
    ['- A\n\n  ```\n  code\n  ```\n', 3, 'A\n\n```\ncode\n```\n'],
    ['- A\n\n  more\n- B\n', 3, 'A\n\nmore\n\n- B\n'],
    ['- A\n  1. a1\n- B\n', 3, 'A\n\n1. a1\n\n- B\n'],
  ]
  for (const [markdown, caret, expected] of cases) {
    await withInkKitEditor(markdown, (editor) => {
      placeCaret(editor, caret)
      const view = ctxOf(editor).get(editorViewCtx)
      expect(view.state.selection.$from.parent.textContent).toBe('A')
      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
      })
      expect(
        view.someProp('handleKeyDown', (handler) => handler(view, event)),
      ).toBe(true)
      expect(serialize(ctxOf(editor))).toBe(expected)
      const { $from } = view.state.selection
      expect([$from.parent.textContent, $from.parentOffset]).toEqual(['A', 0])
    })
  }
})

test('lifting a list item that holds a nested list leaves one list, not two', async () => {
  const cases: [string, number, string][] = [
    ['- A\n  - a1\n- B\n', 3, 'A\n\n- a1\n- B\n'],
    ['- x\n- A\n  - a1\n- B\n', 8, '- x\n\nA\n\n- a1\n- B\n'],
    ['- x\n  - A\n    - a1\n  - B\n', 8, '- x\n- A\n  - a1\n  - B\n'],
    ['1. A\n   1. a1\n2. B\n', 3, 'A\n\n1. a1\n2. B\n'],
    ['- [ ] A\n  - [ ] a1\n- [ ] B\n', 3, 'A\n\n- [ ] a1\n- [ ] B\n'],
    ['- A\n  1. a1\n- B\n', 3, 'A\n\n1. a1\n\n- B\n'],
    ['> - A\n>   - a1\n> - B\n', 4, '> A\n>\n> - a1\n> - B\n'],
  ]
  const lifts: [string, (editor: InkKitEditor) => void][] = [
    [
      'Shift-Tab',
      (editor) => {
        const view = ctxOf(editor).get(editorViewCtx)
        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
        })
        expect(
          view.someProp('handleKeyDown', (handler) => handler(view, event)),
        ).toBe(true)
      },
    ],
    [
      'the list command',
      (editor) => {
        const view = ctxOf(editor).get(editorViewCtx)
        const list = view.state.selection.$from.node(-2).type.name
        editor.format(list === 'ordered_list' ? 'orderedList' : 'bulletList')
      },
    ],
  ]
  for (const [name, lift] of lifts) {
    for (const [markdown, caret, expected] of cases) {
      // The list command on a task item turns it off as a task, not as a list.
      if (name === 'the list command' && markdown.includes('[ ]')) continue
      await withInkKitEditor(markdown, (editor) => {
        placeCaret(editor, caret)
        const view = ctxOf(editor).get(editorViewCtx)
        expect(view.state.selection.$from.parent.textContent).toBe('A')
        lift(editor)
        expect([name, serialize(ctxOf(editor))]).toEqual([name, expected])
        expect(view.state.selection.$from.parent.textContent).toBe('A')
      })
    }
  }
})

test('a fenced block with a known language is colored, one without stays plain', async () => {
  await withInkKitEditor(
    '```js\nconst x = 1\n```\n\n```\nplain\n```\n',
    (editor) => {
      const view = ctxOf(editor).get(editorViewCtx)
      const spans = view.dom.querySelectorAll('pre [class*="hljs-"]')
      expect(spans.length).toBeGreaterThan(0)
      expect(
        view.dom.querySelectorAll('pre')[1]?.querySelector('[class*="hljs-"]'),
      ).toBeNull()
      expect(serialize(ctxOf(editor))).toBe(
        '```js\nconst x = 1\n```\n\n```\nplain\n```\n',
      )
    },
  )
})

test('control characters typed into the document are dropped', async () => {
  await withInkKitEditor('Plan\n', (editor) => {
    const view = ctxOf(editor).get(editorViewCtx)
    placeCaret(editor, 1)
    const swallowed = view.someProp('handleTextInput', (handler) =>
      handler(view, 1, 1, '\u000e', () => view.state.tr),
    )
    expect(swallowed).toBe(true)
    const typed = view.someProp('handleTextInput', (handler) =>
      handler(view, 1, 1, 'a', () => view.state.tr),
    )
    expect(typed).not.toBe(true)
    expect(serialize(ctxOf(editor))).toBe('Plan\n')
  })
})

test('list items indent with Tab alone, leaving Mod-[ and Mod-] to the app', async () => {
  await withInkKitEditor('- one\n- two\n', (editor) => {
    placeCaret(editor, 9)
    const view = ctxOf(editor).get(editorViewCtx)
    const press = (key: string, init: KeyboardEventInit = {}) =>
      view.someProp('handleKeyDown', (f) =>
        f(view, new KeyboardEvent('keydown', { key, ...init })),
      )
    expect(press(']', { metaKey: true })).toBeFalsy()
    expect(press('Tab')).toBe(true)
    expect(serialize(ctxOf(editor))).toBe('- one\n  - two\n')
    expect(press('[', { metaKey: true })).toBeFalsy()
    expect(press('Tab', { shiftKey: true })).toBe(true)
    expect(serialize(ctxOf(editor))).toBe('- one\n- two\n')
  })
})

test('dropped paths become paragraphs after the block, or replace an empty one', async () => {
  await withInkKitEditor('- item\n\nText\n', (editor) => {
    placeCaret(editor, 3)
    // A point outside the (unlaid-out) page resolves to the caret.
    editor.insertPaths(['/a/b.txt', '/c d/e_f.pdf'], -100, -100)
    expect(serialize(ctxOf(editor))).toBe(
      '- item\n\n/a/b.txt\n\n/c d/e_f.pdf\n\nText\n',
    )
    const view = ctxOf(editor).get(editorViewCtx)
    expect(view.state.selection.$from.parent.textContent).toBe('/c d/e_f.pdf')
  })
  await withInkKitEditor('', (editor) => {
    editor.insertPaths(['/only'], -100, -100)
    expect(serialize(ctxOf(editor))).toBe('/only\n')
  })
})

test('formatting keys are the ones the app sets', async () => {
  await withInkKitEditor('word\n', (editor) => {
    const view = ctxOf(editor).get(editorViewCtx)
    const press = (key: string, init: KeyboardEventInit = {}) =>
      view.someProp('handleKeyDown', (f) =>
        f(view, new KeyboardEvent('keydown', { key, ...init })),
      )
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)),
    )
    // The preset's own Mod-b is gone until the app binds something.
    expect(press('b', { metaKey: true })).toBeFalsy()
    editor.setKeymap({
      bold: ['Mod-b'],
      heading2: ['Mod-Alt-2'],
      unknown: ['Mod-u'],
    })
    expect(press('b', { metaKey: true })).toBe(true)
    expect(serialize(ctxOf(editor))).toBe('**word**\n')
    expect(press('2', { metaKey: true, altKey: true })).toBe(true)
    expect(serialize(ctxOf(editor))).toBe('## **word**\n')
    expect(press('u', { metaKey: true })).toBeFalsy()
    editor.setKeymap({ bold: ['Mod-Shift-b'] })
    expect(press('b', { metaKey: true })).toBeFalsy()
  })
})

function paste(
  editor: InkKitEditor,
  data: Record<string, string>,
  files: File[] = [],
): boolean {
  const view = ctxOf(editor).get(editorViewCtx)
  const event = {
    clipboardData: {
      getData: (type: string) => data[type] ?? '',
      types: Object.keys(data),
      files,
    },
  } as unknown as ClipboardEvent
  return (
    view.someProp('handlePaste', (handler) =>
      handler(view, event, Slice.empty),
    ) ?? false
  )
}

test('pasting a url over a selection links what is selected', async () => {
  await withInkKitEditor('Read the notes\n', (editor) => {
    const view = ctxOf(editor).get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 10, 15)),
    )
    expect(paste(editor, { 'text/plain': 'https://example.com' })).toBe(true)
    expect(serialize(ctxOf(editor))).toBe(
      'Read the [notes](https://example.com)\n',
    )
  })
})

test('pasting a url with nothing selected links nothing', async () => {
  await withInkKitEditor('A line\n', (editor) => {
    placeCaret(editor, 3)
    paste(editor, { 'text/plain': 'https://example.com' })
    expect(serialize(ctxOf(editor))).not.toContain('](https://example.com)')
  })
})

test('a document changed under the caret keeps it where it was', async () => {
  await withInkKitEditor('One line here\n', (editor) => {
    placeCaret(editor, 5)
    editor.reloadDocument({
      documentId: 'test',
      format: 'md',
      text: 'One line here, and more\n',
      generation: 2,
    })
    const { selection } = ctxOf(editor).get(editorViewCtx).state
    expect(selection.from).toBe(5)
    expect(editor.snapshot().dirty).toBe(false)
  })
})

test('clearing find collapses the selection without editing text or undo history', async () =>
  withInkKitEditor('A searchable line.\n', (editor) => {
    const view = ctxOf(editor).get(editorViewCtx)
    editor.find('searchable')
    expect(getMatchHighlights(view.state).find().length).toBe(1)
    editor.find('')
    expect(getMatchHighlights(view.state).find()).toHaveLength(0)
    expect(view.state.selection.empty).toBe(true)
    expect(view.state.selection.from).toBe(13)
    expect(editor.snapshot().dirty).toBe(false)
  }))

test('find matches styled text, advances, wraps and clears a missing query', async () =>
  withInkKitEditor(
    'A **searchable** line. Another searchable line.\n',
    (editor) => {
      const view = ctxOf(editor).get(editorViewCtx)
      editor.find('SEARCHABLE')
      const first = view.state.selection.from
      expect(
        view.state.doc.textBetween(
          view.state.selection.from,
          view.state.selection.to,
        ),
      ).toBe('searchable')
      expect(getMatchHighlights(view.state).find()).toHaveLength(2)
      editor.find('SEARCHABLE')
      expect(view.state.selection.from).toBeGreaterThan(first)
      editor.find('SEARCHABLE')
      expect(view.state.selection.from).toBe(first)
      editor.find('missing')
      expect(getMatchHighlights(view.state).find()).toHaveLength(0)
      expect(view.state.selection.empty).toBe(true)
      expect(editor.snapshot().dirty).toBe(false)
    },
  ))

test('loading another document clears previous search highlights', async () =>
  withInkKitEditor('A line.\n', (editor) => {
    editor.find('line')
    editor.loadDocument({
      documentId: 'test',
      format: 'md',
      text: 'Another line.\n',
      generation: 2,
    })
    expect(
      getMatchHighlights(ctxOf(editor).get(editorViewCtx).state).find(),
    ).toHaveLength(0)
  }))

test('buffered typing keeps order and applies Markdown input rules', async () =>
  withInkKitEditor('', (editor) => {
    for (const text of ['#', ' ', 'I', 'm']) editor.insertText(text, 1)
    expect(editor.snapshot().text.trim()).toBe('# Im')
    expect(
      ctxOf(editor).get(editorViewCtx).state.selection.$from.parent.type.name,
    ).toBe('heading')
  }))

test('buffered text replaces the selection and rejects an old document', async () =>
  withInkKitEditor('Original', (editor) => {
    const view = ctxOf(editor).get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    editor.insertText('Replacement', 1)
    expect(editor.snapshot().text.trim()).toBe('Replacement')
    expect(() => editor.insertText('stale', 0)).toThrow('Document changed')
    expect(editor.snapshot().text.trim()).toBe('Replacement')
  }))

test('buffered input leaves active native composition untouched', async () =>
  withInkKitEditor('Original', (editor) => {
    const view = ctxOf(editor).get(editorViewCtx)
    Object.defineProperty(view, 'composing', { get: () => true })
    expect(editor.insertText('uncommitted', 1)).toBe(false)
    expect(editor.keyDown('Enter', '', false, false, false, false, 1)).toBe(
      false,
    )
    expect(() => editor.snapshot()).toThrow('Text composition is in progress')
  }))

test('authored spacing between list groups survives switching documents and reloading', async () => {
  await withInkKitEditor(
    '1. Example\n2. Another example\n\n- Another list\n- More items\n\n- [ ] Todo\n',
    (editor) => {
      const view = ctxOf(editor).get(editorViewCtx)
      const paragraph = view.state.schema.nodes.paragraph!
      const positions: number[] = []
      view.state.doc.forEach((_, offset, index) => {
        if (index > 0) positions.push(offset)
      })
      const transaction = view.state.tr
      for (const position of positions.reverse())
        transaction.insert(position, paragraph.create())
      view.dispatch(transaction)
      const authored = view.state.doc.toJSON()
      const saved = editor.snapshot().text
      expect(saved).toContain('<br />')
      editor.loadDocument({
        documentId: 'test',
        format: 'md',
        text: 'A different document.\n',
        generation: 2,
      })
      editor.loadDocument({
        documentId: 'test',
        format: 'md',
        text: saved,
        generation: 3,
      })
      expect(view.state.doc.toJSON()).toEqual(authored)
      expect(editor.snapshot().dirty).toBe(false)
      expect(editor.snapshot().text).toBe(saved)
      editor.reloadDocument({
        documentId: 'test',
        format: 'md',
        text: saved,
        generation: 3,
      })
      expect(view.state.doc.toJSON()).toEqual(authored)
    },
  )
})
