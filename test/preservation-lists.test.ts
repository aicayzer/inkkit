import { expect, test } from 'vitest'
import { editorViewCtx, parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { splitListItem } from '@milkdown/kit/prose/schema-list'
import type { Root } from 'mdast'
import { InkKitEditor } from '../src/index'
import { Preservation, PreservationError } from '../src/preserve'
import { withEditor } from './harness'

const shape = (doc: ProseNode) =>
  JSON.stringify(doc.toJSON(), (key, value) =>
    key === 'id' || key === 'marker' ? undefined : value,
  )

function save(ctx: Ctx, before: string, after: string): string {
  const parse = ctx.get(parserCtx)
  const saved = new Preservation(ctx, before).serialize(parse(after))
  expect(shape(parse(saved))).toBe(shape(parse(after)))
  return saved
}

test.each([
  [
    'a new list after an authored list with the same bullet',
    '- a\n- b\n\nEnd\n',
    '- a\n- b\n\n* c\n\nEnd\n',
    '- a\n- b\n\n* c\n\nEnd\n',
  ],
  [
    'a new list before an authored list with the same bullet',
    '- a\n- b\n\nEnd\n',
    '* c\n\n- a\n- b\n\nEnd\n',
    '* c\n\n- a\n- b\n\nEnd\n',
  ],
  [
    'two adjacent lists swapped without other edits',
    '- a\n- b\n\n* c\n* d\n\nEnd\n',
    '* c\n* d\n\n- a\n- b\n\nEnd\n',
    '* c\n* d\n\n- a\n- b\n\nEnd\n',
  ],
  [
    'a new list between lists that use - and *',
    '- a\n\n* b\n',
    '- a\n\n+ x\n\n* b\n',
    '- a\n\n+ x\n\n* b\n',
  ],
  [
    'a new ordered list after an authored one with the same delimiter',
    '1. a\n2. b\n\nEnd\n',
    '1. a\n2. b\n\n1) c\n\nEnd\n',
    '1. a\n2. b\n\n1) c\n\nEnd\n',
  ],
  [
    'two ordered lists swapped',
    '1. a\n\n1) b\n\nEnd\n',
    '1) b\n\n1. a\n\nEnd\n',
    '1) b\n\n1. a\n\nEnd\n',
  ],
  [
    'a new list beside an indented authored list',
    '  - a\n  - b\n\nEnd\n',
    '- a\n- b\n\n* c\n\nEnd\n',
    '  - a\n  - b\n\n* c\n\nEnd\n',
  ],
  [
    'a new list beside a CRLF list',
    '- a\r\n- b\r\n\r\nEnd\r\n',
    '- a\n- b\n\n* c\n\nEnd\n',
    '- a\r\n- b\r\n\r\n* c\r\n\r\nEnd\r\n',
  ],
])('%s saves and keeps the authored list', (_, before, after, expected) =>
  withEditor('x\n', (editor) => {
    expect(save(editor.ctx, before, after)).toBe(expected)
  }),
)

test.each([
  ['an item added to a + list', '+ a\n+ b\n', '+ a\n+ b\n+ c\n'],
  ['an item added between items', '* a\n* b\n', '* a\n* new\n* b\n'],
  ['an item added to a 1) list', '1) a\n2) b\n', '1) a\n2) b\n3) c\n'],
  ['a task toggled in a * list', '* [ ] a\n* [ ] b\n', '* [ ] a\n* [x] b\n'],
  ['a * list made loose', '* a\n* b\n', '* a\n\n* b\n'],
  ['a renumbered 1) list', '3) a\n4) b\n', '1) a\n2) b\n'],
  [
    'an item added to a nested + list',
    '* a\n  + n1\n  + n2\n',
    '* a\n  + n1\n  + n2\n  + n3\n',
  ],
  [
    'an item added to a quoted * list',
    '> * a\n> * b\n',
    '> * a\n> * b\n> * c\n',
  ],
  [
    'an item added to a CRLF + list',
    '+ a\r\n+ b\r\n\r\nEnd\r\n',
    '+ a\n+ b\n+ c\n\nEnd\n',
  ],
  [
    'an item added to a list after another list',
    '- x\n\n+ a\n+ b\n',
    '- x\n\n+ a\n+ b\n+ c\n',
  ],
])('%s keeps the authored marker', (_, before, after) =>
  withEditor('x\n', (editor) => {
    const ending = before.includes('\r\n') ? '\r\n' : '\n'
    expect(save(editor.ctx, before, after)).toBe(after.replaceAll('\n', ending))
  }),
)

test.each([
  [
    'a new sublist beside a * sublist in an item',
    '- a\n  * x\n  * y\n- b\n',
    '- a\n  * x\n  * y\n  - z\n- b\n',
    '- a\n  * x\n  * y\n  - z\n- b\n',
  ],
  [
    'a new list between - and * lists in a quote',
    '> - a\n>\n> * b\n',
    '> - a\n>\n> + x\n>\n> * b\n',
    '> - a\n>\n> + x\n>\n> * b\n',
  ],
  [
    'a quoted paragraph replaced by a list beside a * list',
    '> * a\n>\n> para\n',
    '> * a\n>\n> - b\n',
    '> * a\n>\n> - b\n',
  ],
  [
    'a quoted list made tight before two blank quote lines',
    '> * a\n>\n> * b\n>\n>\n> End\n',
    '> * a\n> * b\n>\n> End\n',
    '> * a\n> * b\n>\n> End\n',
  ],
  [
    'a quoted list after a - list',
    '> - a\n>\n> End\n',
    '> - a\n>\n> * b\n>\n> End\n',
    '> - a\n>\n> * b\n>\n> End\n',
  ],
  [
    'a paragraph after the last quoted list',
    '> * a\n> * b\n',
    '> * a\n> * b\n>\n> para\n',
    '> * a\n> * b\n>\n> para\n',
  ],
  [
    'a paragraph after the last nested list in a quote',
    '> - a\n>   - b\n',
    '> - a\n>   - b\n>\n> para\n',
    '> - a\n>   - b\n>\n> para\n',
  ],
  [
    'an empty paragraph after the last nested list in a callout',
    '> [!NOTE]\n> - a\n>   - b\n',
    '> [!NOTE]\n> - a\n>   - b\n>\n> <br />\n',
    '> [!NOTE]\n> - a\n>   - b\n>\n> <br />\n',
  ],
  [
    'an empty paragraph after the last list in a callout',
    '> [!NOTE]\n> * a\n> * b\n',
    '> [!NOTE]\n> * a\n> * b\n>\n> <br />\n',
    '> [!NOTE]\n> * a\n> * b\n>\n> <br />\n',
  ],
])('%s inside a container saves', (_, before, after, expected) =>
  withEditor('x\n', (editor) => {
    expect(save(editor.ctx, before, after)).toBe(expected)
  }),
)

test('a deletion between two unchanged lists is refused even when unrelated blocks move', () =>
  withEditor('x\n', (editor) => {
    const parse = editor.ctx.get(parserCtx)
    const source = '- a\n\nP\n\n- b\n\nQ\n\nR\n'
    for (const after of ['- a\n\n* b\n\nQ\n\nR\n', '- a\n\n* b\n\nR\n\nQ\n'])
      expect(() =>
        new Preservation(editor.ctx, source).serialize(parse(after)),
      ).toThrow(PreservationError)
  }))

test('an unchanged list is never relabelled to make room for a new one', () =>
  withEditor('x\n', (editor) => {
    // Only two ordered delimiters exist, and both neighbours keep theirs.
    const parse = editor.ctx.get(parserCtx)
    expect(() =>
      new Preservation(editor.ctx, '1. a\n\n1) b\n').serialize(
        parse('1. a\n\n1) x\n\n1. b\n'),
      ),
    ).toThrow(PreservationError)
  }))

for (const [source, expected] of [
  ['* a\n* b\n', '* a\n* b\n* c\n'],
  ['+ a\n+ b\n', '+ a\n+ b\n+ c\n'],
  ['1) a\n2) b\n', '1) a\n2) b\n3) c\n'],
  ['- [ ] a\r\n- [ ] b\r\n', '- [ ] a\r\n- [ ] b\r\n- [ ] c\r\n'],
] as const)
  test(`a new item typed in ${JSON.stringify(source)} saves`, async () => {
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
        documentId: 'lists',
        generation: 1,
        format: 'md',
        text: source,
      })
      const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
      const view = ctx.get(editorViewCtx)
      const end = view.state.doc.child(0).nodeSize - 3
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
      )
      splitListItem(view.state.schema.nodes.list_item!)(
        view.state,
        view.dispatch,
      )
      editor.insertText('c', 1)
      expect(errors).toEqual([])
      expect(editor.snapshot().text).toBe(expected)
    } finally {
      await editor.destroy()
      root.remove()
    }
  })

