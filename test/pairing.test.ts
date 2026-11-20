import { ctxOf } from './editor-access'
import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  InkKitEditor,
  type TextInputPreferences,
  type WikiLinkAdapter,
} from '../src/index'
import { semanticSignature } from '../src/preserve'

// Bracket pairing and list continuation in formatted mode. The saved bytes are what matters: a
// sequence typed with pairing on must save what the same characters save with it off.

const generation = 1

interface Session {
  editor: InkKitEditor
  view: EditorView
  /** Types one character at a time, as keys do. */
  type(text: string): void
  /** Puts the caret after the first `text`, or at a document position. */
  caret(at: string | number): void
  /** Puts the caret at the end of the document. */
  end(): void
  /** Selects between two document positions. */
  range(from: number, to: number): void
  key(key: string, shiftKey?: boolean): boolean
  /** The text of the document with the selection marked by `|`, blocks apart by a line break. */
  shown(): string
  /** The saved text, after checking that it reopens as the same document. */
  save(): string
}

interface NoteOptions {
  textInput?: TextInputPreferences
  editable?: boolean
  wikiLinks?: WikiLinkAdapter
}

async function withNote(
  source: string,
  options: NoteOptions,
  run: (session: Session) => void | Promise<void>,
) {
  const root = document.createElement('div')
  const check = document.createElement('div')
  document.body.append(root, check)
  const errors: Error[] = []
  const handlers = {
    changed() {},
    copy() {},
    openLink() {},
    error: (error: Error) => errors.push(error),
  }
  const editor = await InkKitEditor.mount(root, handlers, options)
  const reader = await InkKitEditor.mount(check, handlers, {
    wikiLinks: options.wikiLinks,
  })
  const view = ctxOf(editor).get(editorViewCtx)
  const readerView = ctxOf(reader).get(editorViewCtx)
  let reads = 0
  const find = (text: string) => {
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text!.includes(text))
        at = pos + node.text!.indexOf(text) + text.length
      return at < 0
    })
    expect(at, text).toBeGreaterThanOrEqual(0)
    return at
  }
  try {
    // Markdown drops a space at the end of a note, so it is typed.
    const body = /^[^\n]*[^ \n]$|^$/.test(source) ? source : source.trimEnd()
    editor.loadDocument({
      documentId: 'pairing',
      generation,
      format: 'md',
      text: body,
    })
    if (body !== source)
      editor.insertText(source.slice(body.length), generation)
    await run({
      editor,
      view,
      type(text) {
        for (const character of text)
          expect(editor.insertText(character, generation)).toBe(true)
      },
      caret(at) {
        const position = typeof at === 'string' ? find(at) : at
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, position),
          ),
        )
      },
      end() {
        view.dispatch(
          view.state.tr.setSelection(Selection.atEnd(view.state.doc)),
        )
      },
      range(from, to) {
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, from, to),
          ),
        )
      },
      key: (key, shiftKey = false) =>
        editor.keyDown({ key, shiftKey }, generation),
      shown() {
        const { doc, selection } = view.state
        const read = (from: number, to: number) =>
          doc.textBetween(from, to, '\n', '￼')
        return selection.empty
          ? read(0, selection.from) +
              '|' +
              read(selection.from, doc.content.size)
          : read(0, selection.from) +
              '|' +
              read(selection.from, selection.to) +
              '|' +
              read(selection.to, doc.content.size)
      },
      save() {
        const saved = editor.snapshot().text
        reader.loadDocument({
          documentId: 'pairing',
          generation: ++reads,
          format: 'md',
          text: saved,
        })
        expect(reader.snapshot().text).toBe(saved)
        expect(semanticSignature(readerView.state.doc)).toEqual(
          semanticSignature(view.state.doc),
        )
        return saved
      },
    })
    expect(errors).toEqual([])
  } finally {
    await editor.destroy()
    await reader.destroy()
    root.remove()
    check.remove()
  }
}

const smart = { smartPunctuation: true }
const pairing = (
  source: string,
  run: (session: Session) => void | Promise<void>,
  extra: TextInputPreferences = {},
) => withNote(source, { textInput: { pairBrackets: true, ...extra } }, run)

