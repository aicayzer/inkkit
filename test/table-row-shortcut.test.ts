import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor } from '../src/index'
import { semanticSignature } from '../src/preserve'

// A paragraph that is one table row typed as Markdown becomes a table on Enter
// or Tab at the end of the line. Anything else keeps what those keys already do.

interface Session {
  editor: InkKitEditor
  view: ReturnType<Ctx['get']> & import('@milkdown/kit/prose/view').EditorView
  press(key: string, shift?: boolean): boolean
  /** Puts the caret at the end of the first textblock holding `text`, or at `offset` into the text. */
  caretAfter(text: string, offset?: number): void
  errors: Error[]
}

async function withNote(
  source: string,
  run: (session: Session) => void | Promise<void>,
  options: { editable?: boolean } = {},
): Promise<void> {
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
    options,
  )
  try {
    editor.loadDocument({
      documentId: 'rows',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const view = ctx.get(editorViewCtx)
    await run({
      editor,
      view,
      errors,
      press(key, shift = false) {
        const event = new KeyboardEvent('keydown', {
          key,
          shiftKey: shift,
          bubbles: true,
          cancelable: true,
        })
        view.dom.dispatchEvent(event)
        return event.defaultPrevented
      },
      caretAfter(text, offset) {
        let found = -1
        view.state.doc.descendants((node, pos) => {
          if (found >= 0 || !node.isTextblock) return found < 0
          const index = node.textContent.indexOf(text)
          if (index >= 0)
            found =
              offset === undefined
                ? pos + 1 + node.content.size
                : pos + 1 + index + offset
          return false
        })
        expect(found).toBeGreaterThanOrEqual(0)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, found),
          ),
        )
      },
    })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

/** Checks that the saved note reopens as the document the key made, and returns it. */
function reopened({ editor, view, errors }: Session): string {
  const saved = editor.snapshot().text
  expect(errors).toEqual([])
  const signature = semanticSignature(view.state.doc)
  editor.loadDocument({
    documentId: 'rows',
    generation: 2,
    format: 'md',
    text: saved,
  })
  expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
  expect(semanticSignature(view.state.doc)).toBe(signature)
  return saved
}

/** The text the editor saves after `key` is pressed at the end of the textblock holding `at`. */
async function pressed(
  source: string,
  at: string,
  key = 'Enter',
): Promise<string> {
  let saved = ''
  await withNote(source, (session) => {
    session.caretAfter(at)
    session.press(key)
    saved = reopened(session)
  })
  return saved
}

/** The same for a line typed into an empty note. */
async function typed(line: string, key = 'Enter'): Promise<string> {
  let saved = ''
  await withNote('', (session) => {
    expect(session.editor.insertText(line, 1)).toBe(true)
    session.press(key)
    saved = reopened(session)
  })
  return saved
}

const blocks = (view: Session['view']) => {
  const names: string[] = []
  view.state.doc.forEach((node) => names.push(node.type.name))
  return names
}

