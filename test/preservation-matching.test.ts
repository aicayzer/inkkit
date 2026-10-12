import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { InkKitEditor } from '../src/index'
import { correspondence, Preservation } from '../src/preserve'
import { withEditor } from './harness'

const kinds = [
  (i: number, w: string) => `__Kept ${i}__ [link ${i}](/k/${i}) ${w} here.`,
  (i: number, w: string) => `* first ${i} ${w}\n* second ${i}`,
  (i: number, w: string) => `> quoted ${i} ${w}`,
  (i: number, w: string) => '```ts\nconst a' + i + ` = "${w}";\n` + '```',
  (i: number, w: string) => `| A | B |\n| - | - |\n| ${w} ${i} | x |`,
  (i: number, w: string) =>
    `Note ${i} ${w}[^n${i}]\n\n[^n${i}]: Footnote ${i}.`,
  (i: number, w: string) => `# Heading ${i} ${w}`,
]

// Every block mentions "word" only when it is one of the `changed` ones.
function mixedSource(blocks: number, changed: number): string {
  const every = blocks / changed
  return (
    Array.from({ length: blocks }, (_, i) => {
      const edit = Math.floor((i + 1) / every) > Math.floor(i / every)
      return kinds[i % kinds.length]!(i, edit ? 'word' : 'plain')
    }).join('\n\n') + '\n'
  )
}

const shape = (doc: ProseNode) =>
  JSON.stringify(doc.toJSON(), (key, value) =>
    key === 'id' || key === 'marker' ? undefined : value,
  )