describe('pairing in formatted mode', () => {
  for (const [opener, closer] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"],
  ] as const) {
    test(`${opener} inserts ${closer} with the caret between them`, () =>
      pairing('note ', ({ type, shown }) => {
        type(opener)
        expect(shown()).toBe(`note ${opener}|${closer}`)
        type('x')
        expect(shown()).toBe(`note ${opener}x|${closer}`)
      }))
  }

  test('is off unless the host turns it on', async () => {
    await withNote('a ', {}, ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('a (|')
    })
    await withNote(
      'a ',
      { textInput: { pairBrackets: false } },
      ({ type, shown }) => {
        type('"')
        expect(shown()).toBe('a "|')
      },
    )
  })

  test('pairs before the end of a line, white space and a closing bracket', async () => {
    await pairing('a b', ({ caret, type, shown }) => {
      caret(2)
      type('(')
      expect(shown()).toBe('a(|) b')
    })
    await pairing('(a)', ({ caret, type, shown }) => {
      caret(3)
      type('[')
      expect(shown()).toBe('(a[|])')
    })
  })

  test('pairs before a hard line break', () =>
    pairing('a  \nb', ({ caret, type, save }) => {
      caret(2)
      type('(')
      expect(save()).toBe('a()  \nb')
    }))

  test('does not pair before a word character, an opening bracket or another node', async () => {
    await pairing('xyz', ({ caret, type, shown }) => {
      caret(1)
      type('(')
      expect(shown()).toBe('(|xyz')
    })
    await pairing('x(y)', ({ caret, type, shown }) => {
      caret(1)
      type('[')
      expect(shown()).toBe('[|x(y)')
    })
    await pairing('😀', ({ caret, type, shown }) => {
      caret(1)
      type('(')
      expect(shown()).toBe('(|😀')
    })
  })

  test('a quote after a letter or digit stays single, so apostrophes work', async () => {
    await pairing('don', ({ type, shown }) => {
      type("'")
      expect(shown()).toBe("don'|")
    })
    await pairing('v2', ({ type, shown }) => {
      type('"')
      expect(shown()).toBe('v2"|')
    })
    await pairing('é', ({ type, shown }) => {
      type("'")
      expect(shown()).toBe("é'|")
    })
    await pairing('😀', ({ type, shown }) => {
      type('"')
      expect(shown()).toBe('😀"|"')
    })
    await pairing('a (', ({ type, shown }) => {
      type("'")
      expect(shown()).toBe("a ('|'")
    })
  })

  test('a selection on one line is wrapped and stays selected', async () => {
    await pairing('say hello now', ({ range, type, shown }) => {
      range(5, 10)
      type('(')
      expect(shown()).toBe('say (|hello|) now')
      type('"')
      expect(shown()).toBe('say ("|hello|") now')
    })
    await pairing('ab', ({ range, type, shown, save }) => {
      range(1, 3)
      type("'")
      expect(shown()).toBe("'|ab|'")
      expect(save()).toBe("'ab'")
    })
  })

  test('a selection across blocks is replaced, not wrapped', () =>
    pairing('ab\n\ncd', ({ range, type, shown }) => {
      range(2, 6)
      type('(')
      expect(shown()).toBe('a(|d')
    }))

  test('a selection that holds a hard break is replaced, not wrapped', () =>
    pairing('a  \nb', ({ range, type, save }) => {
      range(1, 4)
      type('(')
      expect(save()).toBe('(')
    }))

  test('a closer steps over the closer that pairing inserted', () =>
    pairing('', ({ type, shown, save }) => {
      type('(a)')
      expect(shown()).toBe('(a)|')
      expect(save()).toBe('(a)\n')
      type('["x"]')
      expect(shown()).toBe('(a)["x"]|')
      expect(save()).toBe('(a)\\["x"]\n')
    }))

  test('a closer that was loaded is not stepped over', () =>
    pairing('()', ({ caret, type, shown }) => {
      caret(2)
      type('x')
      type(')')
      expect(shown()).toBe('(x)|)')
    }))

  test('a closer typed after pairing was stepped over is a new one', () =>
    pairing('', ({ type, shown }) => {
      type('(a)')
      type(')')
      expect(shown()).toBe('(a))|')
    }))

  test('a closer that moved with edits before it is still stepped over', () =>
    pairing('', ({ type, caret, shown }) => {
      type('(x')
      caret(1)
      type('ab')
      expect(shown()).toBe('ab|(x)')
      caret(5)
      type(')')
      expect(shown()).toBe('ab(x)|')
    }))

  test('deleting the opener drops the pair, so its closer is not stepped over', () =>
    pairing('', ({ type, range, key, shown }) => {
      type('(')
      range(1, 2)
      expect(key('Backspace')).toBe(true)
      expect(shown()).toBe('|)')
      type(')')
      expect(shown()).toBe(')|)')
    }))

  test('Backspace between an empty pair removes both, and not after text', async () => {
    await pairing('', ({ type, key, shown }) => {
      type('(')
      expect(key('Backspace')).toBe(true)
      expect(shown()).toBe('|')
    })
    await pairing('', ({ type, key, shown }) => {
      type('(x')
      // Not an empty pair, so the key is the browser's.
      expect(key('Backspace')).toBe(false)
      expect(shown()).toBe('(x|)')
    })
    await pairing('()', ({ caret, key, shown }) => {
      // Loaded, not inserted by pairing, so the key is the browser's.
      caret(2)
      expect(key('Backspace')).toBe(false)
      expect(shown()).toBe('(|)')
    })
  })

  test('one typed pair, and one wrap, undo in one step', async () => {
    await pairing('a b', ({ type, editor, shown, save }) => {
      type('(')
      expect(save()).toBe('a b()')
      expect(editor.undo()).toBe(true)
      expect(shown()).toBe('a b|')
      expect(editor.redo()).toBe(true)
      expect(save()).toBe('a b()')
    })
    await pairing('a b c', ({ range, type, editor, save }) => {
      range(3, 4)
      type('[')
      expect(save()).toBe('a \\[b\\] c')
      expect(editor.undo()).toBe(true)
      expect(save()).toBe('a b c')
    })
  })
})

