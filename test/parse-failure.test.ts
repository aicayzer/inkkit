import { ctxOf } from './editor-access'
import { describe, expect, test } from 'vitest'
import { editorViewCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { Nodes, Parents, Root } from 'mdast'
import { InkKitEditor, InkKitError } from '../src/index'

// Milkdown drops a node it cannot build, and everything inside it, and logs the failure. A document
// that loaded short of its source would then save only what is left the moment it is edited.
//
// Every parser failure is forced here by a remark plugin added to the editor's own processor. The
// node that directly holds the text `FAIL` becomes a quote holding bare text, which the schema
// does not allow (Milkdown's `createNodeInParserFail`), so Milkdown would drop that node and leave
// its parent short. `UNKNOWN` becomes a node type with no parser (`parserMatchError`). `NOWHERE`
// adds an unknown node without a source position, which cannot be kept as source.

const holds = (node: Nodes, value: string): boolean =>
  'children' in node &&
  node.children.some((child) => child.type === 'text' && child.value === value)

function forceFailures() {
  return (tree: Root) => {
    let nowhere = false
    const replace = (node: Nodes): Nodes => {
      if (holds(node, 'NOWHERE')) nowhere = true
      if (holds(node, 'FAIL'))
        return {
          type: 'blockquote',
          children: [{ type: 'text', value: 'FAIL' }],
          position: node.position,
        } as unknown as Nodes
      if (node.type === 'text' && node.value === 'UNKNOWN')
        return { type: 'inkkitUnknown', position: node.position } as never
      if ('children' in node)
        (node as Parents).children = node.children.map(
          replace,
        ) as Parents['children']
      return node
    }
    tree.children = tree.children.map(replace) as Root['children']
    if (nowhere) tree.children.push({ type: 'inkkitUnknown' } as never)
  }
}

async function run(
  action: (editor: InkKitEditor, ctx: Ctx, root: HTMLElement) => void,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  const ctx = ctxOf(editor)
  ctx.set(remarkCtx, ctx.get(remarkCtx).copy().use(forceFailures))
  try {
    action(editor, ctx, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function load(editor: InkKitEditor, text: string, generation = 1): void {
  editor.loadDocument({ documentId: 'note', generation, format: 'md', text })
}

/** Puts the caret at the end of the first text that contains `word`. */
function caretAfter(ctx: Ctx, word: string): void {
  const view = ctx.get(editorViewCtx)
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(word))
      at = pos + node.text!.indexOf(word) + word.length
  })
  if (at < 0) throw new Error(`No ${word}`)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
  )
}

function failure(call: () => unknown): InkKitError {
  try {
    call()
  } catch (error) {
    expect(error).toBeInstanceOf(InkKitError)
    return error as InkKitError
  }
  throw new Error('The call did not fail')
}

const blocks: Array<[string, string]> = [
  ['a top-level block', 'FAIL'],
  ['a list item', '- one\n- FAIL\n- three'],
  ['an ordered list item', '3. one\n4. FAIL'],
  ['a task list item', '- [ ] one\n- [x] FAIL'],
  ['a quote', '> one\n>\n> FAIL'],
  ['a callout', '> [!NOTE]\n> one\n>\n> FAIL'],
  ['a callout in a list', '- one\n\n  > [!TIP]\n  > FAIL'],
  ['a table cell', '| A | B |\n| --- | :-: |\n| 1 | FAIL |'],
  ['a heading', '## Heading **FAIL**'],
  ['emphasis', 'Some *FAIL* text'],
  ['a node type with no parser', '- one\n- UNKNOWN'],
  ['a table cell with no parser', '| A |\n| --- |\n| UNKNOWN |'],
]