interface Placed {
  make: (marker: string) => string
  kind?: 'bullet' | 'ordered'
  marker?: string
  origin?: number
  edited?: boolean
}

const bullets = ['-', '*', '+']
const delimiters = ['.', ')']
const lists: Array<(i: number) => Placed> = [
  ...bullets.map((marker) => (i: number) => ({
    kind: 'bullet' as const,
    marker,
    make: (m: string) => `${m} item ${i}\n${m} second ${i}`,
  })),
  ...bullets.map((marker) => (i: number) => ({
    kind: 'bullet' as const,
    marker,
    make: (m: string) => `${m} [ ] task ${i}\n${m} [x] done ${i}`,
  })),
  ...delimiters.map((marker) => (i: number) => ({
    kind: 'ordered' as const,
    marker,
    make: (m: string) => `1${m} first ${i}\n2${m} second ${i}`,
  })),
]
const others: Array<(i: number) => Placed> = [
  (i) => ({ make: () => `__Bold ${i}__ para` }),
  (i) => ({ make: () => `Title ${i}\n===` }),
]

// Adjacent lists with one marker read as one list, so the intended document
// gives each list a marker its neighbours do not use.
function markdown(blocks: Placed[], ending: string): string | undefined {
  const written: string[] = []
  let previous: Placed | undefined
  for (const block of blocks) {
    let marker = block.marker
    if (
      block.kind &&
      previous?.kind === block.kind &&
      previous.marker === marker
    )
      marker = (block.kind === 'bullet' ? bullets : delimiters).find(
        (choice) => choice !== previous!.marker,
      )
    if (marker === undefined && block.kind) return undefined
    previous = { ...block, marker }
    written.push(block.make(marker ?? ''))
  }
  return written.join('\n\n').replaceAll('\n', ending) + ending
}

