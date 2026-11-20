import { describe, expect, test } from 'vitest'
import {
  InkKitEditor,
  InkKitError,
  type DocumentInput,
  type TextInputPreferences,
} from '../src/index'

// Pairing, list continuation and indentation on the source and TXT surfaces. A test names the
// text with `|` for the caret, or two `|` for a selection, and reads the result the same way.

const generation = 5

interface Session {
  editor: InkKitEditor
  plain: HTMLTextAreaElement
  /** The saved text with the selection marked by `|`. */
  shown(): string
  /** Types one character at a time through the host's buffered typing. */
  type(text: string): void
  key(key: string, shiftKey?: boolean): boolean
  /** A key press reaching the textarea, as a browser delivers it. */
  press(key: string, init?: KeyboardEventInit): KeyboardEvent
  /** A typed character reaching the textarea, as a browser delivers it. */
  browserType(character: string): InputEvent
}

function mark(text: string): { text: string; from: number; to: number } {
  const first = text.indexOf('|')
  if (first < 0) return { text, from: text.length, to: text.length }
  const second = text.indexOf('|', first + 1)
  if (second < 0) return { text: text.replace('|', ''), from: first, to: first }
  return {
    text:
      text.slice(0, first) +
      text.slice(first + 1, second) +
      text.slice(second + 1),
    from: first,
    to: second - 1,
  }
}

async function withSource(
  text: string,
  options: {
    textInput?: TextInputPreferences
    format?: DocumentInput['format']
    editable?: boolean
    /** Loads the text with CRLF line endings. */
    crlf?: boolean
  },
  run: (session: Session) => void | Promise<void>,
) {
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
    { textInput: options.textInput, editable: options.editable },
  )
  const plain = root.querySelector('textarea')!
  const placed = mark(text)
  try {
    editor.loadDocument({
      documentId: 'typing-options',
      generation,
      format: options.format ?? 'md',
      text: options.crlf ? placed.text.replaceAll('\n', '\r\n') : placed.text,
    })
    if ((options.format ?? 'md') === 'md')
      editor.setEditingMode('source', generation)
    plain.setSelectionRange(placed.from, placed.to)
    await run({
      editor,
      plain,
      shown() {
        const saved = editor.snapshot().text.replace(/\r\n?/g, '\n')
        const { selectionStart: from, selectionEnd: to } = plain
        return from === to
          ? saved.slice(0, from) + '|' + saved.slice(from)
          : saved.slice(0, from) +
              '|' +
              saved.slice(from, to) +
              '|' +
              saved.slice(to)
      },
      type(characters) {
        for (const character of characters)
          expect(editor.insertText(character, generation)).toBe(true)
      },
      key(key, shiftKey = false) {
        return editor.keyDown({ key, shiftKey }, generation)
      },
      press(key, init = {}) {
        const event = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        })
        plain.dispatchEvent(event)
        return event
      },
      browserType(character) {
        const event = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: character,
        })
        plain.dispatchEvent(event)
        if (!event.defaultPrevented) {
          const { selectionStart: from, selectionEnd: to } = plain
          plain.value =
            plain.value.slice(0, from) + character + plain.value.slice(to)
          plain.setSelectionRange(
            from + character.length,
            from + character.length,
          )
          plain.dispatchEvent(
            new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
          )
        }
        return event
      },
    })
    expect(errors).toEqual([])
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const paired = { pairBrackets: true }
const withPairing = (
  text: string,
  run: (session: Session) => void | Promise<void>,
  format?: DocumentInput['format'],
) => withSource(text, { textInput: paired, format }, run)