describe('a block that cannot be built is kept as source', () => {
  test.each(blocks)('in %s', async (_name, block) => {
    for (const [bom, ending] of [
      ['', '\n'],
      ['', '\r\n'],
      ['\uFEFF', '\n'],
    ]) {
      const source =
        bom +
        `# Title\n\nBefore.\n\n${block}\n\nAfter.\n`.replace(/\n/g, ending!)
      await run((editor, ctx, root) => {
        load(editor, source)
        expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
        // The rest of the document is still formatted and editable.
        expect(root.querySelector('h1')?.textContent).toBe('Title')
        expect(
          [...root.querySelectorAll('pre.inkkit-literal-markdown')].map(
            (pre) => pre.textContent,
          ),
        ).toEqual([block.replace(/\n/g, ending!)])

        caretAfter(ctx, 'After.')
        expect(editor.insertText(' More', 1)).toBe(true)
        expect(editor.snapshot().text).toBe(
          source.replace('After.', 'After. More'),
        )
        caretAfter(ctx, 'Before.')
        expect(editor.insertText(' Less', 1)).toBe(true)
        const saved = source
          .replace('Before.', 'Before. Less')
          .replace('After.', 'After. More')
        expect(editor.snapshot().text).toBe(saved)
        // Reopening what was saved keeps the block as source again.
        load(editor, saved, 2)
        expect(editor.snapshot(2).text).toBe(saved)
        expect(
          root.querySelectorAll('pre.inkkit-literal-markdown'),
        ).toHaveLength(1)
      })
    }
  })

  test('when it is the whole note, typing never saves over it', async () => {
    await run((editor) => {
      for (const source of ['FAIL\n', '- one\n- FAIL\n']) {
        load(editor, source, source.length)
        expect(editor.snapshot().text).toBe(source)
        // The caret is in the kept source; what is typed becomes part of it or is refused.
        let saved = source
        try {
          editor.insertText('Edit', source.length)
          saved = editor.snapshot().text
        } catch (error) {
          expect((error as InkKitError).code).toBe('preservation')
        }
        expect(saved.replace('Edit', '')).toBe(source)
      }
    })
  })

  test('when it comes from source mode', async () => {
    await run((editor, ctx, root) => {
      load(editor, 'Start.\n')
      editor.setEditingMode('source', 1)
      const source = 'Start.\n\n- one\n- FAIL\n\nAfter.\n'
      editor.replaceSource(source, 1)
      editor.setEditingMode('formatted', 1)
      expect(editor.snapshot().text).toBe(source)
      expect(
        root.querySelector('pre.inkkit-literal-markdown')?.textContent,
      ).toBe('- one\n- FAIL')
      caretAfter(ctx, 'After.')
      editor.insertText(' More', 1)
      expect(editor.snapshot().text).toBe(
        source.replace('After.', 'After. More'),
      )
    })
  })

  test('when Markdown characters are typed into it', async () => {
    await run((editor, ctx) => {
      for (const [generation, ending] of [
        [1, '\n'],
        [3, '\r\n'],
      ] as const) {
        const source =
          'Before.\n\n- one\n- FAIL\n\nMiddle *one*.\n\n1) two\n\nAfter.\n'.replace(
            /\n/g,
            ending,
          )
        load(editor, source, generation)
        caretAfter(ctx, 'one')
        for (const character of '*_[]\\`<')
          editor.insertText(character, generation)
        const saved = source.replace('one', 'one*_[]\\`<')
        expect(editor.snapshot(generation).text).toBe(saved)
        load(editor, saved, generation + 1)
        expect(editor.snapshot(generation + 1).text).toBe(saved)
        const kept = ctx.get(editorViewCtx).state.doc.child(1)
        expect(kept.type.name).toBe('literal_markdown')
        expect(kept.textContent).toBe(
          '- one*_[]\\`<\n- FAIL'.replace(/\n/g, ending),
        )
      }
    })
  })

  // Milkdown could not build a callout whose last paragraph is a lone HTML break; it now loads
  // formatted, and must still save as written.
  test('for a callout that ends in a line break', async () => {
    await run((editor, ctx) => {
      const source = '> [!NOTE]\n> Body\n>\n> <br />\n\nAfter.\n'
      load(editor, source)
      expect(editor.snapshot().text).toBe(source)
      caretAfter(ctx, 'After.')
      editor.insertText(' More', 1)
      expect(editor.snapshot().text).toBe(
        source.replace('After.', 'After. More'),
      )
    })
  })
})

describe('a note that cannot be kept as source is not loaded', () => {
  const unloadable = 'Before.\n\nNOWHERE\n'

  test('on the first load', async () => {
    await run((editor) => {
      expect(failure(() => load(editor, unloadable)).code).toBe('preservation')
      expect(failure(() => editor.snapshot()).code).toBe('not-ready')
      load(editor, 'Fine.\n')
      expect(editor.snapshot().text).toBe('Fine.\n')
    })
  })

  test.each(['loadDocument', 'reloadDocument'] as const)(
    'and %s changes nothing',
    async (method) => {
      await run((editor, ctx) => {
        load(editor, 'Kept.\n')
        caretAfter(ctx, 'Kept')
        editor.insertText(' text', 1)
        const before = editor.snapshot()
        const selection = ctx.get(editorViewCtx).state.selection
        const input = {
          documentId: 'note',
          generation: 2,
          format: 'md',
          text: unloadable,
        } as const
        const error = failure(() =>
          method === 'loadDocument'
            ? editor.loadDocument(input)
            : editor.reloadDocument(input, 1),
        )
        expect(error.code).toBe('preservation')
        expect(editor.snapshot()).toEqual(before)
        expect(ctx.get(editorViewCtx).state.selection.eq(selection)).toBe(true)
        // The failed load did not take the generation.
        editor.undo(1)
        expect(editor.snapshot().text).toBe('Kept.\n')
        load(editor, 'Next.\n', 2)
        expect(editor.snapshot().text).toBe('Next.\n')
      })
    },
  )
})