// Whether every run of adjacent lists of one kind can alternate markers while
// each list in `fixed` keeps its own.
function separable(blocks: Placed[], fixed: (index: number) => boolean) {
  let options: Array<string | undefined> = [undefined]
  for (const [index, block] of blocks.entries()) {
    const chained = block.kind && blocks[index - 1]?.kind === block.kind
    const own = !block.kind
      ? [undefined]
      : fixed(index)
        ? [block.marker!]
        : block.kind === 'bullet'
          ? bullets
          : delimiters
    options = own.filter(
      (marker) => !chained || options.some((option) => option !== marker),
    )
    if (!options.length) return false
  }
  return true
}

// A sample keeps the suite fast on shared runners; `SEEDS` runs more locally.
const seeds = Number(process.env.SEEDS) || 400

test(
  'random list insertions, moves, swaps, deletions and edits save unless an unchanged list would change',
  () =>
    withEditor('x\n', (editor) => {
      const processor = editor.ctx.get(remarkCtx)
      const count = (text: string) =>
        (processor.parse(text) as Root).children.length
      let saved = 0
      let refused = 0
      for (let seed = 1; seed <= seeds; seed++) {
        let state = seed
        const random = () =>
          (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
        const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
        const ending = random() < 0.3 ? '\r\n' : '\n'
        let id = 0
        const fresh = () => pick(random() < 0.7 ? lists : others)(id++)
        const before: Placed[] = []
        for (
          let length = 2 + Math.floor(random() * 8);
          before.length < length;
        ) {
          const block = fresh()
          const last = before.at(-1)
          // Source lists side by side must already differ to be two lists.
          if (
            block.kind &&
            last?.kind === block.kind &&
            last.marker === block.marker
          )
            continue
          before.push(block)
        }
        const after: Placed[] = before.map((block, origin) => ({
          ...block,
          origin,
        }))
        for (let step = 1 + Math.floor(random() * 3); step; step--) {
          const index = Math.floor(random() * after.length)
          const action = pick(['insert', 'move', 'swap', 'delete', 'edit'])
          if (action === 'insert')
            after.splice(Math.floor(random() * (after.length + 1)), 0, fresh())
          else if (action === 'move' && after.length > 1) {
            const [block] = after.splice(index, 1)
            after.splice(Math.floor(random() * (after.length + 1)), 0, block!)
          } else if (action === 'swap' && index + 1 < after.length) {
            ;[after[index], after[index + 1]] = [
              after[index + 1]!,
              after[index]!,
            ]
          } else if (action === 'delete' && after.length > 1)
            after.splice(index, 1)
          else if (action === 'edit') {
            const block = after[index]!
            after[index] = {
              ...block,
              edited: true,
              make: (m) => block.make(m).replace(/^.*$/m, '$& typed'),
            }
          }
        }
        const source = markdown(before, ending)!
        const edited = markdown(after, ending)
        if (!edited || count(edited) !== after.length) continue
        expect(count(source)).toBe(before.length)
        const unchanged = (index: number) =>
          after[index]!.origin !== undefined && !after[index]!.edited
        // Which of two blocks whose order changed was moved is ambiguous, and a
        // block both moved and edited reads as deleted and inserted.
        const moved = new Set(
          after.flatMap((block, index) =>
            unchanged(index) &&
            after.some(
              (other, at) =>
                unchanged(at) && block.origin! < other.origin! !== index < at,
            )
              ? [index]
              : [],
          ),
        )
        const movedFrom = new Set(
          [...moved].map((index) => after[index]!.origin),
        )
        // A boundary a move disturbed: a moved neighbour, or a moved block
        // that lay between the two in the source.
        const disturbed = (index: number, other: number) => {
          if (moved.has(other)) return true
          if (!after[other] || !unchanged(other)) return false
          const [low, high] = [
            after[index]!.origin!,
            after[other]!.origin!,
          ].sort((x, y) => x - y)
          for (let at = low! + 1; at < high!; at++)
            if (movedFrom.has(at)) return true
          return false
        }
        // An unchanged list may change marker only to part from a list across
        // a disturbed boundary; other blocks may be the moved one.
        const free = (index: number) =>
          moved.has(index) ||
          [index - 1, index + 1].some(
            (other) =>
              disturbed(index, other) &&
              (!after[index]!.kind ||
                after[other]?.kind === after[index]!.kind),
          )
        let text: string
        try {
          text = save(editor.ctx, source, edited)
        } catch (error) {
          expect(error, `seed ${seed}`).toBeInstanceOf(PreservationError)
          expect(
            separable(after, (index) => unchanged(index) && !free(index)),
            `seed ${seed} refused ${JSON.stringify(edited)}`,
          ).toBe(false)
          refused++
          continue
        }
        saved++
        const nodes = (processor.parse(text) as Root).children
        expect(nodes).toHaveLength(after.length)
        after.forEach((block, index) => {
          // Which of two swapped blocks moved is ambiguous, and a moved one is
          // rewritten by design.
          if (!unchanged(index) || (!block.kind && free(index))) return
          const node = nodes[index]!.position!
          const written = text.slice(node.start.offset, node.end.offset)
          const authored = before[block.origin!]!.make(block.marker ?? '')
          const unmarked = (text: string) =>
            text.replace(/^(\d*)[-*+.)]/gm, '$1•')
          if (free(index))
            expect(unmarked(written), `seed ${seed}`).toBe(
              unmarked(authored.replaceAll('\n', ending)),
            )
          else
            expect(written, `seed ${seed}`).toBe(
              authored.replaceAll('\n', ending),
            )
        })
      }
      // Before list markers were chosen, 348 of 2,000 were refused.
      expect(saved).toBeGreaterThan(seeds * 0.95)
      expect(refused).toBeLessThan(seeds * 0.025)
    }),
  60_000,
)