describe('pairing with smart punctuation', () => {
  test('a quote pairs as curly quotes, and the closing quote steps over', () =>
    pairing(
      '',
      ({ type, shown, save }) => {
        type('"')
        expect(shown()).toBe('“|”')
        type('hi')
        type('"')
        expect(shown()).toBe('“hi”|')
        expect(save()).toBe('“hi”\n')
      },
      smart,
    ))

  test('single quotes and nested quotes pair as curly quotes', () =>
    pairing(
      '',
      ({ type, shown, save }) => {
        type('"He said ')
        // Before the closing quote of the outer pair, so the inner one does not pair.
        type("'")
        expect(shown()).toBe('“He said ‘|”')
        type('hi\'"')
        expect(shown()).toBe('“He said ‘hi’”|')
        expect(save()).toBe('“He said ‘hi’”\n')
      },
      smart,
    ))

  test('an apostrophe and a closing quote after punctuation do not pair', async () => {
    await pairing(
      '',
      ({ type, shown }) => {
        type("don't")
        expect(shown()).toBe('don’t|')
      },
      smart,
    )
    await pairing(
      '',
      ({ type, shown }) => {
        type('Stop.')
        type('"')
        expect(shown()).toBe('Stop.”|')
      },
      smart,
    )
  })

  test('a selection is wrapped in curly quotes', () =>
    pairing(
      'say hello',
      ({ range, type, shown }) => {
        range(5, 10)
        type('"')
        expect(shown()).toBe('say “|hello|”')
      },
      smart,
    ))

  test('a curly pair undoes in one step', () =>
    pairing(
      'a b',
      ({ type, editor, shown }) => {
        type(' "')
        expect(shown()).toBe('a b “|”')
        expect(editor.undo()).toBe(true)
        expect(shown()).toBe('a b|')
      },
      smart,
    ))

  test('Backspace between an empty curly pair removes both quotes', () =>
    pairing(
      '',
      ({ type, key, shown }) => {
        type('"')
        expect(key('Backspace')).toBe(true)
        expect(shown()).toBe('|')
      },
      smart,
    ))

  test('a straight quote stays straight where smart punctuation does not apply', () =>
    pairing(
      '',
      ({ type, shown }) => {
        type('`a ')
        type('"')
        expect(shown()).toBe('`a "|"')
      },
      smart,
    ))
})

