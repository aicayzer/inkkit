import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, InkKitError, type DocumentInput } from '../src/index'
import { semanticSignature } from '../src/preserve'

// Smart punctuation turns the quote or dash being typed into a curly quote or
// a dash. It is off by default and applies to nothing already in the note.

interface Session {
  editor: InkKitEditor
  view: EditorView
  /** Types one character at a time, as keys do. */
  type(text: string): void
  /** Puts the caret after the first `text`, or at the document's end. */
  caret(text?: string): void
  /** Saves, then checks that the saved text reopens as the same document. */
  save(): string
}

async function withNote(
  source: string,
  options: { smart?: boolean; format?: DocumentInput['format'] },
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
  const editor = await InkKitEditor.mount(root, handlers, {
    textInput: options.smart ? { smartPunctuation: true } : undefined,
  })
  const reader = await InkKitEditor.mount(check, handlers)
  const format = options.format ?? 'md'
  const view = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
    editorViewCtx,
  )
  const readerView = (
    reader as unknown as { editor: { ctx: Ctx } }
  ).editor.ctx.get(editorViewCtx)
  let reads = 0
  try {
    editor.loadDocument({
      documentId: 'smart',
      generation: 1,
      format,
      text: source,
    })
    await run({
      editor,
      view,
      type(text) {
        for (const character of text)
          expect(editor.insertText(character, 1)).toBe(true)
      },
      caret(text) {
        let at = view.state.doc.content.size - 1
        if (text !== undefined) {
          at = -1
          view.state.doc.descendants((node, pos) => {
            if (at < 0 && node.isText && node.text!.includes(text))
              at = pos + node.text!.indexOf(text) + text.length
            return at < 0
          })
          expect(at, text).toBeGreaterThanOrEqual(0)
        }
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
        )
      },
      save() {
        const saved = editor.snapshot().text
        reader.loadDocument({
          documentId: 'smart',
          generation: ++reads,
          format,
          text: saved,
        })
        expect(reader.snapshot().text).toBe(saved)
        if (format === 'md')
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

const smart = (
  source: string,
  run: (session: Session) => void | Promise<void>,
) => withNote(source, { smart: true }, run)

describe('quotes', () => {
  const cases: [string, string, string][] = [
    ['double quotes around a word', 'He said "hi" there', 'He said “hi” there'],
    ['a double quote at the start of the text', '"Hi" said he', '“Hi” said he'],
    ['a double quote after an opening bracket', '("hi")', '(“hi”)'],
    ['a double quote after a dash', 'a—"hi"', 'a—“hi”'],
    ['single quotes around a word', "Say 'hi' now", 'Say ‘hi’ now'],
    ['an apostrophe between letters', "it's", 'it’s'],
    ['an apostrophe after a plural', "the dogs' bowls", 'the dogs’ bowls'],
    ['nested quotes', `"He said 'hi'"`, '“He said ‘hi’”'],
    ['a quote after a number', '5" wide', '5” wide'],
  ]
  for (const [name, typed, written] of cases)
    test(`on: ${name}`, () =>
      smart('', (s) => {
        s.type(typed)
        expect(s.save()).toBe(`${written}\n`)
      }))

  test('off: the same typing stays straight, and so does the default', async () => {
    for (const options of [{}, { smart: false }])
      await withNote('', options, (s) => {
        s.type(`He said "hi" and it's 'fine'`)
        expect(s.save()).toBe(`He said "hi" and it's 'fine'\n`)
      })
    const root = document.createElement('div')
    document.body.append(root)
    const editor = await InkKitEditor.mount(
      root,
      { changed() {}, copy() {}, openLink() {} },
      { textInput: { smartPunctuation: false } },
    )
    editor.loadDocument({
      documentId: 'x',
      generation: 1,
      format: 'md',
      text: '',
    })
    editor.insertText('"', 1)
    expect(editor.snapshot().text).toBe('"\n')
    await editor.destroy()
    root.remove()
  })

  test('a quote after a line break opens', () =>
    smart('first', (s) => {
      s.caret()
      expect(s.editor.insertText('\n', 1)).toBe(true)
    }))

  test('a quote typed in the middle of a note changes only that character', () =>
    smart(`He said "hi" and left\n`, (s) => {
      s.caret('and ')
      s.type('"')
      expect(s.save()).toBe(`He said "hi" and “left\n`)
    }))

  test('a quote in bold and emphasis follows the text before it', () =>
    smart('**bold** and *it*', (s) => {
      s.caret()
      s.type(`'s "x"`)
      expect(s.save()).toBe('**bold** and *it’s “x”*')
    }))

  test('a quote after text that ends a mark closes', () =>
    smart('**bold** and *it* ok', (s) => {
      s.caret('ok')
      s.type(`"`)
      expect(s.save()).toBe('**bold** and *it* ok”')
      s.caret('bold')
      s.type(`"`)
      expect(s.save()).toBe('**bold”** and *it* ok”')
    }))

  test('a quote in a heading, list, quote and callout', () =>
    smart('# Title\n\n- item\n\n> quote\n\n> [!note] Note\n> body\n', (s) => {
      s.caret('Title')
      s.type(` "a"`)
      s.caret('item')
      s.type(` "b"`)
      s.caret('quote')
      s.type(` "c"`)
      s.caret('body')
      s.type(` "d"`)
      expect(s.save()).toBe(
        '# Title “a”\n\n- item “b”\n\n> quote “c”\n\n> [!note] Note\n> body “d”\n',
      )
    }))

  test('a quote in a table cell', () =>
    smart('| a | b |\n| - | - |\n| x | y |\n', (s) => {
      s.caret('x')
      s.type(` "q"`)
      expect(s.save()).toBe('| a | b |\n| - | - |\n| x “q” | y |\n')
    }))

  test('a chunk of text ending in a quote opens or closes it', () =>
    smart('', (s) => {
      expect(s.editor.insertText('say "', 1)).toBe(true)
      expect(s.editor.insertText('hi"', 1)).toBe(true)
      expect(s.save()).toBe('say “hi”\n')
    }))
})

describe('dashes', () => {
  test('two hyphens give an en dash and three give an em dash', () =>
    smart('', (s) => {
      s.type('a -- b and c --- d and e--f and g---h')
      expect(s.save()).toBe('a – b and c — d and e–f and g—h\n')
    }))

  test('off: hyphens stay as typed', () =>
    withNote('', {}, (s) => {
      s.type('a -- b --- c')
      expect(s.save()).toBe('a -- b --- c\n')
    }))

  test('--- on an empty line is still a divider, and never an em dash', () =>
    smart('', (s) => {
      s.type('---')
      expect(s.view.state.doc.firstChild?.type.name).toBe('hr')
      expect(s.save()).toBe('---\n')
    }))

  test('--- on an empty line after text is still a divider', () =>
    smart('before', (s) => {
      s.caret()
      s.editor.keyDown({ key: 'Enter', code: 'Enter' }, 1)
      s.type('---')
      expect(s.save()).toBe('before\n\n---\n')
    }))

  test('-- at the start of a line stays as typed, so that a third hyphen makes the divider', () =>
    smart('', (s) => {
      s.type('--')
      expect(s.view.state.doc.textContent).toBe('--')
      s.type(' x')
      expect(s.view.state.doc.textContent).toBe('-- x')
    }))

  test('--- in a list item or quote at the start of a line is a divider as today', () =>
    smart('> quote\n', (s) => {
      s.caret()
      s.editor.keyDown({ key: 'Enter', code: 'Enter' }, 1)
      s.type('---')
      expect(s.save()).not.toMatch(/[–—]/)
    }))

  test('a further hyphen after an em dash is left as typed', () =>
    smart('', (s) => {
      s.type('a ----')
      expect(s.save()).toBe('a —-\n')
    }))

  test('a hyphen after an en dash that was already in the note stays a hyphen', () =>
    smart('2020–\n', (s) => {
      s.caret()
      s.type('-')
      expect(s.save()).toBe('2020–-\n')
    }))

  test('--- typed after existing hyphens is left alone', () =>
    smart('a --\n', (s) => {
      s.caret()
      s.type('-')
      expect(s.save()).toBe('a ---\n')
    }))

  test('a dash in a heading, list item and table cell', () =>
    smart('# Title\n\n- item\n\n| a |\n| - |\n| cell |\n', (s) => {
      s.caret('Title')
      s.type(' -- x')
      s.caret('item')
      s.type(' --- y')
      s.caret('cell')
      s.type(' -- z')
      expect(s.save()).toBe(
        '# Title – x\n\n- item — y\n\n| a |\n| - |\n| cell – z |\n',
      )
    }))

  test('a typed table row is left alone', () =>
    smart('', (s) => {
      s.type('| a | b |')
      s.editor.keyDown({ key: 'Enter', code: 'Enter' }, 1)
      s.type('| -- | -- |')
      expect(s.save()).not.toMatch(/[–—]/)
    }))

  test('a chunk ending in --', () =>
    smart('a', (s) => {
      s.caret()
      expect(s.editor.insertText(' --', 1)).toBe(true)
      expect(s.save()).toBe('a –')
    }))
})

describe('where it never applies', () => {
  test('inside inline code, including code about to be typed', () =>
    smart('Use `a b` here', (s) => {
      s.caret('a ')
      s.type(`"it's" -- ---`)
      expect(s.save()).toBe('Use `a "it\'s" -- ---b` here')
    }))

  test('after the code format is switched on at a caret', () =>
    smart('Use', (s) => {
      s.caret()
      expect(s.editor.format('code')).toBe(true)
      s.type(`"`)
      expect(s.view.state.doc.textContent).toBe('Use"')
    }))

  test('inside a backtick pair that is still open', () =>
    smart('', (s) => {
      s.type('x `it\'s "y" -- z')
      expect(s.view.state.doc.textContent).toBe('x `it\'s "y" -- z')
    }))

  test('in a code block', () =>
    smart('```\ncode\n```\n', (s) => {
      s.caret('code')
      s.type(` "a" it's -- ---`)
      expect(s.save()).toBe('```\ncode "a" it\'s -- ---\n```\n')
    }))

  test('in front matter', () =>
    smart('---\ntitle: x\n---\n\nBody\n', (s) => {
      s.caret('title: x')
      s.type(` "a" it's -- ---`)
      expect(s.save()).toBe('---\ntitle: x "a" it\'s -- ---\n---\n\nBody\n')
    }))

  test('--- typed on the first line of a note is a divider, not front matter or a dash', () =>
    smart('', (s) => {
      s.type('---')
      expect(s.save()).not.toMatch(/[–—]/)
    }))

  test('in a link destination and before its title', () =>
    smart('', (s) => {
      s.type(`[a](some it's -- file "t`)
      expect(s.view.state.doc.textContent).toBe(`[a](some it's -- file "t`)
    }))

  test('after the destination is closed, typing is smart again', () =>
    smart('', (s) => {
      s.type(`[a](b) it's`)
      expect(s.view.state.doc.textContent).toBe('[a](b) it’s')
    }))

  test('in the text of a link', () =>
    smart('[a link](http://example.com/)', (s) => {
      s.caret('a link')
      s.type(` "x"`)
      expect(s.save()).toBe('[a link “x”](http://example.com/)')
    }))

  test('in a web address being typed', () =>
    smart('', (s) => {
      s.type(`see https://example.com/it's--a"b`)
      expect(s.view.state.doc.textContent).toBe(
        `see https://example.com/it's--a"b`,
      )
      s.type(` it's`)
      expect(s.view.state.doc.textContent).toBe(
        `see https://example.com/it's--a"b it’s`,
      )
    }))

  test('in an autolink in angle brackets', () =>
    smart('', (s) => {
      s.type(`<https://example.com/a--b'c>`)
      expect(s.view.state.doc.textContent).toBe(`<https://example.com/a--b'c>`)
    }))

  test('in a wiki link and a footnote label', () =>
    smart('', (s) => {
      s.type(`[[it's -- a "note"]] and [^it's]`)
      expect(s.view.state.doc.textContent).toBe(
        `[[it's -- a "note"]] and [^it's]`,
      )
    }))

  test('in a tag or comment being typed', () =>
    smart('', (s) => {
      s.type(`<div class="x"> and <!-- c -- d -->`)
      expect(s.view.state.doc.textContent).toBe(
        `<div class="x"> and <!-- c -- d -->`,
      )
    }))

  test('in a reference definition', () =>
    smart('', (s) => {
      s.type(`[ref]: somewhere "it's -- fine"`)
      expect(s.view.state.doc.textContent).toBe(
        `[ref]: somewhere "it's -- fine"`,
      )
    }))

  test('in source view and in a TXT note', async () => {
    await smart('Plain', (s) => {
      s.editor.setEditingMode('source', 1)
      s.editor.insertText(` "a" it's -- ---`, 1)
      expect(s.editor.snapshot().text).toBe(`Plain "a" it's -- ---`)
    })
    await withNote('Plain', { smart: true, format: 'txt' }, (s) => {
      s.editor.insertText(` "a" it's -- ---`, 1)
      expect(s.editor.snapshot().text).toBe(`Plain "a" it's -- ---`)
    })
  })

  test('on text already in the note', () =>
    smart('He said "hi" and it\'s -- fine --- really\n', (s) => {
      expect(s.save()).toBe('He said "hi" and it\'s -- fine --- really\n')
      s.caret('He')
      s.type('y')
      expect(s.save()).toBe('Hey said "hi" and it\'s -- fine --- really\n')
    }))

  test('in a literal block the editor cannot format', () =>
    smart('<span>x</span> text\n\n[x]: y\n\n[a][missing]\n', (s) => {
      const before = s.editor.snapshot().text
      expect(before).toContain('[a][missing]')
      s.caret('[a][missing')
      s.type(` "q" it's -- ---`)
      expect(s.save()).toContain('[a][missing "q" it\'s -- ---]')
    }))
})

describe('untidy input', () => {
  test('a note with CRLF line endings keeps them', () =>
    smart('one\r\ntwo\r\n', (s) => {
      s.caret('two')
      s.type(` "x" it's --`)
      expect(s.save()).toBe('one\r\ntwo “x” it’s –\r\n')
    }))

  test('the end of a composition leaves a quote or dashes already typed alone', async () => {
    await smart('say', async (s) => {
      s.caret()
      s.editor.setTextInputPreferences({ smartPunctuation: false })
      s.type(' "--')
      s.editor.setTextInputPreferences({ smartPunctuation: true })
      s.view.dom.dispatchEvent(new Event('compositionend'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(s.save()).toBe('say "--')
    })
  })

  test('Undo works in a list item and in a table cell', () =>
    smart('- item\n\n| a |\n| - |\n| cell |\n', (s) => {
      s.caret('item')
      s.type(' "')
      s.editor.undo(1)
      expect(s.save()).toContain('- item "\n')
      s.caret('cell')
      s.type(" it'")
      s.editor.undo(1)
      expect(s.save()).toContain("| cell it' |")
    }))

  test('typing over a selection replaces it with the curly character', () =>
    smart('say word end', (s) => {
      s.editor.find('word')
      s.type('"')
      expect(s.save()).toBe('say “ end')
    }))

  test('a long note is typed into without touching the rest', () => {
    const body = Array.from(
      { length: 400 },
      (_, index) => `Line ${index} has "straight" quotes -- and it's fine.`,
    ).join('\n\n')
    return smart(`${body}\n`, (s) => {
      s.caret('Line 399')
      s.type(' "x"')
      expect(s.save()).toBe(`${body.replace('Line 399', 'Line 399 “x”')}\n`)
    })
  })
})

describe('Undo', () => {
  test('one Undo straight after a quote restores the plain character', () =>
    smart('say', (s) => {
      s.caret()
      s.type(' "')
      expect(s.save()).toBe('say “')
      expect(s.editor.undo(1)).toBe(true)
      expect(s.save()).toBe('say "')
      // The next Undo removes the typing, with the plain character.
      expect(s.editor.undo(1)).toBe(true)
      expect(s.save()).toBe('say')
    }))

  test('Undo after an apostrophe, an en dash and an em dash', () =>
    smart('', (s) => {
      s.type("it'")
      s.editor.undo(1)
      expect(s.save()).toBe("it'\n")
      s.type('s a --')
      s.editor.undo(1)
      expect(s.save()).toBe("it's a --\n")
      s.type('-')
      expect(s.save()).toBe("it's a ---\n")
    }))

  test('Undo after an em dash leaves the en dash and a hyphen', () =>
    smart('a', (s) => {
      s.caret()
      s.type(' ---')
      expect(s.save()).toBe('a —')
      s.editor.undo(1)
      expect(s.save()).toBe('a –-')
    }))

  test('Undo is the ordinary Undo once the caret has moved or text was typed', () =>
    smart('say', (s) => {
      s.caret()
      s.type(' "x')
      s.editor.undo(1)
      expect(s.save()).toBe('say')
    }))

  test('Backspace straight after a quote restores the plain character', () =>
    smart('say', (s) => {
      s.caret()
      s.type(' "')
      expect(s.editor.keyDown({ key: 'Backspace', code: 'Backspace' }, 1)).toBe(
        true,
      )
      expect(s.save()).toBe('say "')
    }))

  test('Redo after Undo does not bring the curly character back', () =>
    smart('say', (s) => {
      s.caret()
      s.type(' "')
      s.editor.undo(1)
      s.editor.undo(1)
      s.editor.redo(1)
      expect(s.save()).toBe('say "')
    }))

  test('Undo is the ordinary Undo when no rule ran', () =>
    smart('one', (s) => {
      s.caret()
      s.type(' two')
      s.editor.undo(1)
      expect(s.save()).toBe('one')
    }))

  test('Undo after another input rule is unchanged', () =>
    smart('', (s) => {
      s.type('# ')
      expect(s.view.state.doc.firstChild?.type.name).toBe('heading')
      s.editor.undo(1)
      expect(s.view.state.doc.firstChild?.type.name).toBe('paragraph')
    }))
})

describe('changing the option', () => {
  test('turning it on and off takes effect without a remount', () =>
    withNote('', {}, (s) => {
      s.type(`"a" `)
      s.editor.setTextInputPreferences({ smartPunctuation: true })
      s.type(`"b" `)
      s.editor.setTextInputPreferences({ spellcheck: true })
      s.type(`"c"`)
      expect(s.save()).toBe('"a" “b” "c"\n')
    }))

  test('setting it keeps the other preferences, and the document is not changed', () =>
    withNote('"x"', {}, (s) => {
      const before = s.editor.snapshot()
      s.editor.setTextInputPreferences({
        smartPunctuation: true,
        spellcheck: false,
      })
      const after = s.editor.snapshot()
      expect(after.text).toBe('"x"')
      expect(after.revision).toBe(before.revision)
      expect(s.view.dom.getAttribute('spellcheck')).toBe('false')
    }))

  test('a value that is not a boolean is refused, and so is an unknown key', () =>
    withNote('', {}, (s) => {
      for (const bad of [{ smartPunctuation: 'yes' }, { smartQuotes: true }]) {
        try {
          s.editor.setTextInputPreferences(bad as never)
          throw new Error('accepted')
        } catch (error) {
          expect(error).toBeInstanceOf(InkKitError)
          expect((error as InkKitError).code).toBe('invalid-argument')
        }
      }
    }))

  test('the mount option is checked too', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    await expect(
      InkKitEditor.mount(
        root,
        { changed() {}, copy() {}, openLink() {} },
        { textInput: { smartPunctuation: 1 } as never },
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
    root.remove()
  })

  test('saved text is the same whichever way it was typed', async () => {
    await smart('', (s) => {
      s.type(`"a" it's --`)
      expect(s.save()).toBe('“a” it’s –\n')
    })
    await withNote('“a” it’s –', {}, (s) => {
      expect(s.save()).toBe('“a” it’s –')
    })
  })
})

describe('only the hyphen just received counts', () => {
  test('a hyphen already in the note, with one typed after it, stays two hyphens', () =>
    smart('a -', (s) => {
      s.caret()
      s.type('-')
      expect(s.save()).toBe('a --')
    }))

  test('a hyphen typed earlier, with the caret moved away and back, stays two hyphens', () =>
    smart('a b', (s) => {
      s.caret('a')
      s.type('-')
      s.caret('b')
      s.caret('a-')
      s.type('-')
      expect(s.save()).toBe('a-- b')
    }))

  test('a hyphen typed earlier, then text typed and deleted, stays a hyphen', () =>
    smart('a', (s) => {
      s.caret()
      s.type(' -x')
      const end = s.view.state.selection.from
      s.view.dispatch(s.view.state.tr.delete(end - 1, end))
      s.type('-')
      expect(s.save()).toBe('a --')
    }))

  test('two hyphens typed one after the other still give an en dash', () =>
    smart('a b', (s) => {
      s.caret('a')
      s.type(' --')
      expect(s.save()).toBe('a – b')
    }))

  test('a chunk of hyphens and text keeps its hyphens unless it ends in two', () =>
    smart('a', (s) => {
      s.caret()
      expect(s.editor.insertText('-', 1)).toBe(true)
      expect(s.editor.insertText('x-', 1)).toBe(true)
      expect(s.save()).toBe('a-x-')
    }))
})

describe('code and tags inside the block', () => {
  test('a backtick inside a closed code span is not an open one', () =>
    smart('Use ``a`b`` here', (s) => {
      s.caret('here')
      s.type(` "x" it's`)
      expect(s.save()).toBe('Use ``a`b`` here “x” it’s')
    }))

  test('a < inside a word is not an open tag', () =>
    smart('', (s) => {
      s.type(`a<b and "c"`)
      expect(s.view.state.doc.textContent).toBe('a<b and “c”')
    }))

  test('a < that opens a tag still is', () =>
    smart('', (s) => {
      s.type(`x <b class="c"`)
      expect(s.view.state.doc.textContent).toBe('x <b class="c"')
    }))
})