describe('pairing brackets and quotes', () => {
  for (const [opener, closer] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"],
  ] as const) {
    test(`${opener} inserts ${closer} at the end of a line`, () =>
      withPairing('note |', ({ type, shown }) => {
        type(opener)
        expect(shown()).toBe(`note ${opener}|${closer}`)
      }))

    test(`${opener} inserts ${closer} in a browser keystroke and in TXT`, async () => {
      await withPairing('|', ({ browserType, shown }) => {
        expect(browserType(opener).defaultPrevented).toBe(true)
        expect(shown()).toBe(`${opener}|${closer}`)
      })
      await withPairing(
        '|',
        ({ type, shown }) => {
          type(opener)
          expect(shown()).toBe(`${opener}|${closer}`)
        },
        'txt',
      )
    })
  }

  test('pairing is off unless the host turns it on', async () => {
    await withSource('a |', {}, ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('a (|')
    })
    await withSource(
      'a |',
      { textInput: { pairBrackets: false } },
      ({ type, shown }) => {
        type('"')
        expect(shown()).toBe('a "|')
      },
    )
  })

  test('does not pair before a word character or an opening bracket', async () => {
    await withPairing('|word', ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('(|word')
    })
    await withPairing('|(x)', ({ type, shown }) => {
      type('[')
      expect(shown()).toBe('[|(x)')
    })
    await withPairing('|😀', ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('(|😀')
    })
  })

  test('pairs before a tab, a line break and a closing brace', async () => {
    await withPairing('|\tx', ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('(|)\tx')
    })
    await withPairing('|\nx', ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('(|)\nx')
    })
    await withPairing('{|}', ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('{(|)}')
    })
  })

  test('a quote after a letter or digit stays single, so apostrophes work', async () => {
    await withPairing('don|', ({ type, shown }) => {
      type("'")
      expect(shown()).toBe("don'|")
    })
    await withPairing('v2|', ({ type, shown }) => {
      type('"')
      expect(shown()).toBe('v2"|')
    })
    await withPairing('é|', ({ type, shown }) => {
      type("'")
      expect(shown()).toBe("é'|")
    })
    await withPairing('a (|', ({ type, shown }) => {
      type("'")
      expect(shown()).toBe("a ('|'")
    })
  })

  test('a quote after an emoji or punctuation pairs', async () => {
    await withPairing('😀|', ({ type, shown }) => {
      type('"')
      expect(shown()).toBe('😀"|"')
    })
  })

  test('a selection on one line is wrapped and stays selected', async () => {
    await withPairing('say |hello| now', ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('say (|hello|) now')
      type('"')
      expect(shown()).toBe('say ("|hello|") now')
    })
    await withPairing('|ab|', ({ type, shown }) => {
      type("'")
      expect(shown()).toBe("'|ab|'")
    })
  })

  test('a selection across lines is replaced, not wrapped', () =>
    withPairing('a|b\nc|d', ({ type, shown }) => {
      type('(')
      expect(shown()).toBe('a(|d')
    }))

  test('a closer steps over the closer that pairing inserted', () =>
    withPairing('|', ({ type, shown, editor }) => {
      type('(a)')
      expect(shown()).toBe('(a)|')
      expect(editor.snapshot().text).toBe('(a)')
      type('["x"]')
      expect(shown()).toBe('(a)["x"]|')
    }))

  test('a closer that was loaded, or typed before pairing was on, is not stepped over', () =>
    withPairing('(|)', ({ type, shown }) => {
      type('x')
      type(')')
      expect(shown()).toBe('(x)|)')
    }))

  test('a closer typed by the person is not stepped over after pairing closed it', () =>
    withPairing('|', ({ type, shown }) => {
      type('(a)')
      type(')')
      expect(shown()).toBe('(a))|')
    }))

  test('deleting the opener drops the pair, so its closer is not stepped over', () =>
    withPairing('|', ({ type, shown, plain, key }) => {
      type('(')
      plain.setSelectionRange(0, 1)
      expect(key('Delete')).toBe(true)
      expect(shown()).toBe('|)')
      type(')')
      expect(shown()).toBe(')|)')
    }))

  test('Backspace between an empty pair removes both, and not after text', async () => {
    await withPairing('|', ({ type, key, shown }) => {
      type('(')
      expect(key('Backspace')).toBe(true)
      expect(shown()).toBe('|')
    })
    await withPairing('|', ({ type, press, shown }) => {
      type('"')
      expect(press('Backspace').defaultPrevented).toBe(true)
      expect(shown()).toBe('|')
    })
    await withPairing('|', ({ type, key, shown }) => {
      type('(x')
      expect(key('Backspace')).toBe(true)
      expect(shown()).toBe('(|)')
    })
    await withPairing('(|)', ({ key, shown }) => {
      // Loaded, not inserted by pairing.
      expect(key('Backspace')).toBe(true)
      expect(shown()).toBe('|)')
    })
  })

  test('one typed pair, and one wrap, undo in one step', async () => {
    await withPairing('a |', ({ type, editor, shown }) => {
      type('(')
      expect(editor.undo()).toBe(true)
      expect(shown()).toBe('a |')
      expect(editor.redo()).toBe(true)
      expect(shown()).toBe('a (|)')
    })
    await withPairing('a |b| c', ({ type, editor, shown }) => {
      type('[')
      expect(editor.undo()).toBe(true)
      expect(shown()).toBe('a |b| c')
    })
  })

  test('the same bytes are saved with pairing on and off, and after undo and redo', async () => {
    const sequences = [
      '[text](https://example.com)',
      '[[name]]',
      '"quoted"',
      "don't",
      '(a [b] {c})',
      '(😀 [🙂] "é")',
      "it's a 'quoted' word",
      '"say \'hi\'"',
      '- [ ] (task)\n- two',
      'a\r\nb (c)',
      '((()))',
    ]
    for (const sequence of sequences)
      for (const format of ['md', 'txt'] as const) {
        let expected = ''
        await withSource('|', { format }, ({ type, editor }) => {
          type(sequence)
          expected = editor.snapshot().text
        })
        await withPairing(
          '|',
          ({ type, editor }) => {
            type(sequence)
            expect(editor.snapshot().text, sequence).toBe(expected)
            while (editor.undo());
            expect(editor.snapshot().text, sequence).toBe('')
            while (editor.redo());
            expect(editor.snapshot().text, sequence).toBe(expected)
          },
          format,
        )
      }
  })

  test('the same bytes are saved through browser keystrokes', async () => {
    const sequence = '[a](b) "c" (d [e] {f}) it\'s'
    let expected = ''
    await withSource('|', {}, ({ browserType, editor }) => {
      for (const character of sequence) browserType(character)
      expected = editor.snapshot().text
    })
    await withPairing('|', ({ browserType, editor }) => {
      for (const character of sequence) browserType(character)
      expect(editor.snapshot().text).toBe(expected)
    })
  })

  test('a CRLF document keeps its line endings', () =>
    withSource(
      'a\n|\nb',
      { textInput: paired, crlf: true },
      ({ type, editor }) => {
        type('(')
        expect(editor.snapshot().text).toBe('a\r\n()\r\nb')
      },
    ))

  test('nothing pairs during composition', () =>
    withPairing('a |', ({ plain, browserType, editor, shown }) => {
      plain.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      expect(editor.insertText('(', generation)).toBe(false)
      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertCompositionText',
        data: '(',
        isComposing: true,
      })
      plain.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      plain.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true }),
      )
      browserType('x')
      expect(shown()).toBe('a x|')
    }))

  test('nothing pairs in a read-only editor or for a stale generation', async () => {
    await withSource(
      'a |',
      { textInput: paired, editable: false },
      ({ editor, plain, browserType }) => {
        expect(() => editor.insertText('(', generation)).toThrow(InkKitError)
        expect(browserType('(').defaultPrevented).toBe(true)
        expect(plain.value).toBe('a ')
      },
    )
    await withPairing('a |', ({ editor, shown }) => {
      expect(() => editor.insertText('(', generation + 1)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      expect(() => editor.insertText('(', generation - 1)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      expect(shown()).toBe('a |')
    })
  })

  test('the preference can change while editing', () =>
    withPairing('a |', ({ editor, type, shown }) => {
      editor.setTextInputPreferences({ pairBrackets: false })
      type('(')
      expect(shown()).toBe('a (|')
      editor.setTextInputPreferences({ pairBrackets: true })
      type('[')
      expect(shown()).toBe('a ([|]')
    }))
})