describe('a typed table row', () => {
  test.each(['Enter', 'Tab'])('becomes a table on %s', async (key) => {
    expect(await typed('| Name | Date |', key)).toBe(
      '| Name | Date |\n| ---- | ---- |\n|      |      |\n',
    )
    expect(await pressed('| Name | Date |\n', 'Date', key)).toBe(
      '| Name | Date |\n| ---- | ---- |\n|      |      |\n',
    )
  })

  test('is the table that table(insert) saves, with the typed header', async () => {
    await withNote('', ({ editor }) => {
      expect(editor.table('insert', { rows: 2, columns: 3 })).toBe(true)
      expect(editor.snapshot().text).toBe(
        '|   |   |   |\n| - | - | - |\n|   |   |   |\n',
      )
    })
    expect(await typed('| a | b | c |')).toBe(
      '| a | b | c |\n| - | - | - |\n|   |   |   |\n',
    )
  })

  test('holds three and many cells', async () => {
    const cells = Array.from({ length: 12 }, (_, index) => `h${index}`)
    const lines = (await typed(`| ${cells.join(' | ')} |`)).split('\n')
    const widths = (line: string) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
    expect(widths(lines[0]!)).toEqual(cells)
    expect(widths(lines[1]!)).toEqual(
      cells.map((cell) => '-'.repeat(cell.length)),
    )
    expect(widths(lines[2]!)).toEqual(cells.map(() => ''))
    expect(lines).toHaveLength(4)
  })

  test('trims the spaces around each cell and keeps empty cells', async () => {
    expect(await typed('|   Name   |Date|  |')).toBe(
      '| Name | Date |   |\n| ---- | ---- | - |\n|      |      |   |\n',
    )
  })

  test('keeps formatting in the cells', async () => {
    expect(
      await pressed(
        '| **Name** | *Date* | `code` | [a](https://x.test) |\n',
        'code',
      ),
    ).toBe(
      [
        '| **Name** | *Date* | `code` | [a](https://x.test) |',
        '| -------- | ------ | ------ | ------------------- |',
        '|          |        |        |                     |',
        '',
      ].join('\n'),
    )
  })

  test('treats an escaped pipe and a pipe in code as part of a cell', async () => {
    const saved = await typed('| a \\| b | c |')
    expect(saved.split('\n')[0]).toBe('| a \\| b | c |')
    expect(saved.split('\n')).toHaveLength(4)
    const code = await pressed('| x | `e|f` |\n', 'e|f')
    expect(code.split('\n')[0]).toBe('| x | `e\\|f` |')
    expect(code.split('\n')).toHaveLength(4)
  })

  test('keeps a note written with CRLF line endings', async () => {
    expect(
      await pressed('Before\r\n\r\n| a | b |\r\n\r\nAfter\r\n', 'b |'),
    ).toBe('Before\r\n\r\n| a | b |\r\n| - | - |\r\n|   |   |\r\n\r\nAfter\r\n')
  })

  test('works in a list item and in a quote', async () => {
    for (const key of ['Enter', 'Tab'])
      expect(await pressed('- | a | b |\n', 'b |', key)).toBe(
        '- | a | b |\n  | - | - |\n  |   |   |\n',
      )
    expect(await pressed('- one\n\n  | a | b |\n', 'b |', 'Tab')).toBe(
      '- one\n\n  | a | b |\n  | - | - |\n  |   |   |\n',
    )
    expect(await pressed('> | a | b |\n', 'b |')).toBe(
      '> | a | b |\n> | - | - |\n> |   |   |\n',
    )
  })

  test('works in an ordered item, a nested item, a callout and a footnote', async () => {
    expect(await pressed('1. | a | b |\n2. two\n', 'b |')).toBe(
      '1. | a | b |\n   | - | - |\n   |   |   |\n2. two\n',
    )
    expect(await pressed('- one\n  - | a | b |\n', 'b |')).toBe(
      '- one\n  - | a | b |\n    | - | - |\n    |   |   |\n',
    )
    expect(await pressed('> [!NOTE]\n> | a | b |\n', 'b |')).toBe(
      '> [!NOTE]\n> | a | b |\n> | - | - |\n> |   |   |\n',
    )
    expect(await pressed('Text[^1]\n\n[^1]: | a | b |\n', 'b |')).toBe(
      'Text[^1]\n\n[^1]: | a | b |\n    | - | - |\n    |   |   |\n',
    )
  })

  test('leaves the rest of the note as it was', async () => {
    expect(
      await pressed('# Title\n\nBefore  text\n\n| a | b |\n\n- item\n', 'b |'),
    ).toBe(
      '# Title\n\nBefore  text\n\n| a | b |\n| - | - |\n|   |   |\n\n- item\n',
    )
  })

  test('puts the caret in the first body cell', async () => {
    await withNote('| a | b |\n', ({ view, editor, press, caretAfter }) => {
      caretAfter('b |')
      expect(press('Enter')).toBe(true)
      const { $from, empty } = view.state.selection
      expect(empty).toBe(true)
      expect($from.node(-2)).toBe(view.state.doc.firstChild!.child(1))
      expect($from.index(-2)).toBe(0)
      expect($from.parent.content.size).toBe(0)
      editor.insertText('x', editor.snapshot().generation)
      expect(editor.snapshot().text).toBe('| a | b |\n| - | - |\n| x |   |\n')
    })
  })

  test('is one undo step that restores the typed line with the caret at its end', async () => {
    await withNote('', ({ editor, view, press }) => {
      expect(editor.insertText('| Name | Date |', 1)).toBe(true)
      expect(press('Enter')).toBe(true)
      expect(blocks(view)).toEqual(['table'])
      expect(editor.undo()).toBe(true)
      expect(blocks(view)).toEqual(['paragraph'])
      expect(view.state.doc.firstChild!.textContent).toBe('| Name | Date |')
      expect(editor.snapshot().text).toBe('\\| Name | Date |\n')
      const { $from, empty } = view.state.selection
      expect(empty).toBe(true)
      expect($from.parentOffset).toBe($from.parent.content.size)
      expect(editor.redo()).toBe(true)
      expect(blocks(view)).toEqual(['table'])
    })
  })

  test('undoes in a list item back to the typed line', async () => {
    await withNote('- | a | b |\n', ({ editor, view, press, caretAfter }) => {
      caretAfter('b |')
      expect(press('Tab')).toBe(true)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe('- | a | b |\n')
      expect(view.state.selection.$from.parentOffset).toBe(
        view.state.selection.$from.parent.content.size,
      )
    })
  })
})