async function mount(
  text: string,
  callback: (editor: InkKitEditor, ctx: Ctx) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    stateChanged() {},
    copy() {},
    openLink() {},
  })
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  editor.loadDocument({
    documentId: 'matching',
    generation: 1,
    format: 'md',
    text,
  })
  try {
    await callback(editor, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

for (const [blocks, changed] of [
  [60, 20],
  [1000, 300],
  [2000, 1000],
] as const) {
  test(
    `Replace All saves ${changed} changed of ${blocks} mixed blocks and keeps the rest byte-identical`,
    () =>
      mount(mixedSource(blocks, changed), (editor, ctx) => {
        const source = editor.snapshot().text
        const expected = source.replaceAll('word', 'term')
        expect(editor.replaceAll('word', 'term')).toBeGreaterThanOrEqual(
          changed,
        )
        const saved = editor.snapshot().text
        expect(saved).toBe(expected)
        expect(shape(ctx.get(parserCtx)(saved))).toBe(
          shape(ctx.get(editorViewCtx).state.doc),
        )
        expect(editor.undo(1)).toBe(true)
        expect(editor.snapshot().text).toBe(source)
        expect(editor.redo(1)).toBe(true)
        expect(editor.snapshot().text).toBe(expected)
      }),
    60_000,
  )
}

const authored = (i: number) => `__Block ${i}__ [link](/keep/${i})`

// Saves `after` against `before` and checks that the result reopens to `after`.
function saveAs(
  ctx: Ctx,
  before: string,
  after: string,
  expected: string | null = after,
): string {
  const parse = ctx.get(parserCtx)
  const saved = new Preservation(ctx, before).serialize(parse(after))
  if (expected !== null) expect(saved).toBe(expected)
  expect(shape(parse(saved))).toBe(shape(parse(after)))
  return saved
}

const join = (blocks: string[]) => blocks.join('\n\n') + '\n'

test('changing, inserting and deleting hundreds of distinct blocks retains every untouched block', () => {
  const before = Array.from({ length: 1500 }, (_, i) => authored(i))
  // Spacing the three kinds of change apart keeps each one unambiguous.
  const after = before.flatMap((block, i) =>
    i % 9 === 0
      ? [block.replace('Block', 'Edited')]
      : i % 9 === 3
        ? [block, `Inserted ${i}`]
        : i % 9 === 6
          ? []
          : [block],
  )
  return withEditor(join(before), (editor) => {
    saveAs(editor.ctx, join(before), join(after))
    saveAs(editor.ctx, join(after), join(before), null)
    for (const kind of [0, 3, 6])
      saveAs(
        editor.ctx,
        join(before),
        join(
          before.flatMap((block, i) =>
            i % 9 !== kind
              ? [block]
              : kind === 0
                ? [block.replace('Block', 'Edited')]
                : kind === 3
                  ? [block, `Inserted ${i}`]
                  : [],
          ),
        ),
      )
  })
}, 60_000)

test('moved blocks are rewritten canonically while everything between them keeps its source', () => {
  const plain = (i: number) => `Plain ${i}`
  const before = Array.from({ length: 1000 }, (_, i) =>
    i % 10 === 0 ? plain(i) : authored(i),
  )
  const after = [...before]
  ;[after[100], after[900]] = [after[900]!, after[100]!]
  const run = after.splice(600, 5)
  after.splice(300, 0, ...run)
  // A moved block has no source to retain once it leaves its place.
  const moved = new Set(run)
  const expected = after.map((block) =>
    moved.has(block) ? block.replaceAll('__', '**') : block,
  )
  return withEditor(join(before), (editor) => {
    saveAs(editor.ctx, join(before), join(after), join(expected))
  })
}, 60_000)

test('repeated identical blocks align without unique anchors', () => {
  const repeated = ['__Same__ [a](/a)', '* * *', '__Other__ [b](/b)']
  const before = Array.from(
    { length: 1200 },
    (_, i) => repeated[i % repeated.length]!,
  )
  const after = before
    .filter((_, i) => i % 11 !== 5)
    .map((block, i) => (i % 97 === 3 ? `Changed ${i}` : block))
  return withEditor(join(before), (editor) => {
    saveAs(editor.ctx, join(before), join(after))
    const grown = before.flatMap((block, i) =>
      i % 40 === 0 ? [block, block] : [block],
    )
    const saved = saveAs(editor.ctx, join(before), join(grown), null)
    expect(saved.split('* * *').length).toBe(join(before).split('* * *').length)
  })
}, 60_000)

test(
  'a Replace All over repeated and distinct blocks keeps untouched source',
  () =>
    mount(
      join(
        Array.from({ length: 1500 }, (_, i) =>
          i % 4 === 0 ? '* * *' : i % 3 === 0 ? `__word__ ${i}` : authored(i),
        ),
      ),
      (editor) => {
        const source = editor.snapshot().text
        expect(editor.replaceAll('word', 'term')).toBeGreaterThan(300)
        expect(editor.snapshot().text).toBe(source.replaceAll('word', 'term'))
      },
    ),
  60_000,
)

test('block correspondence pairs unchanged blocks with themselves and never an unchanged block with different content', () => {
  let seed = 7
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  for (let round = 0; round < 300; round++) {
    const before = Array.from(
      { length: 1 + Math.floor(random() * 200) },
      (_, i) => `B${i}`,
    )
    const rate = [0.02, 0.2, 0.6, 0.95][round % 4]!
    const after = before.flatMap((block, i) => {
      const roll = random()
      return roll < rate / 3
        ? [`E${round}-${i}`]
        : roll < (2 * rate) / 3
          ? []
          : roll < rate
            ? [block, `I${round}-${i}`]
            : [block]
    })
    const positions = correspondence(before, after)
    expect(positions).toHaveLength(after.length)
    let previous = -1
    for (const [index, position] of positions.entries()) {
      if (position === undefined) continue
      expect(position).toBeGreaterThan(previous)
      previous = position
      if (before[position] !== after[index])
        // Only blocks that no longer exist anywhere can stand in for each other.
        expect([
          after.includes(before[position]!),
          before.includes(after[index]!),
        ]).toEqual([false, false])
    }
    for (const [index, block] of after.entries())
      if (before.includes(block)) expect(before[positions[index]!]).toBe(block)
  }
})