describe('continuing lists in source mode', () => {
  const enter = (
    before: string,
    after: string,
    options?: Parameters<typeof withSource>[1],
  ) =>
    withSource(before, options ?? {}, ({ key, shown }) => {
      expect(key('Enter')).toBe(true)
      expect(shown()).toBe(after)
    })

  const continued: Array<[string, string, string]> = [
    ['a dash', '- a|', '- a\n- |'],
    ['an asterisk', '* a|', '* a\n* |'],
    ['a plus', '+ a|', '+ a\n+ |'],
    ['a number', '1. a|', '1. a\n2. |'],
    ['a number reaching two digits', '9. a|', '9. a\n10. |'],
    ['a number with a parenthesis', '1) a|', '1) a\n2) |'],
    ['a number with leading zeros', '09. a|', '09. a\n10. |'],
    ['a wide gap', '-   a|', '-   a\n-   |'],
    ['a checked task', '- [x] done|', '- [x] done\n- [ ] |'],
    ['an unchecked task', '- [ ] todo|', '- [ ] todo\n- [ ] |'],
    [
      'an uppercase checked task',
      '* [X] done|',
      '* [ ] |'.replace('* [ ] |', '* [X] done\n* [ ] |'),
    ],
    ['a task in a numbered list', '1. [x] done|', '1. [x] done\n2. [ ] |'],
    ['spaces of indentation', '  - a|', '  - a\n  - |'],
    ['a tab of indentation', '- a\n\t- b|', '- a\n\t- b\n\t- |'],
    ['a nested item after its parent', '- a\n  - b|', '- a\n  - b\n  - |'],
    ['a quoted item', '> - quoted|', '> - quoted\n> - |'],
    ['a nested quote', '> > 1. a|', '> > 1. a\n> > 2. |'],
    ['a quote without a space', '>- a|', '>- a\n>- |'],
    ['text in the middle of a line', '- ab|cd', '- ab\n- |cd'],
    ['a selection', '- a|bc|d', '- a\n- |d'],
    ['an item before more text', '- a|\n\nafter', '- a\n- |\n\nafter'],
    ['emoji and accents', '- 😀 é|', '- 😀 é\n- |'],
  ]
  for (const [name, before, after] of continued)
    test(`Return continues ${name}`, () => enter(before, after))

  const removed: Array<[string, string, string]> = [
    ['a dash item', '- |', '|'],
    ['a numbered item', '2. |', '|'],
    ['a task item', '- [ ] |', '|'],
    ['an indented item', '  - |', '|'],
    ['a quoted item', '> - |', '> |'],
    ['an item after another', '- a\n- |', '- a\n|'],
    ['an item with only spaces', '-   |', '|'],
  ]
  for (const [name, before, after] of removed)
    test(`Return in ${name} with no text removes its marker`, () =>
      enter(before, after))

  test('Return before the start of the item text adds a plain line', async () => {
    await enter('- |a', '- \n|a')
    await enter('|- a', '\n|- a')
    await enter('-| a', '-\n| a')
  })

  test('Return outside a list item adds a plain line', async () => {
    await enter('text|', 'text\n|')
    await enter('-x|', '-x\n|')
    await enter('1.5 apples|', '1.5 apples\n|')
    await enter('**bold**|', '**bold**\n|')
    await enter('- - -|', '- - -\n|')
    await enter('***|', '***\n|')
    await enter('Title\n-|', 'Title\n-\n|')
  })

  test('a number that cannot count up adds a plain line', () =>
    enter('999999999. a|', '999999999. a\n|'))

  const literal: Array<[string, string, string]> = [
    ['a backtick fence', '```\n- item|\n```', '```\n- item\n|\n```'],
    ['a tilde fence', '~~~\n- item|\n~~~', '~~~\n- item\n|\n~~~'],
    ['a fence with a language', '```md\n1. item|', '```md\n1. item\n|'],
    ['an unclosed fence', '```\n- item|', '```\n- item\n|'],
    [
      'a longer fence',
      '````\n```\n- item|\n```\n````',
      '````\n```\n- item\n|\n```\n````',
    ],
    [
      'an indented fence',
      '  ```\n  - item|\n  ```',
      '  ```\n  - item\n|\n  ```',
    ],
    [
      'a fence in a list item',
      '- ```\n  - x|\n  ```',
      '- ```\n  - x\n|\n  ```',
    ],
    ['a fence in a quote', '> ```\n> - x|\n> ```', '> ```\n> - x\n|\n> ```'],
    [
      'the line that opens a fence',
      '- ```js|\n  x\n  ```',
      '- ```js\n|\n  x\n  ```',
    ],
    ['an indented code block', 'text\n\n    - code|', 'text\n\n    - code\n|'],
    ['front matter', '---\n- tag|\n---', '---\n- tag\n|\n---'],
    ['an HTML comment', '<!--\n- hidden|\n-->', '<!--\n- hidden\n|\n-->'],
    ['a percent comment', '%%\n- hidden|\n%%', '%%\n- hidden\n|\n%%'],
  ]
  for (const [name, before, after] of literal)
    test(`Return does not continue inside ${name}`, () => enter(before, after))

  test('Return continues after a fence closes, and in a nested list after code', async () => {
    await enter('```\n- x\n```\n- item|', '```\n- x\n```\n- item\n- |')
    await enter('- a\n\n      code\n- b|', '- a\n\n      code\n- b\n- |')
    await enter(
      '    - not code in a list\n\n- a|',
      '    - not code in a list\n\n- a\n- |',
    )
    await enter('- a\n    - b|', '- a\n    - b\n    - |')
    await enter('Text\n    - lazy|', 'Text\n    - lazy\n|')
  })

  test('Return continues a list in a document with CRLF line endings', async () => {
    await withSource('- a|\n- b', { crlf: true }, ({ key, editor, shown }) => {
      expect(key('Enter')).toBe(true)
      expect(editor.snapshot().text).toBe('- a\r\n- \r\n- b')
      expect(shown()).toBe('- a\n- |\n- b')
    })
    await withSource('1. a|\nz', { crlf: true }, ({ key, editor }) => {
      expect(key('Enter')).toBe(true)
      expect(editor.snapshot().text).toBe('1. a\r\n2. \r\nz')
    })
    await withSource('z\n- |', { crlf: true }, ({ key, editor }) => {
      expect(key('Enter')).toBe(true)
      expect(editor.snapshot().text).toBe('z\r\n')
    })
    await withSource('text|\nz', { crlf: true }, ({ key, editor }) => {
      expect(key('Enter')).toBe(true)
      expect(editor.snapshot().text).toBe('text\r\n\r\nz')
    })
  })

  test('continueLists: false adds a literal line', async () => {
    await enter('- a|', '- a\n|', { textInput: { continueLists: false } })
    await enter('- |', '- \n|', { textInput: { continueLists: false } })
    await enter('1. a|', '1. a\n|', { textInput: { continueLists: false } })
  })

  test('a TXT document never continues a list', async () => {
    await enter('- a|', '- a\n|', { format: 'txt' })
    await enter('- |', '- \n|', { format: 'txt' })
  })

  test('a browser Return continues a list and leaves other lines to the browser', async () => {
    await withSource('- a|', {}, ({ press, shown }) => {
      expect(press('Enter').defaultPrevented).toBe(true)
      expect(shown()).toBe('- a\n- |')
    })
    await withSource('text|', {}, ({ press, shown }) => {
      expect(press('Enter').defaultPrevented).toBe(false)
      expect(shown()).toBe('text|')
    })
    await withSource(
      '- a|',
      { textInput: { continueLists: false } },
      ({ press }) => {
        expect(press('Enter').defaultPrevented).toBe(false)
      },
    )
    await withSource('- a|', { format: 'txt' }, ({ press }) => {
      expect(press('Enter').defaultPrevented).toBe(false)
    })
    await withSource('- a|', {}, ({ press, shown }) => {
      expect(press('Enter', { metaKey: true }).defaultPrevented).toBe(false)
      expect(shown()).toBe('- a|')
    })
  })

  test('a browser Return does nothing in a read-only editor', () =>
    withSource('- a|', { editable: false }, ({ press, plain }) => {
      expect(press('Enter').defaultPrevented).toBe(false)
      expect(plain.value).toBe('- a')
    }))

  test('a continued item undoes in one step and saves reopened bytes', () =>
    withSource('- a|', {}, ({ key, editor, shown }) => {
      expect(key('Enter')).toBe(true)
      expect(editor.snapshot().text).toBe('- a\n- ')
      expect(editor.undo()).toBe(true)
      expect(shown()).toBe('- a|')
      expect(editor.redo()).toBe(true)
      expect(editor.snapshot().text).toBe('- a\n- ')
    }))

  test('Return does not continue while composing', () =>
    withSource('- a|', {}, ({ plain, press }) => {
      plain.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      expect(press('Enter').defaultPrevented).toBe(false)
      expect(plain.value).toBe('- a')
    }))
})

