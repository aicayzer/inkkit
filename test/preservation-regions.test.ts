import { ctxOf, withFacade } from './editor-access'
import { expectFacadeSave } from './facade-preservation'
import {
  localEditsOf,
  regionsOf,
  withoutFastPaths,
} from './preservation-access'
import { expect, test } from 'vitest'
import { parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  Fragment,
  Slice,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import {
  EditorState,
  TextSelection,
  type Command,
  type Transaction,
} from '@milkdown/kit/prose/state'
import {
  joinBackward,
  joinForward,
  setBlockType,
  splitBlock,
} from '@milkdown/kit/prose/commands'
import { liftListItem, splitListItem } from '@milkdown/kit/prose/schema-list'
import { Preservation, semanticSignature } from '../src/preserve'
import { withEditor } from './harness'
import { blocks, definitions, snippets } from './preservation-documents'

// Blocks a long note is mostly made of, including repeated ones, which make
// pairing ambiguous.
const plain: Array<(i: number) => string> = [
  (i) => `Paragraph ${i} with __bold__ words and a [link](/p/${i}).`,
  (i) => `Paragraph ${i}: *alpha* bravo \`code\` charlie.`,
  (i) => `## Heading ${i}`,
  () => 'The same paragraph.',
  () => '---',
  () => '- same item\n- other item',
  (i) => `1. first ${i}\n2. second ${i}`,
  (i) => `- [ ] task ${i}\n- [x] done ${i}`,
  (i) => '```\ncode ' + i + '\n```',
  (i) => `| A | B |\n| - | - |\n| ${i} | two |`,
  () => '<br />',
]

const documentMarkdown = (random: () => number, length: number): string => {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
  return Array.from({ length }, (_, i) =>
    random() < 0.75 ? pick(plain)(i) : pick(blocks)(i),
  ).join('\n\n')
}

interface Step {
  seed: number
  step: number
  kind: string
  source: string
  doc: ProseNode
  local: Preservation
  full: Preservation
}

// The note a seed makes and the edits it makes to it, one after another.
function replay(
  ctx: Ctx,
  seed: number,
  parse: (markdown: string) => ProseNode,
  each: (step: Step) => void,
): void {
  let state = seed
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
  const ending = random() < 0.3 ? '\r\n' : '\n'
  // Mostly short notes, and some long ones with distant edits.
  const length =
    random() < 0.15
      ? 100 + Math.floor(random() * 100)
      : 3 + Math.floor(random() * 25)
  const parts = [documentMarkdown(random, length)]
  if (random() < 0.5)
    parts.splice(Math.floor(random() * parts.length), 0, pick(definitions))
  if (random() < 0.1) parts.unshift('---\ntitle: front\n---')
  const source =
    (random() < 0.1 ? '\uFEFF' : '') +
    parts.join('\n\n').replaceAll('\n', ending) +
    (random() < 0.8 ? ending : '')
  const local = new Preservation(ctx, source)
  const full = withoutFastPaths(new Preservation(ctx, source))
  // The editor shows the baseline's own nodes.
  let doc = local.baseline
  for (let step = 0; step < 8; step++) {
    const edit = randomEdit(doc, random, parse)
    if (!edit) continue
    doc = edit.doc
    each({ seed, step, kind: edit.kind, source, doc, local, full })
  }
}

test(
  'structural edits validated in place save exactly what whole-document preservation saves',
  () =>
    withFacade('x\n', (editor) => {
      const ctx = ctxOf(editor)
      const parse = ctx.get(parserCtx)
      const accepted = new Map<string, number>()
      let structural = 0
      for (let seed = 1; seed <= Number(process.env.SEEDS ?? 300); seed++)
        replay(ctx, seed, parse, ({ step, kind, source, doc, local, full }) => {
          const fromLocal = localEditsOf(local, doc)
          let fast = fromLocal
          try {
            fast ??= regionsOf(local, doc)
          } catch {
            // Preservation then takes the whole-document path.
          }
          if (fast === undefined) return
          let whole: string | Error
          try {
            whole = full.serialize(doc)
          } catch (error) {
            whole = error as Error
          }
          const label = `seed ${seed} step ${step} ${kind}: ${JSON.stringify(source)}`
          expect(whole, label).toBe(fast)
          expectFacadeSave(editor, source, doc, fast, label)
          // The whole-document path's own test of what reopening must keep.
          expect(semanticSignature(parse(fast)), label).toBe(
            semanticSignature(doc),
          )
          if (fromLocal === undefined) {
            structural++
            accepted.set(kind, (accepted.get(kind) ?? 0) + 1)
          }
        })
      if (process.env.REPORT)
        console.info(`validated in place: ${structural}`, [...accepted])
      // A run that always fell back to the whole document would pass the
      // comparison, so require that each kind of edit was validated in place.
      expect(structural).toBeGreaterThan(500)
      for (const kind of [
        'enter',
        'enter at end',
        'enter in list',
        'backspace',
        'delete',
        'empty paragraph',
        'delete blocks',
        'paste blocks',
        'paste into paragraph',
        'heading level',
        'move',
      ])
        expect(accepted.get(kind), kind).toBeGreaterThan(5)
    }),
  240_000,
)

// These seeds type Markdown characters into a paragraph kept as literal
// Markdown, which was refused, and keep editing the note after it (#260).
test('every edit of seeds that type into a literal paragraph saves', () =>
  withEditor('x\n', (editor) => {
    const ctx = editor.ctx
    const parse = ctx.get(parserCtx)
    let edits = 0
    for (const seed of [244, 597])
      replay(ctx, seed, parse, ({ step, kind, doc, full }) => {
        const saved = full.serialize(doc)
        expect(
          semanticSignature(parse(saved)),
          `seed ${seed} step ${step} ${kind}`,
        ).toBe(semanticSignature(doc))
        edits++
      })
    expect(edits).toBeGreaterThan(10)
  }))

// The textblocks of `doc`, with their position and the top-level block that
// holds them.
function textblocks(doc: ProseNode) {
  const found: Array<{ node: ProseNode; pos: number; depth: number }> = []
  doc.descendants((node, pos) => {
    if (node.isTextblock)
      found.push({ node, pos, depth: doc.resolve(pos).depth })
    return true
  })
  return found
}

// Runs a command at a caret in `doc`, as a key press would.
function run(doc: ProseNode, at: number, command: Command): ProseNode | null {
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, at),
  })
  let tr: Transaction | undefined
  command(state, (transaction) => (tr = transaction))
  return tr?.docChanged ? tr.doc : null
}