describe('pairing and the typed text that follows', () => {
  const sequences = [
    '[text](https://example.com)',
    '[text](https://example.com) after',
    '[a [b] c](d)',
    '[[name]]',
    'see [[name]] and [[other]]',
    '"quoted"',
    "don't",
    "it's a 'quoted' word",
    '"say \'hi\'"',
    '(a [b] {c})',
    '(😀 [🙂] "é")',
    '((()))',
    '**bold (x)** and _em [y]_',
    '`code (x)` text',
    '# Head (1)',
    '- item (a)\n- [ ] task [b]',
    '1. one (a)\n2. two',
    '> quote "q"',
    'a (b) c\n\nd [e] f',
    'x ( y ) z',
    '( )',
  ]
  const modes = [
    { name: 'plain', extra: {} },
    { name: 'smart punctuation', extra: smart },
  ]
  for (const { name, extra } of modes)
    for (const sequence of sequences)
      test(`${JSON.stringify(sequence)} saves the same bytes with pairing on and off (${name})`, async () => {
        const undoAndRedo = (editor: InkKitEditor) => {
          let steps = 0
          while (editor.undo() && steps++ < 200);
          const undone = editor.snapshot().text
          steps = 0
          while (editor.redo() && steps++ < 200);
          return { undone, redone: editor.snapshot().text }
        }
        let expected = ''
        await withNote('', { textInput: extra }, ({ type, save }) => {
          type(sequence)
          expected = save()
        })
        await pairing(
          '',
          ({ type, save, editor }) => {
            type(sequence)
            expect(save()).toBe(expected)
            expect(undoAndRedo(editor)).toEqual({
              undone: '',
              redone: expected,
            })
          },
          extra,
        )
      })

  test('the same bytes are saved inside an existing note, between its blocks', async () => {
    const note = 'First line\n\n- one\n- two\n\nLast words'
    const typed = '[a](b) (c) "d" it\'s'
    let expected = ''
    await withNote(note, {}, ({ caret, type, save }) => {
      caret('two')
      type(' ' + typed)
      expected = save()
    })
    await pairing(note, ({ caret, type, save }) => {
      caret('two')
      type(' ' + typed)
      expect(save()).toBe(expected)
    })
  })

  test('the [[ suggestions still open, and choosing a note saves the same link', async () => {
    const adapter: WikiLinkAdapter = {
      open() {},
      suggest: async () => ['Café'],
    }
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(
      root,
      { changed() {} },
      { wikiLinks: adapter, textInput: { pairBrackets: true } },
    )
    try {
      editor.loadDocument({
        documentId: 'wiki',
        generation: 1,
        format: 'md',
        text: '',
      })
      for (const character of 'see [[caf') editor.insertText(character, 1)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(root.querySelector('[role=option]')?.textContent).toBe('Café')
      expect(editor.keyDown({ key: 'Enter' }, 1)).toBe(true)
      expect(editor.snapshot().text).toBe('see [[Café]]\n')
    } finally {
      await editor.destroy()
      root.remove()
    }
  })

  test('typing a wiki link out turns it into a link, with the same bytes as without pairing', async () => {
    const wikiLinks: WikiLinkAdapter = { open() {} }
    const typed = 'go to [[Note one]] now'
    let expected = ''
    let links = 0
    await withNote('', { wikiLinks }, ({ type, save, view }) => {
      type(typed)
      expected = save()
      view.state.doc.descendants((node) => {
        if (node.type.name === 'inkkit_wiki_link') links++
      })
    })
    expect(links).toBe(1)
    await withNote(
      '',
      { wikiLinks, textInput: { pairBrackets: true } },
      ({ type, save, view }) => {
        type(typed)
        expect(save()).toBe(expected)
        let found = 0
        view.state.doc.descendants((node) => {
          if (node.type.name === 'inkkit_wiki_link') found++
        })
        expect(found).toBe(1)
      },
    )
  })

  test('the slash menu still opens', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(
      root,
      { changed() {} },
      { slashMenu: { enabled: true }, textInput: { pairBrackets: true } },
    )
    try {
      editor.loadDocument({
        documentId: 'slash',
        generation: 1,
        format: 'md',
        text: '',
      })
      editor.insertText('/', 1)
      expect(root.querySelector('[role=listbox]')).not.toBeNull()
    } finally {
      await editor.destroy()
      root.remove()
    }
  })

  test('a typed rule still applies after the opener, as with pairing off', () =>
    pairing('', ({ type, save }) => {
      type('# (a)')
      expect(save()).toBe('# (a)\n')
    }))
})

