import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { InkKitEditor } from '../src/index'

async function run(
  callback: (
    editor: InkKitEditor,
    ctx: Ctx,
    root: HTMLElement,
    errors: Error[],
  ) => void,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    },
    {},
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    callback(editor, ctx, root, errors)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = { documentId: 'marks', generation: 1, format: 'md' as const }

// What a reopened document must keep. A reference link's record of its
// authored text is refreshed on reopening.
const content = (doc: ProseNode) =>
  JSON.stringify(doc.toJSON(), (key, value) =>
    key === 'id' || key === 'referenceContent' ? undefined : value,
  )

function typeAfter(ctx: Ctx, word: string, text: string) {
  const view = ctx.get(editorViewCtx)
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(word))
      at = pos + node.text!.indexOf(word) + word.length
  })
  expect(at).toBeGreaterThan(0)
  view.dispatch(view.state.tr.insertText(text, at))
}

// The marks on the text on each side of the comment.
function marksBeside(doc: ProseNode): string[][] {
  const found: string[][] = []
  doc.descendants((node) => {
    if (node.isText && /Inline|here/.test(node.text!))
      found.push(node.marks.map((mark) => mark.type.name))
    return node.type.name !== 'comment_inline'
  })
  return found
}

// [name, delimiters before, delimiters after, mark, element]
const marks: Array<[string, string, string, string, string]> = [
  ['emphasis', '*', '*', 'emphasis', 'em'],
  ['emphasis with underscores', '_', '_', 'emphasis', 'em'],
  ['strong', '**', '**', 'strong', 'strong'],
  ['strong with underscores', '__', '__', 'strong', 'strong'],
  ['strikethrough', '~~', '~~', 'strike_through', 'del'],
  ['highlight', '==', '==', 'highlight', 'mark'],
  ['a link', '[', '](/u)', 'link', 'a'],
  ['a reference link', '[', '][r]', 'link', 'a'],
]
const comments = ['<!-- secret -->', '%%secret%%']

for (const [name, open, close, mark, element] of marks)
  for (const comment of comments) {
    const definitions = close === '][r]' ? '\n[r]: /u\n' : ''
    const source = `${open}Inline ${comment} here.${close}\n${definitions}`
    const label = `${comment.startsWith('<') ? 'an HTML' : 'an Obsidian'} comment inside ${name}`

    test(`${label} keeps the mark on both sides`, () =>
      run((editor, ctx, root) => {
        editor.loadDocument({ ...input, text: source })
        expect(marksBeside(ctx.get(editorViewCtx).state.doc)).toEqual([
          [mark],
          [mark],
        ])
        const after = [...root.querySelectorAll(element)].filter((node) =>
          node.textContent?.includes('here.'),
        )
        expect(after).toHaveLength(1)
        expect(editor.snapshot().text).toBe(source)
      }))

    for (const [where, word] of [
      ['before', 'Inl'],
      ['after', 'he'],
    ] as const)
      test(`${label} keeps its source when typing ${where} it`, () =>
        run((editor, ctx, _root, errors) => {
          editor.loadDocument({ ...input, text: source })
          typeAfter(ctx, word, 'X')
          expect(errors).toEqual([])
          const edited = content(ctx.get(editorViewCtx).state.doc)
          const text = editor.snapshot().text
          expect(text).toBe(source.replace(word, `${word}X`))
          editor.loadDocument({ ...input, generation: 2, text })
          expect(content(ctx.get(editorViewCtx).state.doc)).toBe(edited)
        }))
  }

test('a comment between formatted words in a longer paragraph keeps the source around it', () =>
  run((editor, ctx, _root, errors) => {
    const source = 'Start **bold <!-- a --> more** then *one %%b%% two* end.\n'
    editor.loadDocument({ ...input, text: source })
    typeAfter(ctx, 'Start', '!')
    typeAfter(ctx, 'end', '!')
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe(
      'Start! **bold <!-- a --> more** then *one %%b%% two* end!.\n',
    )
  }))

test('a comment at the edge of formatting stays outside it', () =>
  run((editor, ctx, _root, errors) => {
    const source = '**bold** <!-- a --> plain and <!-- b -->*em*\n'
    editor.loadDocument({ ...input, text: source })
    typeAfter(ctx, 'plain', '!')
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe(
      '**bold** <!-- a --> plain! and <!-- b -->*em*\n',
    )
  }))
