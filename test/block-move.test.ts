import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, type Keymap } from '../src/index'
import { semanticSignature } from '../src/preserve'

// Option-Up and Option-Down move the block at the caret past its neighbor in
// its container. The moved blocks and every block they pass keep their bytes.

interface Note {
  editor: InkKitEditor
  view: EditorView
  errors: Error[]
  /** The text of each `changed` event. */
  changes: string[]
  /** Presses Option with an arrow key in the editor, as a person does; returns whether it was handled. */
  press(key: 'ArrowUp' | 'ArrowDown', modifiers?: KeyboardEventInit): boolean
  /** Puts the caret `offset` characters into the first textblock that holds `text`, or after `text`. */
  caret(text: string, offset?: number): void
  /** The text of the textblock holding the caret, and the caret's offset in it. */
  where(): { text: string; offset: number }
  /** What the editor saves, after checking that it reopens as the same document. */
  saved(): string
}

async function withNote(
  source: string,
  run: (note: Note) => void | Promise<void>,
  options: { editable?: boolean; keymap?: Keymap } = {},
): Promise<void> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const changes: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed: (snapshot) => changes.push(snapshot.text),
      error: (error) => errors.push(error),
    },
    options,
  )
  try {
    editor.loadDocument({
      documentId: 'move',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const view = ctx.get(editorViewCtx)
    const find = (text: string) => {
      let found: { pos: number; at: number } | undefined
      view.state.doc.descendants((node, pos) => {
        if (found) return false
        const at = node.isTextblock ? node.textContent.indexOf(text) : -1
        if (at >= 0) found = { pos: pos + 1, at }
        return !found
      })
      if (!found) throw Error(`No ${text}`)
      return found
    }
    await run({
      editor,
      view,
      errors,
      changes,
      press(key, modifiers = { altKey: true }) {
        const event = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...modifiers,
        })
        view.dom.dispatchEvent(event)
        return event.defaultPrevented
      },
      caret(text, offset) {
        const { pos, at } = find(text)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(
              view.state.doc,
              pos + at + (offset ?? text.length),
            ),
          ),
        )
      },
      where() {
        const { $head } = view.state.selection
        return { text: $head.parent.textContent, offset: $head.parentOffset }
      },
      saved() {
        const text = editor.snapshot().text
        reopenings.push(reopens(text, semanticSignature(view.state.doc)))
        return text
      },
    })
    expect(errors).toEqual([])
  } finally {
    await editor.destroy()
    root.remove()
  }
}