describe('pairing guards', () => {
  test('nothing pairs during composition', () =>
    pairing('a ', ({ view, editor, shown }) => {
      view.dom.dispatchEvent(new Event('compositionstart'))
      // The host's buffered typing is refused while composing.
      expect(editor.insertText('(', generation)).toBe(false)
      expect(shown()).toBe('a |')
      view.dom.dispatchEvent(new Event('compositionend'))
    }))

  test('a composition that commits a bracket is not paired', () =>
    pairing('a ', ({ view, shown }) => {
      view.dom.dispatchEvent(new Event('compositionstart'))
      view.dispatch(view.state.tr.insertText('(', 3).setMeta('composition', 1))
      view.dom.dispatchEvent(new Event('compositionend'))
      expect(shown()).toBe('a (|')
    }))

  test('nothing pairs in a read-only editor or for a stale generation', async () => {
    await withNote(
      'a b',
      { editable: false, textInput: { pairBrackets: true } },
      ({ editor, shown }) => {
        expect(() => editor.insertText('(', generation)).toThrow(
          expect.objectContaining({ code: 'read-only' }),
        )
        expect(shown()).toBe('a b|')
      },
    )
    await pairing('a b', ({ editor, shown }) => {
      expect(() => editor.insertText('(', generation + 1)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      expect(shown()).toBe('a b|')
    })
  })

  test('the preference can change while editing', () =>
    pairing('a ', ({ editor, type, shown }) => {
      editor.setTextInputPreferences({ pairBrackets: false })
      type('(')
      expect(shown()).toBe('a (|')
      editor.setTextInputPreferences({ pairBrackets: true })
      type('[')
      expect(shown()).toBe('a ([|]')
    }))

  test('a pair is not stepped over after the document is reloaded', async () => {
    await pairing('', ({ editor, type, shown }) => {
      type('(')
      editor.loadDocument({
        documentId: 'pairing',
        generation: 2,
        format: 'md',
        text: '()',
      })
      expect(editor.insertText(')', 2)).toBe(true)
      expect(shown()).toContain('))')
    })
  })
})

describe('Return in a list item with continueLists off', () => {
  const off = { continueLists: false }
  /** Presses Return with the caret after `after`, or at the end, then types `typed`. */
  const enter = (
    source: string,
    after: string | undefined,
    typed: string,
    expected: string,
    extra: TextInputPreferences = off,
  ) =>
    withNote(
      source,
      { textInput: extra },
      ({ caret, end, key, type, save }) => {
        if (after === undefined) end()
        else caret(after)
        expect(key('Enter')).toBe(true)
        type(typed)
        expect(save()).toBe(expected)
      },
    )

  test('adds a paragraph inside the same item', async () => {
    await enter('- a', undefined, 'b', '- a\n\n  b')
    await enter('* a', undefined, 'b', '* a\n\n  b')
    await enter('1. a', undefined, 'b', '1. a\n\n   b')
    await enter('- [ ] a', undefined, 'b', '- [ ] a\n\n  b')
    await enter('- [x] a', undefined, 'b', '- [x] a\n\n  b')
    await enter('- a\n- c', 'a', 'b', '- a\n\n  b\n- c')
  })

  test('splits the text at the caret into the same item', () =>
    enter('- abcd', 'ab', '', '- ab\n\n  cd'))

  test('works in a nested item, a quote and with CRLF', async () => {
    await enter('- a\n  - b', undefined, 'c', '- a\n  - b\n\n    c')
    await enter('> - a', undefined, 'b', '> - a\n>\n>   b')
    await enter('- a\r\n- c', 'a', 'b', '- a\r\n\r\n  b\r\n- c')
  })

  test('Return outside a list item is unchanged', () =>
    enter('text', undefined, 'b', 'text\n\nb\n'))

  test('Return in the empty paragraph that it added leaves the list', () =>
    withNote('- a', { textInput: off }, ({ end, key, type, save }) => {
      end()
      expect(key('Enter')).toBe(true)
      expect(key('Enter')).toBe(true)
      type('b')
      expect(save()).toBe('- a\n\nb\n')
    }))

  test('continues lists as before when it is on or omitted', async () => {
    await enter('- a', undefined, 'b', '- a\n- b', {})
    await enter('- a', undefined, 'b', '- a\n- b', { continueLists: true })
    await enter('1. a', undefined, 'b', '1. a\n2. b', {})
    await enter('- [x] a', undefined, 'b', '- [x] a\n- [ ] b', {})
    await enter('- a', undefined, 'b', '- a\n- b', { pairBrackets: true })
  })

  test('the preference can change while editing', () =>
    withNote('- a', {}, ({ editor, end, key, type, save }) => {
      end()
      editor.setTextInputPreferences({ continueLists: false })
      expect(key('Enter')).toBe(true)
      type('b')
      expect(save()).toBe('- a\n\n  b')
      editor.setTextInputPreferences({})
      expect(key('Enter')).toBe(true)
      type('c')
      expect(save()).toBe('- a\n\n  b\n- c')
    }))
})