describe('indenting in source and TXT modes', () => {
  const tab = (
    before: string,
    after: string,
    options: Parameters<typeof withSource>[1] = {},
    shift = false,
  ) =>
    withSource(before, options, ({ key, shown }) => {
      expect(key('Tab', shift)).toBe(true)
      expect(shown()).toBe(after)
    })
  const spaces = (indentWidth: number) => ({
    textInput: { indent: 'spaces' as const, indentWidth },
  })

  test('Tab inserts one indent at the caret', async () => {
    await tab('ab|', 'ab\t|')
    await tab('a|b', 'a\t|b')
    await tab('ab|', 'ab    |', spaces(4))
    await tab('ab|', 'ab  |', spaces(2))
    await tab('ab|', 'ab        |', spaces(8))
    await tab('ab|', 'ab |', spaces(1))
    await tab('ab|', 'ab    |', { textInput: { indent: 'spaces' } })
    await tab('ab|', 'ab\t|', { textInput: { indent: 'tab', indentWidth: 2 } })
  })

  test('Tab replaces a selection within one line, as a typed character does', () =>
    tab('a|bc|d', 'a\t|d'))

  test('Tab indents each line of a selection across lines', async () => {
    await tab('|a\nb\nc|', '|\ta\n\tb\n\tc|')
    await tab('a|b\nc|d', '\ta|b\n\tc|d')
    await tab('|a\nb\nc|', '|  a\n  b\n  c|', spaces(2))
    await tab('|a\n\nc|', '|\ta\n\n\tc|')
    await tab('|a\nb\n|c', '|\ta\n\tb\n|c')
    await tab('|a\n|b', '|\ta\n|b')
    await tab('|a\n|b', '|  a\n|b', spaces(2))
    await tab('|\ta\n b|', '|\t\ta\n\t b|')
  })

  test('Tab indents the whole line of a Markdown list item', async () => {
    await tab('- a|', '\t- a|')
    await tab('- |a', '\t- |a')
    await tab('- a|', '    - a|', spaces(4))
    await tab('1. a|', '  1. a|', spaces(2))
    await tab('  - a|', '\t  - a|')
    await tab('- [ ] a|', '\t- [ ] a|')
    await tab('> - a|', '> \t- a|')
    await tab('- a|b|', '\t- a|b|')
    await tab('- a\n- b|', '- a\n\t- b|')
  })

  test('Tab inserts at the caret in code, in text and in a TXT list', async () => {
    await tab('```\n- a|\n```', '```\n- a\t|\n```')
    await tab('text|', 'text\t|')
    await tab('- a|', '- a\t|', { format: 'txt' })
    await tab('|a\nb|', '|\ta\n\tb|', { format: 'txt' })
  })

  test('Shift-Tab removes one indent from the line of the caret', async () => {
    await tab('\tab|', 'ab|', {}, true)
    await tab('\ta|b', 'a|b', {}, true)
    await tab('\t\tab|', '\tab|', {}, true)
    await tab('    ab|', 'ab|', {}, true)
    await tab('      ab|', '  ab|', {}, true)
    await tab('  ab|', 'ab|', {}, true)
    await tab('  ab|', 'ab|', spaces(4), true)
    await tab('    ab|', '  ab|', spaces(2), true)
    await tab('\tab|', 'ab|', spaces(4), true)
    await tab('  \tab|', '\tab|', {}, true)
    await tab('\t- a|', '- a|', {}, true)
    await tab('> \t- a|', '> - a|', {}, true)
    await tab('\tab|', 'ab|', { format: 'txt' }, true)
  })

  test('Shift-Tab keeps the caret in place relative to the text', async () => {
    await tab('\t|ab', '|ab', {}, true)
    await tab('  a|b', 'a|b', spaces(4), true)
    await tab('   |ab', '|ab', spaces(2).textInput && {}, true)
  })

  test('Shift-Tab outdents each selected line', async () => {
    await tab('|\ta\n\t\tb\nc|', '|a\n\tb\nc|', {}, true)
    await tab('|  a\n    b|', '|a\n  b|', spaces(2), true)
    await tab('|\ta\n\tb\n|\tc', '|a\nb\n|\tc', {}, true)
  })

  test('Shift-Tab on a line with no indent changes nothing and reports nothing', () =>
    withSource('ab|', {}, ({ key, editor, shown }) => {
      const before = editor.snapshot()
      expect(key('Tab', true)).toBe(true)
      expect(shown()).toBe('ab|')
      expect(editor.snapshot()).toEqual(before)
      expect(editor.undo()).toBe(false)
    }))

  test('Tab and Shift-Tab keep a CRLF document in CRLF', async () => {
    await withSource('|a\nb|', { crlf: true }, ({ key, editor }) => {
      expect(key('Tab')).toBe(true)
      expect(editor.snapshot().text).toBe('\ta\r\n\tb')
      expect(key('Tab', true)).toBe(true)
      expect(editor.snapshot().text).toBe('a\r\nb')
    })
  })

  test('one Tab undoes in one step, apart from the typing before it', () =>
    withSource('|', {}, ({ type, key, editor, shown }) => {
      type('x')
      expect(key('Tab')).toBe(true)
      type('y')
      expect(editor.snapshot().text).toBe('x\ty')
      expect(editor.undo()).toBe(true)
      expect(shown()).toBe('x\t|')
      expect(editor.undo()).toBe(true)
      expect(shown()).toBe('x|')
    }))

  test('a Tab on a list item undoes in one step', () =>
    withSource('- a\n- b|', {}, ({ key, editor, shown }) => {
      expect(key('Tab')).toBe(true)
      expect(editor.snapshot().text).toBe('- a\n\t- b')
      expect(editor.undo()).toBe(true)
      expect(shown()).toBe('- a\n- b|')
    }))

  test('a browser Tab keeps moving focus until the host chooses an indent', async () => {
    await withSource('ab|', {}, ({ press, shown }) => {
      expect(press('Tab').defaultPrevented).toBe(false)
      expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false)
      expect(shown()).toBe('ab|')
    })
    await withSource('ab|', spaces(2), ({ press, shown }) => {
      expect(press('Tab').defaultPrevented).toBe(true)
      expect(shown()).toBe('ab  |')
    })
    await withSource('  ab|', spaces(2), ({ press, shown }) => {
      expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true)
      expect(shown()).toBe('ab|')
    })
    await withSource(
      '- a|',
      { textInput: { indent: 'tab' } },
      ({ press, shown }) => {
        expect(press('Tab').defaultPrevented).toBe(true)
        expect(shown()).toBe('\t- a|')
      },
    )
  })

  test('a browser Tab does nothing in a read-only editor', () =>
    withSource('ab|', { ...spaces(2), editable: false }, ({ press, plain }) => {
      expect(press('Tab').defaultPrevented).toBe(false)
      expect(plain.value).toBe('ab')
    }))

  test('formatted mode still nests and lifts list items with Tab', async () => {
    await withSource('- a\n- b', { format: 'md' }, ({ editor }) => {
      editor.setEditingMode('formatted', generation)
      editor.setTextInputPreferences({ indent: 'spaces', indentWidth: 2 })
      expect(editor.keyDown({ key: 'Tab' }, generation)).toBe(true)
      expect(editor.snapshot().text).toBe('- a\n  - b')
      expect(editor.keyDown({ key: 'Tab', shiftKey: true }, generation)).toBe(
        true,
      )
      expect(editor.snapshot().text).toBe('- a\n- b')
    })
  })
})