describe('Enter and Tab elsewhere', () => {
  const unchanged: Array<[string, string, string]> = [
    ['one cell', '| a |', 'a |'],
    ['a line without a closing pipe', '| a | b', 'b'],
    ['a line without an opening pipe', 'a | b |', 'b |'],
    ['pipes with no cell between', '||', '||'],
    ['plain text', 'Name', 'Name'],
    ['a heading', '# | a | b |', 'b |'],
    ['a code block', '```\n| a | b |\n```', 'b |'],
    ['a table cell', '| a | b |\n| - | - |\n| c | d |', 'd'],
    ['inline code holding the row', '`| a | b |`', 'b |'],
    ['front matter', '---\ntitle: | a | b |\n---', 'b |'],
  ]
  test.each(unchanged)('leave %s alone', async (_name, source, at) => {
    for (const key of ['Enter', 'Tab'])
      await withNote(`${source}\n`, ({ view, press, caretAfter }) => {
        caretAfter(at)
        const before = blocks(view).filter((name) => name === 'table')
        press(key)
        expect(blocks(view).filter((name) => name === 'table')).toEqual(before)
      })
  })

  test('leave a row in a task item, with a comment, or over 100 cells alone', async () => {
    for (const [source, line] of [
      ['- [ ] | a | b |\n', 'b |'],
      ['<!-- c --> | a | b |\n', 'b |'],
      [`|${' a |'.repeat(101)}\n`, ' a |'],
    ] as const)
      await withNote(source, ({ editor, view, press, caretAfter }) => {
        caretAfter(line)
        press('Enter')
        expect(view.state.doc.textContent).toContain('a |')
        expect(blocks(view)).not.toContain('table')
        expect(editor.snapshot().text).not.toContain('| - |')
      })
  })

  test('a line that ends in an escaped pipe is not a row', async () => {
    await withNote('', ({ editor, view, press }) => {
      expect(editor.insertText('| a | b \\|', 1)).toBe(true)
      press('Enter')
      expect(blocks(view)).toEqual(['paragraph', 'paragraph'])
    })
  })

  test('start a new paragraph after a line that is not a row, as before', async () => {
    await withNote('| a |\n', ({ view, press, caretAfter }) => {
      caretAfter('a |')
      expect(press('Enter')).toBe(true)
      expect(blocks(view)).toEqual(['paragraph', 'paragraph'])
    })
  })

  test('leave a caret inside the row alone', async () => {
    await withNote('| a | b |\n', ({ view, press, caretAfter }) => {
      caretAfter('a', 1)
      press('Enter')
      expect(blocks(view)).toEqual(['paragraph', 'paragraph'])
    })
  })

  test('leave a paragraph with other lines alone', async () => {
    for (const [source, at] of [
      ['| a | b |\nsecond line\n', 'second line'],
      ['first line\n| a | b |\n', 'b |'],
    ] as const)
      await withNote(source, ({ view, press, caretAfter }) => {
        caretAfter(at)
        press('Tab')
        expect(blocks(view)).not.toContain('table')
        press('Enter')
        expect(blocks(view)).not.toContain('table')
      })
  })

  test('leave a selection alone', async () => {
    await withNote('| a | b |\n', ({ view, press }) => {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            1,
            view.state.doc.firstChild!.nodeSize - 1,
          ),
        ),
      )
      press('Enter')
      expect(blocks(view)).not.toContain('table')
    })
  })

  test('keep sinking a list item on Tab when its line is not a row', async () => {
    await withNote('- one\n- two\n', ({ editor, press, caretAfter }) => {
      caretAfter('two')
      press('Tab')
      expect(editor.snapshot().text).toBe('- one\n  - two\n')
    })
  })

  test('keep moving between table cells on Tab', async () => {
    await withNote(
      '| a | b |\n| - | - |\n| c | d |\n',
      ({ view, press, caretAfter }) => {
        caretAfter('c')
        press('Tab')
        expect(view.state.selection.$from.parent.textContent).toBe('d')
      },
    )
  })

  test('do nothing in a note that cannot be edited', async () => {
    await withNote(
      '| a | b |\n',
      ({ view, press, caretAfter }) => {
        caretAfter('b |')
        press('Enter')
        expect(blocks(view)).not.toContain('table')
      },
      { editable: false },
    )
  })

  test('do nothing in source mode', async () => {
    await withNote('| a | b |\n', ({ editor, view, press }) => {
      editor.setEditingMode('source')
      press('Enter')
      expect(blocks(view)).not.toContain('table')
      expect(editor.snapshot().text).toBe('| a | b |\n')
    })
  })
})
