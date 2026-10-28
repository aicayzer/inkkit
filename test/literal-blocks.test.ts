import { ctxOf } from './editor-access'
import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, InkKitError } from '../src/index'
import { semanticSignature } from '../src/preserve'

// A block kept as literal Markdown is read again when an edit changes what its
// text means, and Enter at its end starts a paragraph after it.

type Step =
  | { after: string }
  | { select: string }
  | { key: string }
  | { type: string }
  | 'undo'
  | 'redo'

// Runs the steps through the facade and returns what the editor saves, after
// checking that it reopens as the edited document.
async function edit(
  source: string,
  steps: Step[],
  check?: (view: EditorView) => void,
): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = ctxOf(editor)
    const view = ctx.get(editorViewCtx)
    const find = (text: string) => {
      let at = -1
      view.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text!.includes(text))
          at = pos + node.text!.indexOf(text)
        return at < 0
      })
      if (at < 0) throw new Error(`No ${text}`)
      return at
    }
    for (const step of steps) {
      if (step === 'undo') expect(editor.undo(1)).toBe(true)
      else if (step === 'redo') expect(editor.redo(1)).toBe(true)
      else if ('after' in step) {
        const at = find(step.after) + step.after.length
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
        )
      } else if ('select' in step) {
        const at = find(step.select)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, at, at + step.select.length),
          ),
        )
      } else if ('key' in step)
        expect(editor.keyDown({ key: step.key }, 1)).toBe(true)
      else
        for (const character of step.type)
          expect(editor.insertText(character, 1)).toBe(true)
    }
    expect(errors).toEqual([])
    check?.(view)
    const saved = editor.snapshot().text
    const edited = semanticSignature(view.state.doc)
    editor.loadDocument({
      documentId: 'note',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(semanticSignature(view.state.doc)).toBe(edited)
    expect(editor.snapshot(2)).toMatchObject({ text: saved, dirty: false })
    return saved
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const names = (view: EditorView) => {
  const found: string[] = []
  view.state.doc.forEach((node) => found.push(node.type.name))
  return found
}

// Untouched blocks keep their authored syntax around each edit.
const around = (block: string, ending = '\n') =>
  `Intro __bold__ and * star.\n\n${block}\n\n* item _one_\n`.replaceAll(
    '\n',
    ending,
  )

describe('Enter at the end of a literal block starts a paragraph after it', () => {
  test.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('%s', async (_name, ending) => {
    const source = around('A [full][ref] x.', ending)
    expect(
      await edit(source, [{ after: 'x.' }, { key: 'Enter' }, { type: 'Next' }]),
    ).toBe(around('A [full][ref] x.\n\nNext', ending))
  })

  test('when the literal block ends the note', async () => {
    expect(
      await edit('A [full][ref] x.\n', [
        { after: 'x.' },
        { key: 'Enter' },
        { type: 'Next' },
      ]),
    ).toBe('A [full][ref] x.\n\nNext\n')
  })

  test('for an HTML block', async () => {
    expect(
      await edit('<div>\nraw *x*\n</div>\n\nAfter.\n', [
        { after: '</div>' },
        { key: 'Enter' },
        { type: 'Next' },
      ]),
    ).toBe('<div>\nraw *x*\n</div>\n\nNext\n\nAfter.\n')
  })

  test('in a footnote definition', async () => {
    expect(
      await edit('N[^1].\n\n[^1]: A [full][ref] x.\n\nAfter.\n', [
        { after: 'x.' },
        { key: 'Enter' },
        { type: 'More' },
      ]),
    ).toBe('N[^1].\n\n[^1]: A [full][ref] x.\n\n    More\n\nAfter.\n')
  })

  test('and one undo removes the paragraph', async () => {
    const source = around('A [full][ref] x.')
    expect(
      await edit(source, [{ after: 'x.' }, { key: 'Enter' }, 'undo']),
    ).toBe(source)
  })
})

describe('deleting what makes a block literal saves it as Markdown', () => {
  test.each([
    ['an unresolved reference', 'A [full][ref] x.', '[full][ref] ', 'A x.'],
    ['a shortcut reference', 'A [x] box.', '[x] ', 'A box.'],
    [
      'inline HTML',
      'Hello <span>x</span> there.',
      '<span>x</span> ',
      'Hello there.',
    ],
    [
      'inline HTML in a list',
      '- one <b>x</b>\n- two',
      ' <b>x</b>',
      '- one\n- two',
    ],
  ])('%s', async (_name, block, removed, saved) => {
    for (const ending of ['\n', '\r\n']) {
      const source = around(block, ending)
      expect(
        await edit(
          source,
          [{ select: removed }, { key: 'Backspace' }],
          (view) => expect(names(view)).not.toContain('literal_markdown'),
        ),
      ).toBe(around(saved, ending))
    }
  })

  test('in a footnote definition', async () => {
    expect(
      await edit('N[^1].\n\n[^1]: A [full][ref] x.\n\nAfter.\n', [
        { select: '[full][ref] ' },
        { key: 'Backspace' },
      ]),
    ).toBe('N[^1].\n\n[^1]: A x.\n\nAfter.\n')
  })

  test('keeps the space typed at the end', async () => {
    expect(
      await edit(around('Hello <b>x</b>'), [
        { select: '<b>x</b>' },
        { key: 'Backspace' },
        { type: 'there' },
      ]),
    ).toBe(around('Hello there'))
  })

  test('and typing continues in the paragraph', async () => {
    expect(
      await edit(around('A [full][ref] x.'), [
        { select: '[full][ref] ' },
        { key: 'Backspace' },
        { after: 'x.' },
        { type: ' More' },
      ]),
    ).toBe(around('A x. More'))
  })

  test('in one undo step, which restores the literal block', async () => {
    const source = around('A [full][ref] x.')
    expect(
      await edit(
        source,
        [{ select: '[full][ref] ' }, { key: 'Backspace' }, 'undo'],
        (view) => expect(names(view)).toContain('literal_markdown'),
      ),
    ).toBe(source)
    expect(
      await edit(source, [
        { select: '[full][ref] ' },
        { key: 'Backspace' },
        'undo',
        'redo',
      ]),
    ).toBe(around('A x.'))
  })
})

describe('a literal block inside another is read again in place', () => {
  test('in a footnote definition indented with a tab', async () => {
    expect(
      await edit('N[^1].\n\n[^1]: A [full][ref] x.\n\tmore\n\nAfter.\n', [
        { select: '[full][ref] ' },
        { key: 'Backspace' },
      ]),
    ).toBe('N[^1].\n\n[^1]: A x.\n\tmore\n\nAfter.\n')
  })

  test('as a quote', async () => {
    expect(
      await edit('> quote <b>x</b> y\n\nAfter.\n', [
        { select: ' <b>x</b>' },
        { key: 'Backspace' },
      ]),
    ).toBe('> quote y\n\nAfter.\n')
  })
})

test('front matter stays literal while its delimiter is edited', async () => {
  const source = '---\ntitle: one\n---\n\nAfter.\n'
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = ctxOf(editor)
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)),
    )
    try {
      editor.keyDown({ key: 'Backspace' }, 1)
    } catch (error) {
      expect((error as InkKitError).code).toBe('preservation')
    }
    expect(view.state.doc.firstChild!.type.name).toBe('literal_markdown')
    expect(editor.snapshot().text).toBe(source)
  } finally {
    await editor.destroy()
    root.remove()
  }
})

