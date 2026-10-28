import { ctxOf, withFacade, facadeFixture } from './editor-access'
import { expectFacadeSave } from './facade-preservation'
import { afterAll, describe, expect, test } from 'vitest'
import { editorViewCtx, parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { TextSelection } from '@milkdown/kit/prose/state'
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
  (i: number, w: string) => `<div>\nhtml ${i} ${w}\n</div>`,
  (i: number, w: string) => `Unresolved ${i} ${w} [x][missing]\nnext line`,
]

// Every block mentions "word" only when it is one of the `changed` ones.
function mixedSource(blocks: number, changed: number, ending: string): string {
  const every = blocks / changed
  return (
    ['---\ntitle: word\n---']
      .concat(
        Array.from({ length: blocks }, (_, i) => {
          const edit = Math.floor((i + 1) / every) > Math.floor(i / every)
          return kinds[i % kinds.length]!(i, edit ? 'word' : 'plain')
        }),
      )
      .join('\n\n')
      .replaceAll('\n', ending) + ending
  )
}

// Heading form, IDs and delimiter markers are presentation; saved bytes are checked separately.
const shape = (doc: ProseNode) =>
  JSON.stringify(doc.toJSON(), (key, value) =>
    key === 'id' || key === 'marker' || key === 'form' ? undefined : value,
  )