// One edit of the kinds people make, or undefined when the chosen one does
// not apply here.
function randomEdit(
  doc: ProseNode,
  random: () => number,
  parse: (markdown: string) => ProseNode,
): { kind: string; doc: ProseNode } | undefined {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!
  const schema = doc.type.schema
  const texts = textblocks(doc)
  if (!texts.length) return undefined
  const target = pick(texts)
  const start = target.pos + 1
  const end = start + target.node.content.size
  const inside = start + Math.floor(random() * (target.node.content.size + 1))
  const $target = doc.resolve(start)
  const inItem = $target.node(-1)?.type.name === 'list_item'
  const enter: Command = inItem
    ? splitListItem(schema.nodes.list_item!)
    : splitBlock
  // A boundary between two top-level blocks.
  const boundary = () => {
    const index = Math.floor(random() * (doc.childCount + 1))
    let pos = 0
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
    return { index, pos }
  }
  const action = random()
  try {
    if (action < 0.14) {
      const next = run(doc, inside, enter)
      return next
        ? { kind: inItem ? 'enter in list' : 'enter', doc: next }
        : undefined
    }
    if (action < 0.24) {
      const next = run(doc, end, enter)
      if (!next) return undefined
      // Enter twice ends a list item, as a person ends a list.
      if (inItem && random() < 0.5) {
        const again = run(next, end + 4, enter)
        if (again) return { kind: 'enter in list', doc: again }
      }
      return { kind: inItem ? 'enter in list' : 'enter at end', doc: next }
    }
    if (action < 0.33) {
      const next =
        run(doc, start, joinBackward) ??
        (inItem ? run(doc, start, liftListItem(schema.nodes.list_item!)) : null)
      return next ? { kind: 'backspace', doc: next } : undefined
    }
    if (action < 0.4) {
      const next = run(doc, end, joinForward)
      return next ? { kind: 'delete', doc: next } : undefined
    }
    if (action < 0.46) {
      const { pos } = boundary()
      return {
        kind: 'empty paragraph',
        doc: doc.replace(
          pos,
          pos,
          new Slice(Fragment.from(schema.nodes.paragraph!.create()), 0, 0),
        ),
      }
    }
    if (action < 0.53) {
      const { index, pos } = boundary()
      const count = Math.min(
        doc.childCount - index,
        1 + Math.floor(random() * 3),
      )
      if (count <= 0 || count >= doc.childCount) return undefined
      let size = 0
      for (let i = index; i < index + count; i++) size += doc.child(i).nodeSize
      return {
        kind: 'delete blocks',
        doc: doc.replace(pos, pos + size, Slice.empty),
      }
    }
    if (action < 0.61) {
      const { pos } = boundary()
      const pasted = parse(
        documentMarkdown(random, 2 + Math.floor(random() * 19)),
      )
      return {
        kind: 'paste blocks',
        doc: doc.replace(pos, pos, new Slice(pasted.content, 0, 0)),
      }
    }
    if (action < 0.67) {
      if (target.depth !== 0) return undefined
      const pasted = parse(
        `Pasted ${Math.floor(random() * 100)} words\n\n${pick(plain)(1)}\n\nLast pasted`,
      )
      const to = Math.min(end, inside + Math.floor(random() * 6))
      return {
        kind: 'paste into paragraph',
        doc: doc.replace(inside, to, new Slice(pasted.content, 1, 1)),
      }
    }
    if (action < 0.74) {
      if (target.depth !== 0) return undefined
      const heading = schema.nodes.heading!
      const node = target.node
      const level = node.type === heading ? Number(node.attrs.level) : 0
      const command =
        level >= 1 && random() < 0.3
          ? setBlockType(schema.nodes.paragraph!)
          : setBlockType(heading, {
              ...(node.type === heading ? node.attrs : {}),
              level: level >= 6 ? 5 : level + 1,
            })
      const next = run(doc, inside, command)
      return next ? { kind: 'heading level', doc: next } : undefined
    }
    if (action < 0.79) {
      // Cut one block and paste it elsewhere.
      if (doc.childCount < 3) return undefined
      const from = boundary()
      if (from.index >= doc.childCount) return undefined
      const moved = doc.child(from.index)
      const without = doc.replace(
        from.pos,
        from.pos + moved.nodeSize,
        Slice.empty,
      )
      const index = Math.floor(random() * (without.childCount + 1))
      let pos = 0
      for (let i = 0; i < index; i++) pos += without.child(i).nodeSize
      return {
        kind: 'move',
        doc: without.replace(pos, pos, new Slice(Fragment.from(moved), 0, 0)),
      }
    }
    if (action < 0.92) {
      const marks = doc.resolve(inside).marks()
      return {
        kind: 'type',
        doc: doc.replace(
          inside,
          inside,
          new Slice(Fragment.from(schema.text(pick(snippets), marks)), 0, 0),
        ),
      }
    }
    const to = Math.min(end, inside + Math.floor(random() * 6))
    return to > inside
      ? { kind: 'delete text', doc: doc.replace(inside, to, Slice.empty) }
      : undefined
  } catch {
    return undefined
  }
}