describe('a literal block is read again as it reads in the note', () => {
  test('with a footnote the note defines', async () => {
    expect(
      await edit(
        'Note[^1] <b>y</b>.\n\n[^1]: Foot.\n',
        [{ select: ' <b>y</b>' }, { key: 'Backspace' }],
        (view) => expect(names(view)[0]).toBe('paragraph'),
      ),
    ).toBe('Note[^1].\n\n[^1]: Foot.\n')
  })

  test('with a link definition the note holds', async () => {
    expect(
      await edit(
        'See [x] and <b>y</b>.\n\n[x]: /u\n',
        [{ select: ' <b>y</b>' }, { key: 'Backspace' }],
        (view) => expect(names(view)[0]).toBe('paragraph'),
      ),
    ).toBe('See [x] and.\n\n[x]: /u\n')
  })

  test('after TOML front matter with no blank line before it', async () => {
    const source = '+++\na = 1\n+++\nbody\n\nNext.\n'
    expect(await edit(source, [{ after: 'body' }, { type: 'x *y*' }])).toBe(
      source.replace('body', 'bodyx *y*'),
    )
  })
})

describe('a blank line typed into a literal block splits it', () => {
  test('into the blocks its text reads as', async () => {
    expect(
      await edit(
        around('A [full][ref] x.\nMore words.'),
        [{ after: 'x.\n' }, { key: 'Enter' }, { type: 'Then ' }],
        (view) =>
          expect(names(view)).toEqual([
            'paragraph',
            'literal_markdown',
            'paragraph',
            'bullet_list',
          ]),
      ),
    ).toBe(around('A [full][ref] x.\n\nThen More words.'))
  })

  test('and a line typed as a heading becomes one', async () => {
    expect(
      await edit(
        'A [full][ref] x.\nnext line\n\nAfter.\n',
        [{ after: 'x.\n' }, { type: '# ' }],
        (view) =>
          expect(names(view)).toEqual([
            'literal_markdown',
            'heading',
            'paragraph',
          ]),
      ),
    ).toBe('A [full][ref] x.\n\n# next line\n\nAfter.\n')
  })
})

test('an edit whose blocks would change other blocks is still refused', async () => {
  // As a definition, the first block would resolve the reference in the
  // second, which the editor still shows as literal.
  const source = 'A [full][ref] x.\n\nB [y][ref] z.\n'
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = ctxOf(editor)
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, 1 + 'A [full]'.length),
      ),
    )
    const before = view.state.doc
    let refused: unknown
    try {
      editor.insertText('[ref]: /u\n\n[full]', 1)
    } catch (error) {
      refused = error
    }
    expect(refused).toBeInstanceOf(InkKitError)
    expect((refused as InkKitError).code).toBe('preservation')
    expect(view.state.doc.eq(before)).toBe(true)
    expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
  } finally {
    await editor.destroy()
    root.remove()
  }
})