async function mount(
  text: string,
  callback: (editor: InkKitEditor, ctx: Ctx) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  const ctx = ctxOf(editor)
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

for (const [blocks, changed, ending] of [
  [60, 20, '\n'],
  [1000, 300, '\n'],
  [2000, 1000, '\n'],
  [60, 20, '\r\n'],
  [1000, 300, '\r\n'],
] as const) {
  test(
    `Replace All saves ${changed} changed of ${blocks} mixed blocks with ${JSON.stringify(ending)} line endings and keeps the rest byte-identical`,
    () =>
      mount(mixedSource(blocks, changed, ending), (editor, ctx) => {
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

test('deleting the first block and adding one at the end keeps the unchanged block between them', () =>
  withEditor('x\n', (editor) => {
    // Edit distance alone ties here and pairs the unchanged block with the deleted one.
    saveAs(
      editor.ctx,
      '_Draft_ note\n\n* one\n* two\n',
      '* one\n* two\n\nAdded\n',
    )
    saveAs(
      editor.ctx,
      '__Intro__ text\n\n_Kept_ [l](/k)\n',
      '_Kept_ [l](/k)\n\nAdded\n',
    )
    // Repeated blocks cannot anchor, so only the alignment keeps them apart.
    saveAs(
      editor.ctx,
      '__Intro__ text\n\n_Same_\n\n_Same_\n',
      '_Same_\n\n_Same_\n\nAdded\n',
    )
  }))

test('typing in a block keeps its own source when a neighbour was deleted', () =>
  mount('start\n\n+ one\n+ two\n\n__bold__ para\n\nend\n', (editor, ctx) => {
    const view = ctx.get(editorViewCtx)
    const list = view.state.doc.child(0).nodeSize
    const paragraph = list + view.state.doc.child(1).nodeSize
    view.dispatch(
      view.state.tr.delete(
        paragraph,
        paragraph + view.state.doc.child(2).nodeSize,
      ),
    )
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, paragraph - 3),
      ),
    )
    editor.insertText('!', 1)
    expect(editor.snapshot().text).toBe('start\n\n+ one\n+ two!\n\nend\n')
  }))

test('an edited block keeps its own source beside inserted and deleted blocks', () =>
  withEditor('x\n', (editor) => {
    // The deleted block comes first.
    saveAs(editor.ctx, '__alpha__ one\n\n__beta__ two\n', '__beta__ two!\n')
    saveAs(
      editor.ctx,
      'start\n\n__bold__ para\n\n+ one\n+ two\n\nend\n',
      'start\n\n+ one\n+ two!\n\nend\n',
    )
    // A new block next to an edited one, with a deletion in the same gap.
    saveAs(
      editor.ctx,
      '# Top\n\n_Note 3_ text [l](/3)\n\n<div>\nhtml\n</div>\n\nend\n',
      '# Top\n\n_Note 10_ text [l](/10)\n\n_Note 3_ text typed [l](/3)\n\nend\n',
      '# Top\n\n*Note 10* text [l](/10)\n\n_Note 3_ text typed [l](/3)\n\nend\n',
    )
    saveAs(
      editor.ctx,
      '* * *\n\nTitle 4\n===\n',
      'Title 4 typed\n===\n\nTitle 6\n===\n',
      'Title 4 typed\n===\n\n# Title 6\n',
    )
  }))

test('swapping two adjacent lists and editing both still saves', () =>
  withEditor('x\n', (editor) => {
    // Pairing one list by resemblance leaves the other in canonical form, where
    // it would merge with its neighbour unless it takes another marker.
    saveAs(
      editor.ctx,
      '- item one\n- item two\n\n* star one\n* star two\n\nEnd\n',
      '* star NEW one\n* star two\n\n- item one edited\n- item two\n\nEnd\n',
      null,
    )
  }))

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

for (const ending of ['\n', '\r\n'])
  test(
    `a Replace All over repeated and distinct blocks with ${JSON.stringify(ending)} line endings keeps untouched source`,
    () =>
      mount(
        join(
          Array.from({ length: 1500 }, (_, i) =>
            i % 4 === 0
              ? '* * *'
              : i % 3 === 0
                ? `__word__ [${i}](/w/${i})`
                : authored(i),
          ),
        ).replaceAll('\n', ending),
        (editor) => {
          const source = editor.snapshot().text
          expect(editor.replaceAll('word', 'term')).toBeGreaterThan(300)
          expect(editor.snapshot().text).toBe(source.replaceAll('word', 'term'))
        },
      ),
    60_000,
  )

for (const ending of ['\n', '\r\n'])
  test(`Replace All keeps authored syntax when a ${JSON.stringify(ending)} document opens with a thematic break`, () => {
    // InkKit writes a rule as `---`; opening a document, that would read back
    // as front matter closed by the next `---` rule.
    const source = [
      '***',
      '__word__ one [link][r]',
      '***',
      '__word__ two',
      '[r]: /x',
    ]
      .join('\n\n')
      .replaceAll('\n', ending)
    return mount(source + ending, (editor) => {
      expect(editor.replaceAll('word', 'term')).toBe(2)
      expect(editor.snapshot().text).toBe(
        (source + ending).replaceAll('word', 'term'),
      )
    })
  })

for (const ending of ['\n', '\r\n'])
  test(`Replace All in ${JSON.stringify(ending)} front matter keeps its line endings`, () => {
    const source = '---\ntitle: word\n---\n\nbody\n'.replaceAll('\n', ending)
    return mount(source, (editor) => {
      expect(editor.replaceAll('word', 'term')).toBe(1)
      expect(editor.snapshot().text).toBe(source.replace('word', 'term'))
    })
  })

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

interface Edited {
  text: string
  origin?: number
  edited?: boolean
  moved?: boolean
  edit?: (text: string) => string
}

const typed = (text: string) => `${text} typed`
const typedBefore = (marker: string) => (text: string) =>
  text.slice(0, text.lastIndexOf(marker)) +
  ' typed' +
  text.slice(text.lastIndexOf(marker))
// Each template uses syntax that differs from InkKit's canonical form.
const distinctBlocks: Array<[(i: number) => string, Edited['edit']]> = [
  [(i) => `__Bold ${i}__ para`, typed],
  [(i) => `_Note ${i}_ text [link](/l/${i})`, typedBefore(' [link]')],
  [(i) => `+ item ${i}\n+ second ${i}`, typed],
  [(i) => `1) first ${i}\n2) second ${i}`, typed],
  [(i) => `Title ${i}\n===`, typedBefore('\n===')],
  [(i) => `> __Quote ${i}__ said`, typed],
  [(i) => `~~~\ncode ${i}\n~~~`, typedBefore('\n~~~')],
  [(i) => `<div>\nhtml ${i}\n</div>`, typedBefore('\n</div>')],
  [(i) => `Plain ${i} words`, typed],
]
const repeatedBlocks: Array<[() => string, Edited['edit']]> = [
  [() => '_Same_', typed],
  [() => '__Twin__ copy', typed],
  [() => '* * *', undefined],
  [() => '> _echo_', typed],
]

// Deletions beside edits, inserts, moves and repeated blocks, with either line ending.
function randomEdit(seed: number) {
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
  const ending = random() < 0.5 ? '\n' : '\r\n'
  const repeats = pick([0, 0.3, 0.7])
  let id = 0
  const fresh = (): Edited => {
    const [make, edit] =
      random() < repeats ? pick(repeatedBlocks) : pick(distinctBlocks)
    return { text: make(id++), edit }
  }
  const before = Array.from({ length: 2 + Math.floor(random() * 28) }, fresh)
  if (random() < 0.15)
    before.unshift({
      text: '---\ntitle: front\n---',
      edit: typedBefore('\n---'),
    })
  const after: Edited[] = before.map((block, origin) => ({ ...block, origin }))
  const edit = (index: number) => {
    const block = after[index]
    if (block?.edit)
      after[index] = { ...block, text: block.edit(block.text), edited: true }
  }
  for (let step = 1 + Math.floor(random() * 4); step && after.length; step--) {
    const index = Math.floor(random() * after.length)
    const kind = pick(['delete', 'edit', 'insert', 'move', 'beside', 'beside'])
    if (kind === 'delete') after.splice(index, 1)
    else if (kind === 'edit') edit(index)
    else if (kind === 'insert')
      after.splice(index + Math.floor(random() * 2), 0, fresh())
    else if (kind === 'move') {
      const [block] = after.splice(index, 1)
      after.splice(Math.floor(random() * (after.length + 1)), 0, {
        ...block!,
        moved: block!.origin !== undefined,
      })
    } else {
      const neighbour = index + (random() < 0.5 ? -1 : 1)
      if (neighbour < 0 || neighbour >= after.length) continue
      edit(neighbour)
      after.splice(index, 1)
    }
  }
  const markdown = (blocks: Edited[]) =>
    blocks
      .map((block) => block.text.replaceAll('\n', ending))
      .join(ending + ending) + ending
  return { before, after, source: markdown(before), edited: markdown(after) }
}

describe('random edits keep every unchanged block and the authored syntax of edited ones', () => {
  const facade = facadeFixture('x\n')
  let checked = 0
  let visited = 0
  afterAll(() => {
    // A focused seed run does not claim coverage of the whole sample.
    if (visited === 800) expect(checked).toBeGreaterThan(500)
  })
  test.for(Array.from({ length: 800 }, (_, index) => index + 1))(
    'seed %i',
    (seed, context) => {
      visited++
      const editor = facade()
      const parse = ctxOf(editor).get(parserCtx)
      const processor = ctxOf(editor).get(remarkCtx)
      const blocks = (text: string) =>
        (processor.runSync(processor.parse(text), { value: text }) as Root)
          .children
      const { before, after, source, edited } = randomEdit(seed)
      // Adjacent lists of one kind merge into one block; skip those documents.
      if (
        blocks(source).length !== before.length ||
        blocks(edited).length !== after.length
      )
        context.skip(
          'Adjacent lists merge, so block correspondence is ambiguous',
        )
      checked++
      const saved = new Preservation(ctxOf(editor), source).serialize(
        parse(edited),
      )
      expectFacadeSave(editor, source, parse(edited), saved, `seed ${seed}`)
      const nodes = blocks(saved)
      expect(nodes).toHaveLength(after.length)
      const ending = source.includes('\r\n') ? '\r\n' : '\n'
      // Which copy of a repeated block was kept, inserted or moved is ambiguous,
      // and a moved block is rewritten by design.
      const ambiguous = after.some(
        (block) =>
          block.moved ||
          (block.origin === undefined &&
            before.some((original) => original.text === block.text)) ||
          (block.edited &&
            before.filter(
              (original) => original.text === before[block.origin!]?.text,
            ).length > 1),
      )
      const inserted = after.some((block) => block.origin === undefined)
      after.forEach((block, index) => {
        if (ambiguous || block.origin === undefined) return
        // A new block that resembles a deleted one can take its place.
        if (block.edited && inserted) return
        const node = nodes[index]!.position!
        expect(
          saved.slice(node.start.offset, node.end.offset),
          `seed ${seed}`,
        ).toBe(block.text.replaceAll('\n', ending))
      })
    },
  )
})