// The saved text reopens as the document the move made.
let reopenings: Promise<void>[] = []
async function reopens(text: string, signature: string): Promise<void> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, { changed() {} })
  try {
    editor.loadDocument({
      documentId: 'reopened',
      generation: 1,
      format: 'md',
      text,
    })
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    expect(editor.snapshot().text).toBe(text)
    expect(semanticSignature(ctx.get(editorViewCtx).state.doc)).toBe(signature)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

async function moved(
  source: string,
  caret: string,
  keys: Array<'ArrowUp' | 'ArrowDown'>,
): Promise<string> {
  let text = ''
  await withNote(source, (note) => {
    note.caret(caret, 0)
    const before = note.where()
    for (const key of keys) expect(note.press(key)).toBe(true)
    expect(note.where()).toEqual(before)
    text = note.saved()
  })
  await Promise.all(reopenings)
  reopenings = []
  return text
}

describe('paragraphs and other top-level blocks', () => {
  const source = [
    'Setext __title__',
    '===',
    '',
    'First line  ',
    'second *line*',
    '',
    '| a | b |',
    '|:--|--:|',
    '| 1 | 2 |',
    '',
    '    indented code',
    '',
    'Last __words__',
    '',
  ].join('\r\n')

  test.each<[string, string, Array<'ArrowUp' | 'ArrowDown'>, string]>([
    [
      'a paragraph moves up past a table',
      'Last',
      ['ArrowUp', 'ArrowUp'],
      [
        'Setext __title__',
        '===',
        '',
        'First line  ',
        'second *line*',
        '',
        'Last __words__',
        '',
        '| a | b |',
        '|:--|--:|',
        '| 1 | 2 |',
        '',
        '    indented code',
        '',
      ].join('\r\n'),
    ],
    [
      'a paragraph with a hard break moves down',
      'First',
      ['ArrowDown'],
      [
        'Setext __title__',
        '===',
        '',
        '| a | b |',
        '|:--|--:|',
        '| 1 | 2 |',
        '',
        'First line  ',
        'second *line*',
        '',
        '    indented code',
        '',
        'Last __words__',
        '',
      ].join('\r\n'),
    ],
    [
      'a heading moves down twice',
      'Setext',
      ['ArrowDown', 'ArrowDown'],
      [
        'First line  ',
        'second *line*',
        '',
        '| a | b |',
        '|:--|--:|',
        '| 1 | 2 |',
        '',
        'Setext __title__',
        '===',
        '',
        '    indented code',
        '',
        'Last __words__',
        '',
      ].join('\r\n'),
    ],
  ])('%s', async (_, caret, keys, expected) => {
    expect(await moved(source, caret, keys)).toBe(expected)
  })

  test('the first block does not move up and the last does not move down', async () => {
    await withNote(source, (note) => {
      note.caret('Setext', 0)
      expect(note.press('ArrowUp')).toBe(true)
      note.caret('Last', 2)
      expect(note.press('ArrowDown')).toBe(true)
      expect(note.where()).toEqual({ text: 'Last words', offset: 2 })
      expect(note.editor.snapshot()).toMatchObject({
        text: source,
        dirty: false,
        revision: 0,
      })
      expect(note.editor.commandState().commands).toMatchObject({
        moveBlockUp: true,
        moveBlockDown: false,
      })
    })
  })

  // The block it passes carries the move, so the edited block stays paired
  // with its original.
  test('a block edited and then moved keeps its source', async () => {
    await withNote(
      'Intro\r\n\r\n__Bold__ line  \r\nnext\r\n\r\n*   one\r\n*   two\r\n',
      (note) => {
        note.caret('Bold', 4)
        expect(note.editor.insertText('er', 1)).toBe(true)
        expect(note.press('ArrowUp')).toBe(true)
        note.caret('two', 3)
        expect(note.editor.insertText('!', 1)).toBe(true)
        expect(note.press('ArrowUp')).toBe(true)
        expect(note.press('ArrowUp')).toBe(true)
        expect(note.saved()).toBe(
          '__Bolder__ line  \r\nnext\r\n\r\nIntro\r\n\r\n*   two!\r\n*   one\r\n',
        )
      },
    )
    await Promise.all(reopenings)
    reopenings = []
  })

  test('front matter stays first', async () => {
    const note = '---\ntitle: x\n---\n\nFirst\n\nSecond\n'
    await withNote(note, (session) => {
      session.caret('First', 0)
      expect(session.editor.commandState().commands.moveBlockUp).toBe(false)
      expect(session.press('ArrowUp')).toBe(true)
      expect(session.editor.snapshot().text).toBe(note)
      session.caret('title', 0)
      expect(session.editor.commandState().commands.moveBlockDown).toBe(false)
    })
    expect(await moved(note, 'Second', ['ArrowUp'])).toBe(
      '---\ntitle: x\n---\n\nSecond\n\nFirst\n',
    )
  })

  test('a hidden comment is passed with the block after it', async () => {
    expect(
      await moved('A\n\n<!-- note -->\n\nB\n\nC\n', 'A', ['ArrowDown']),
    ).toBe('<!-- note -->\n\nB\n\nA\n\nC\n')
    expect(await moved('A\n\n%% note %%\n', 'A', ['ArrowDown'])).toBe(
      'A\n\n%% note %%\n',
    )
  })

  test('a list that comes to sit beside another list of its kind takes another marker', async () => {
    // Otherwise the two would read as one list.
    expect(await moved('* a\n\nP\n\n* b\n', 'P', ['ArrowDown'])).toBe(
      '* a\n\n- b\n\nP\n',
    )
  })
})

describe('lists', () => {
  test.each<[string, string, string, Array<'ArrowUp' | 'ArrowDown'>, string]>([
    [
      'a bullet item keeps its spacing and continuation lines',
      '*   one\n*   two  \n    cont\n*   three\n\nAfter\n',
      'one',
      ['ArrowDown'],
      '*   two  \n    cont\n*   one\n*   three\n\nAfter\n',
    ],
    [
      'the last item moves to the top',
      '+ one\n+ two\n+ three\n',
      'three',
      ['ArrowUp', 'ArrowUp'],
      '+ three\n+ one\n+ two\n',
    ],
    [
      'a task keeps its box',
      '- [ ] one\n- [x] two *done*\n',
      'two',
      ['ArrowUp'],
      '- [x] two *done*\n- [ ] one\n',
    ],
    [
      'an item takes the number written at its new place',
      '1. one\n2. two\n3. three\n',
      'three',
      ['ArrowUp'],
      '1. one\n2. three\n3. two\n',
    ],
    [
      'numbers written alike stay alike',
      '1) one\n1) two\n1) three\n',
      'one',
      ['ArrowDown'],
      '1) two\n1) one\n1) three\n',
    ],
    [
      'a list starting from another number keeps its numbers',
      '7. one\n8. two\n',
      'one',
      ['ArrowDown'],
      '7. two\n8. one\n',
    ],
    [
      'lines indented to the content follow a number of another width',
      '8. a\n9. b\n   cont\n\n   para\n10. c\n    more\n',
      'b',
      ['ArrowDown'],
      '8. a\n9. c\n   more\n10. b\n    cont\n\n    para\n',
    ],
    [
      'an item takes its sublist with it',
      '- one\n  * sub a\n  * sub b\n- two\n',
      'one',
      ['ArrowDown'],
      '- two\n- one\n  * sub a\n  * sub b\n',
    ],
    [
      'a sublist item moves within its sublist',
      '- one\n  - sub a\n  - sub b  \n    cont\n- two\n',
      'sub a',
      ['ArrowDown'],
      '- one\n  - sub b  \n    cont\n  - sub a\n- two\n',
    ],
    [
      'the caret in a later paragraph of an item moves the item',
      '- a\n- b\n\n  para\n- c\n',
      'para',
      ['ArrowUp'],
      '- b\n\n  para\n- a\n- c\n',
    ],
    [
      'items keep CRLF line endings',
      '- one\r\n- two\r\n  more\r\n',
      'one',
      ['ArrowDown'],
      '- two\r\n  more\r\n- one\r\n',
    ],
  ])('%s', async (_, source, caret, keys, expected) => {
    expect(await moved(source, caret, keys)).toBe(expected)
  })

  test('an item at the end of its sublist stays in it', async () => {
    const source = '- one\n  - sub a\n  - sub b\n- two\n'
    await withNote(source, (note) => {
      note.caret('sub b', 0)
      expect(note.press('ArrowDown')).toBe(true)
      note.caret('sub a', 0)
      expect(note.press('ArrowUp')).toBe(true)
      expect(note.editor.snapshot()).toMatchObject({
        text: source,
        dirty: false,
      })
    })
  })
})

describe('quotes, callouts and footnotes', () => {
  test.each<[string, string, string, Array<'ArrowUp' | 'ArrowDown'>, string]>([
    [
      'a block in a quote',
      '> a\n>\n> b  \n> c\n\nAfter\n',
      'b',
      ['ArrowUp'],
      '> b  \n> c\n>\n> a\n\nAfter\n',
    ],
    [
      'a block in a callout',
      '> [!NOTE] Title\n> a\n>\n> *b*\n',
      'b',
      ['ArrowUp'],
      '> [!NOTE] Title\n> *b*\n>\n> a\n',
    ],
    [
      'a block in a footnote',
      'Text[^1]\n\n[^1]: note\n    more\n\n    second\n',
      'second',
      ['ArrowUp'],
      'Text[^1]\n\n[^1]: second\n\n    note\n    more\n',
    ],
    [
      'a list item in a quote',
      '> - one\r\n> - two\r\n',
      'two',
      ['ArrowUp'],
      '> - two\r\n> - one\r\n',
    ],
  ])('%s', async (_, source, caret, keys, expected) => {
    expect(await moved(source, caret, keys)).toBe(expected)
  })

  test('a block stays inside its quote or callout, below the callout title', async () => {
    const source = '> [!TIP] Title\n> a\n\n> b\n\nc\n'
    await withNote(source, (note) => {
      note.caret('a', 0)
      expect(note.press('ArrowUp')).toBe(true)
      expect(note.press('ArrowDown')).toBe(true)
      note.caret('b', 0)
      expect(note.press('ArrowDown')).toBe(true)
      expect(note.editor.snapshot()).toMatchObject({
        text: source,
        dirty: false,
      })
    })
  })
})

describe('selections, undo and bindings', () => {
  test('a selection across blocks moves them together', async () => {
    await withNote('A\n\nB\n\nC\n\nD\n', (note) => {
      note.caret('B', 0)
      const anchor = note.view.state.selection.anchor
      note.caret('C', 1)
      const head = note.view.state.selection.head
      note.view.dispatch(
        note.view.state.tr.setSelection(
          TextSelection.create(note.view.state.doc, anchor, head),
        ),
      )
      expect(note.press('ArrowUp')).toBe(true)
      expect(note.saved()).toBe('B\n\nC\n\nA\n\nD\n')
      const { from, to } = note.view.state.selection
      expect(note.view.state.doc.textBetween(from, to, '|')).toBe('B|C')
    })
    await Promise.all(reopenings)
    reopenings = []
  })

  test('a move is one undo step', async () => {
    const source = '- one\r\n- two  \r\n  more\r\n\r\nAfter __this__\r\n'
    await withNote(source, (note) => {
      note.caret('two', 1)
      expect(note.press('ArrowUp')).toBe(true)
      expect(note.press('ArrowDown', { altKey: true })).toBe(true)
      expect(note.press('ArrowUp')).toBe(true)
      const after = note.editor.snapshot().text
      expect(after).toBe('- two  \r\n  more\r\n- one\r\n\r\nAfter __this__\r\n')
      expect(note.editor.undo()).toBe(true)
      expect(note.editor.snapshot().text).toBe(
        '- one\r\n- two  \r\n  more\r\n\r\nAfter __this__\r\n',
      )
      expect(note.editor.undo()).toBe(true)
      expect(note.editor.snapshot().text).toBe(after)
      expect(note.editor.undo()).toBe(true)
      expect(note.editor.snapshot()).toMatchObject({
        text: source,
        dirty: false,
      })
      expect(note.editor.redo()).toBe(true)
      expect(note.editor.snapshot().text).toBe(after)
    })
  })

  test('keyDown and moveBlock move as the keys do', async () => {
    await withNote('A\n\nB\n', (note) => {
      note.caret('B', 0)
      expect(note.editor.keyDown({ key: 'ArrowUp', altKey: true }, 1)).toBe(
        true,
      )
      expect(note.editor.snapshot().text).toBe('B\n\nA\n')
      expect(note.editor.moveBlock('down', 1)).toBe(true)
      expect(note.editor.moveBlock('down')).toBe(false)
      expect(note.editor.snapshot().text).toBe('A\n\nB\n')
      expect(() =>
        note.editor.moveBlock('left' as unknown as 'up'),
      ).toThrowError(expect.objectContaining({ code: 'invalid-argument' }))
    })
  })

  test('a host can rebind or turn off the shortcuts', async () => {
    await withNote(
      'A\n\nB\n',
      (note) => {
        note.caret('B', 0)
        expect(note.press('ArrowUp')).toBe(false)
        expect(note.press('ArrowUp', { altKey: true, shiftKey: true })).toBe(
          true,
        )
        expect(note.editor.snapshot().text).toBe('B\n\nA\n')
        note.editor.setKeymap({ moveBlockUp: [], moveBlockDown: [] })
        expect(note.press('ArrowDown')).toBe(false)
        note.editor.setKeymap({})
        expect(note.press('ArrowDown')).toBe(true)
        expect(note.editor.snapshot().text).toBe('A\n\nB\n')
      },
      { keymap: { moveBlockUp: ['Shift-Alt-ArrowUp'] } },
    )
  })

  test('in a table cell the key is left to the table and the web view', async () => {
    const source = 'P\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nQ\n'
    await withNote(source, (note) => {
      note.caret('3', 0)
      expect(note.editor.commandState().commands).toMatchObject({
        moveBlockUp: false,
        moveBlockDown: false,
      })
      expect(note.press('ArrowUp')).toBe(false)
      expect(note.editor.moveBlock('up')).toBe(false)
      expect(note.editor.snapshot()).toMatchObject({
        text: source,
        dirty: false,
      })
    })
    // A host that gives the row moves the same keys gets them in a table and
    // block moves outside one.
    await withNote(
      source,
      (note) => {
        note.caret('3', 0)
        expect(note.press('ArrowUp')).toBe(true)
        expect(note.editor.snapshot().text).toBe(
          'P\n\n| a | b |\n|---|---|\n| 3 | 4 |\n| 1 | 2 |\n\nQ\n',
        )
        note.caret('Q', 0)
        expect(note.press('ArrowUp')).toBe(true)
        expect(note.editor.snapshot().text).toBe(
          'P\n\nQ\n\n| a | b |\n|---|---|\n| 3 | 4 |\n| 1 | 2 |\n',
        )
      },
      { keymap: { tableMoveRowUp: ['Alt-ArrowUp'] } },
    )
  })

  test('nothing moves when the editor is read-only or showing source', async () => {
    await withNote(
      'A\n\nB\n',
      (note) => {
        note.caret('B', 0)
        expect(note.editor.commandState().commands.moveBlockUp).toBe(false)
        expect(() => note.editor.moveBlock('up')).toThrowError(
          expect.objectContaining({ code: 'read-only' }),
        )
        expect(note.press('ArrowUp')).toBe(false)
        expect(note.editor.keyDown({ key: 'ArrowUp', altKey: true }, 1)).toBe(
          false,
        )
        expect(note.editor.snapshot().text).toBe('A\n\nB\n')
      },
      { editable: false },
    )
    // A key the host shares between a row move and a block move is still a
    // caret key in a read-only editor, in a table or outside one.
    await withNote(
      'A\n\n| a |\n| - |\n| 1 |\n',
      (note) => {
        for (const text of ['A', '1']) {
          note.caret(text, 0)
          expect(note.editor.keyDown({ key: 'ArrowUp', altKey: true }, 1)).toBe(
            false,
          )
        }
      },
      { editable: false, keymap: { tableMoveRowUp: ['Alt-ArrowUp'] } },
    )
    await withNote('A\n\nB\n', (note) => {
      note.caret('B', 0)
      note.editor.setEditingMode('source')
      expect(note.editor.commandState().commands.moveBlockUp).toBe(false)
      expect(note.editor.moveBlock('up')).toBe(false)
      expect(note.editor.snapshot().text).toBe('A\n\nB\n')
    })
  })
})

// Pairing a block with an original it did not stay beside must never refuse an
// edit, or give a new block source that is not its own.
// Edits other than a move save exactly as they did before moves kept source,
// and a move saves where that would.
describe('blocks that change places beside other edits', () => {
  // Deletes the top-level block at `index`.
  const remove = (note: Note, index: number) => {
    const { doc } = note.view.state
    let pos = 0
    for (let at = 0; at < index; at++) pos += doc.child(at).nodeSize
    note.view.dispatch(
      note.view.state.tr.delete(pos, pos + doc.child(index).nodeSize),
    )
  }
  // Adds a paragraph at the end of the note.
  const append = (note: Note, text: string) => {
    const { state } = note.view
    note.view.dispatch(
      state.tr.insert(
        state.doc.content.size,
        state.schema.nodes.paragraph!.create(null, state.schema.text(text)),
      ),
    )
  }
  const saves = async (
    source: string,
    edit: (note: Note) => unknown,
    expected: string,
  ) => {
    await withNote(source, async (note) => {
      await edit(note)
      expect(note.saved()).toBe(expected)
    })
    await Promise.all(reopenings)
    reopenings = []
  }

  test('a moved block whose source would read differently is written afresh', async () => {
    await saves(
      '- a\n\nPara\n\n    code\n',
      (note) => {
        note.caret('code', 0)
        expect(note.editor.moveBlock('up')).toBe(true)
      },
      '- a\n\n```\ncode\n```\n\nPara\n',
    )
    await saves(
      '- a\n\nPara\n\n   three\n',
      (note) => {
        note.caret('three', 0)
        expect(note.editor.moveBlock('up')).toBe(true)
      },
      '- a\n\nthree\n\nPara\n',
    )
  })

  test('a new block does not take the source of a deleted one', async () => {
    await saves(
      '   Old intro.\n\n# Title\n\n- a\n',
      (note) => {
        remove(note, 0)
        append(note, 'New')
      },
      '# Title\n\n- a\n\nNew\n',
    )
    await saves(
      '+ gone\n\nText\n\n* alpha\n* beta\n* [ ]  delta   item\n',
      (note) => {
        remove(note, 0)
        note.caret('beta', 0)
        expect(note.editor.format('bulletList')).toBe(true)
      },
      'Text\n\n* alpha\n\nbeta\n\n* [ ]  delta   item\n',
    )
    await saves(
      '|Name|Qty|\n|-|-|\n|a|1|\n\nP\n',
      (note) => {
        remove(note, 0)
        note.caret('P', 1)
        return note.editor.paste({
          text: '',
          markdown: '\n\n| X | Y |\n| - | - |\n| 1 | 2 |',
        })
      },
      'P\n\n| X | Y |\n| - | - |\n| 1 | 2 |\n',
    )
  })

  test('ordered items pasted in a new order save as other pastes do', async () => {
    await saves(
      '8. a\n9. b\n10. c\n    more c\n',
      (note) => {
        const { state } = note.view
        note.view.dispatch(
          state.tr.setSelection(
            TextSelection.create(state.doc, 0, state.doc.content.size),
          ),
        )
        const markdown = '8. a\n9. c\n   more c\n10. b'
        return note.editor.paste({ text: markdown, markdown })
      },
      '8. a\n9. c\n   more c\n10. b\n',
    )
  })

  test('a pasted block does not take the source of a deleted one', async () => {
    for (const ending of ['\n', '\r\n'])
      for (const [old, incoming, expected] of [
        [
          '   Project alpha is ready.',
          'Project beta is ready.',
          '# Keep\n\nEndProject beta is ready.\n',
        ],
        [
          '+  Project alpha is ready.',
          '- Project beta is ready.',
          '# Keep\n\nEnd\n\n- Project beta is ready.\n',
        ],
        [
          '|Project|Status|\n|:---|---:|\n|alpha|ready|',
          '| Project | Status |\n| :--- | ---: |\n| beta | ready |',
          '# Keep\n\nEnd\n\n| Project | Status |\n| :------ | -----: |\n| beta    |  ready |\n',
        ],
      ] as const)
        await saves(
          `${old}\n\n# Keep\n\nEnd\n`.replaceAll('\n', ending),
          (note) => {
            remove(note, 0)
            note.view.dispatch(
              note.view.state.tr.setSelection(
                TextSelection.atEnd(note.view.state.doc),
              ),
            )
            return note.editor.paste({
              text: incoming,
              markdown: `\n\n${incoming}`,
            })
          },
          expected.replaceAll('\n', ending),
        )
    await saves(
      '   Project alpha is ready.\n\n# Keep\n\nOld tail\n',
      (note) => {
        const { state } = note.view
        note.view.dispatch(
          state.tr.setSelection(
            TextSelection.create(state.doc, 0, state.doc.content.size),
          ),
        )
        const markdown = '# Keep\n\nNew tail\n\nProject beta is ready.'
        return note.editor.paste({ text: markdown, markdown })
      },
      '# Keep\n\nNew tail\n\nProject beta is ready.\n',
    )
  })

  test('a block the moves did not reach keeps its bytes beside a moved copy', async () => {
    await saves(
      '__same__\n\nB\n\n**same**\n\nC\n\nD\n',
      (note) => {
        note.caret('same', 0)
        expect(note.press('ArrowDown')).toBe(true)
        note.caret('C', 0)
        expect(note.press('ArrowDown')).toBe(true)
      },
      'B\n\n__same__\n\n**same**\n\nD\n\nC\n',
    )
  })

  test('an item whose source would nest elsewhere moves as other edits write it', async () => {
    await saves(
      '-   alpha\n  - beta\n',
      (note) => {
        note.caret('alpha', 0)
        expect(note.press('ArrowDown')).toBe(true)
      },
      '-   beta\n  - alpha\n',
    )
    await saves(
      '-   alpha\r\n  - beta\r\n\r\nAfter\r\n',
      (note) => {
        note.caret('alpha', 0)
        expect(note.press('ArrowDown')).toBe(true)
      },
      '-   beta\r\n  - alpha\r\n\r\nAfter\r\n',
    )
  })
})

// A move is part of the document's state: Undo takes it back, and a move of
// blocks that read alike is saved like any other.
describe('moves in the history of the note', () => {
  const removeSecond = (note: Note) => {
    const { doc } = note.view.state
    const at = doc.child(0).nodeSize
    note.view.dispatch(
      note.view.state.tr.delete(at, at + doc.child(1).nodeSize),
    )
  }

  test('an undone move leaves the end of the note as it was', async () => {
    for (const [source, expected] of [
      ['A\n\nB\n\nC', 'A\n\nC'],
      ['A\r\n\r\nB\r\n\r\nC', 'A\r\n\r\nC'],
      ['A\n\nB\n\nC\n\n\n', 'A\n\nC\n\n\n'],
    ]) {
      // Without the move, deleting B gives the expected text.
      await withNote(source!, (note) => {
        removeSecond(note)
        expect(note.saved()).toBe(expected)
      })
      await withNote(source!, (note) => {
        note.caret('C', 0)
        expect(note.press('ArrowUp')).toBe(true)
        expect(note.editor.undo()).toBe(true)
        expect(note.editor.snapshot().text).toBe(source)
        removeSecond(note)
        expect(note.saved()).toBe(expected)
      })
    }
    await Promise.all(reopenings)
    reopenings = []
  })

  test('a move of blocks that read alike is saved at once', async () => {
    for (const [source, caret, moved] of [
      [
        'Heading\n===\n\n# Heading\n\nTail\n',
        'Heading',
        '# Heading\n\nHeading\n===\n\nTail\n',
      ],
      ['   same\n\nsame\n\nTail\n', 'same', 'same\n\n   same\n\nTail\n'],
      ['__same__\r\n\r\n**same**', 'same', '**same**\r\n\r\n__same__'],
      ['- **a**\n- __a__\n\nTail\n', 'a', '- __a__\n- **a**\n\nTail\n'],
    ])
      await withNote(source!, (note) => {
        note.caret(caret!, 0)
        expect(note.press('ArrowDown')).toBe(true)
        expect(note.editor.snapshot()).toMatchObject({
          text: moved,
          dirty: true,
          revision: 1,
        })
        expect(note.changes).toEqual([moved])
        expect(note.saved()).toBe(moved)
        expect(note.editor.undo()).toBe(true)
        expect(note.editor.snapshot()).toMatchObject({
          text: source,
          dirty: false,
        })
        expect(note.editor.redo()).toBe(true)
        expect(note.editor.snapshot().text).toBe(moved)
      })
    await Promise.all(reopenings)
    reopenings = []
  })
})
