import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { InkKitEditor } from '../src/index'
import { Preservation, decodedOffsets } from '../src/preserve'

async function run(
  callback: (editor: InkKitEditor, ctx: Ctx, errors: Error[]) => void,
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
    callback(editor, ctx, errors)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = { documentId: 'lines', generation: 1, format: 'md' as const }

const content = (doc: ProseNode) =>
  JSON.stringify(doc.toJSON(), (key, value) =>
    key === 'id' ? undefined : value,
  )

// Types `text` after the first occurrence of `word`.
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

// [loaded, word typed after, saved]
const cases: Array<[string, string, string, string]> = [
  ['a list item', '- one\n- two\n  more\n', 'two', '- one\n- twos\n  more\n'],
  [
    'a list item with CRLF',
    '- one\r\n- two\r\n  more\r\n',
    'two',
    '- one\r\n- twos\r\n  more\r\n',
  ],
  [
    'a wide ordered item',
    '1.  two\n    more text\n',
    'two',
    '1.  twos\n    more text\n',
  ],
  [
    'a footnote definition',
    'See[^1].\n\n[^1]: note one\n    note two\n',
    'note one',
    'See[^1].\n\n[^1]: note ones\n    note two\n',
  ],
  [
    'an indented paragraph line',
    'para one\n   indented two\n',
    'para',
    'paras one\n   indented two\n',
  ],
  [
    'the indented line itself',
    'para one\n   indented two\n',
    'indented',
    'para one\n   indenteds two\n',
  ],
  [
    'a line with a trailing space',
    'para one \n  two\n',
    'one',
    'para ones \n  two\n',
  ],
  ['a tab-indented line', 'para one\n\ttwo\n', 'two', 'para one\n\ttwos\n'],
  [
    'a paragraph with lone CR line endings',
    'para one\r   two\r',
    'one',
    'para ones\r   two\r',
  ],
  [
    'a list item in a quote',
    '> - one\n>   more\n',
    'one',
    '> - ones\n>   more\n',
  ],
  [
    'a quoted line with extra indentation',
    '> one\n>    more\n',
    'more',
    '> one\n>    mores\n',
  ],
  [
    'a nested list item',
    '- outer\n  - inner\n    more\n',
    'inner',
    '- outer\n  - inners\n    more\n',
  ],
  [
    'a list item with a link',
    '- see https://example.com now\n  more\n',
    'more',
    '- see https://example.com now\n  mores\n',
  ],
  [
    'a list item with an emphasized line',
    '- *one*\n  more\n',
    'more',
    '- *one*\n  mores\n',
  ],
  [
    'a line after a hard break',
    '- one  \n  two\n  three\n',
    'two',
    '- one  \n  twos\n  three\n',
  ],
  [
    'a line after a backslash break',
    '- one\\\n  two\n  three\n',
    'three',
    '- one\\\n  two\n  threes\n',
  ],
]

for (const [name, source, word, saved] of cases)
  test(`typing in ${name} keeps the other lines as written`, () =>
    run((editor, ctx, errors) => {
      editor.loadDocument({ ...input, text: source })
      typeAfter(ctx, word, 's')
      expect(errors).toEqual([])
      const edited = content(ctx.get(editorViewCtx).state.doc)
      const text = editor.snapshot().text
      expect(text).toBe(saved)
      // The whole-document path writes the same text as the local one.
      const whole = new Preservation(ctx, source)
      ;(whole as unknown as { localEdits(): undefined }).localEdits = () =>
        undefined
      expect(whole.serialize(ctx.get(editorViewCtx).state.doc)).toBe(saved)
      editor.loadDocument({ ...input, generation: 2, text })
      expect(content(ctx.get(editorViewCtx).state.doc)).toBe(edited)
    }))

test('joining two lines removes the line ending and the indentation after it', () =>
  run((editor, ctx, errors) => {
    editor.loadDocument({ ...input, text: '- two \n  more\n- three\n' })
    const view = ctx.get(editorViewCtx)
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === 'hardbreak') at = pos
    })
    view.dispatch(view.state.tr.insertText(' ', at, at + 1))
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe('- two more\n- three\n')
  }))

test('splitting an address on an indented line keeps the indentation', () =>
  run((editor, ctx, errors) => {
    editor.loadDocument({
      ...input,
      text: '- one\n  https://a.example/xy\n',
    })
    typeAfter(ctx, 'https://a.example/x', ' ')
    expect(errors).toEqual([])
    expect(editor.snapshot().text).toBe('- one\n  https://a.example/x y\n')
  }))

// A busy machine slows a sample but never speeds one up, so the fastest of
// many samples is the least disturbed. The sizes are sampled in turn, so a
// stall slows both. Reading 20,000 spaces takes about 10 times as long as
// reading 2,000 when time grows linearly and about 100 times when it grows
// quadratically; the bound lies between.
test('reading a long run of spaces takes time linear in its length', () => {
  const time = (spaces: number) => {
    const raw = `a${' '.repeat(spaces)}b\n  c`
    const start = performance.now()
    expect(decodedOffsets(raw, true)?.decoded).toBe(
      `a${' '.repeat(spaces)}b\nc`,
    )
    return performance.now() - start
  }
  for (let i = 0; i < 3; i++) {
    time(2_000)
    time(20_000)
  }
  let fastestSmall = Infinity
  let fastestLarge = Infinity
  for (let i = 0; i < 15; i++) {
    fastestSmall = Math.min(fastestSmall, time(2_000))
    fastestLarge = Math.min(fastestLarge, time(20_000))
  }
  expect(fastestLarge).toBeLessThan(Math.max(fastestSmall, 0.1) * 40)
}, 120_000)