describe('typing preferences', () => {
  const invalid = (preferences: unknown) =>
    withSource('a', {}, ({ editor }) => {
      expect(() =>
        editor.setTextInputPreferences(preferences as TextInputPreferences),
      ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
    })

  test('an invalid indent or indent width is refused like the other preferences', async () => {
    for (const bad of [
      { indentWidth: 0 },
      { indentWidth: 9 },
      { indentWidth: 2.5 },
      { indentWidth: '4' },
      { indentWidth: Number.NaN },
      { indentWidth: -1 },
      { indent: 'both' },
      { indent: 'Tab' },
      { indent: 4 },
      { pairBrackets: 'yes' },
      { continueLists: 1 },
    ])
      await invalid(bad)
  })

  test('mount refuses the same values', async () => {
    for (const textInput of [
      { indentWidth: 0 },
      { indentWidth: 9 },
      { indent: 'both' },
      { pairBrackets: 1 },
      { continueLists: 'no' },
    ]) {
      const root = document.createElement('div')
      document.body.append(root)
      await expect(
        InkKitEditor.mount(
          root,
          { changed() {} },
          {
            textInput: textInput as TextInputPreferences,
          },
        ),
      ).rejects.toMatchObject({ code: 'invalid-argument' })
      root.remove()
    }
  })

  test('the preferences replace one another and omitted fields take their defaults', () =>
    withSource(
      '- a|\nz',
      { textInput: { continueLists: false, indent: 'spaces', indentWidth: 2 } },
      ({ editor, key, shown, plain }) => {
        expect(key('Enter')).toBe(true)
        expect(shown()).toBe('- a\n|\nz')
        editor.setTextInputPreferences({ indentWidth: 8 })
        plain.setSelectionRange(3, 3)
        expect(key('Enter')).toBe(true)
        expect(shown()).toBe('- a\n- |\n\nz')
        expect(key('Tab')).toBe(true)
        expect(shown()).toBe('- a\n\t- |\n\nz')
      },
    ))
})
