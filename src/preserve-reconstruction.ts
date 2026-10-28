import { leadingBOMLength } from './bom'
import { remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Mark } from '@milkdown/kit/prose/model'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { restoreCodeEndings } from './code-fences'
import { finalCodeEnding } from './code-fences'
import { sourceFrontmatter } from './literals'
import {
  type Block,
  type SourceNode,
  type Kept,
  type Carried,
  nothingCarried,
  type Pairing,
  type Run,
} from './preserve-types'
import { markLiterals } from './preserve-literal'
import { parseTree, write } from './preserve-parse'
import {
  withLinkForms,
  signature,
  definesSource,
  positionalNode,
  withEnding,
} from './preserve-shape'
import { markerAt, relabel } from './preserve-list'
import { type LoadedSource } from './preserve-source'
import { type DefinitionContext } from './preserve-context'
import { type MoveOrigins } from './preserve-moves'

// Local and whole-document saves share the same reconstruction and marker choices.
export class Reconstruction {
  private linkEdits = false

  constructor(
    private readonly ctx: Ctx,
    private readonly loaded: Pick<
      LoadedSource,
      | 'around'
      | 'baseline'
      | 'blocks'
      | 'definitionSources'
      | 'lineEnding'
      | 'originalForms'
      | 'retainBlock'
      | 'retainLifted'
      | 'retainPart'
      | 'source'
    >,
    private readonly context: Pick<DefinitionContext, 'definitions'>,
    private readonly movement: Pick<MoveOrigins, 'carriedChildren'>,
  ) {}

  // Two lists of one kind side by side are one list unless their markers
  // differ, so each run of adjacent lists gets markers that alternate. A list
  // written afresh changes first, then an edited list. An unchanged list keeps
  // its source unless a move changed one of its neighbours; otherwise the
  // reopen check refuses.
  private separateLists(
    doc: ProseNode,
    pieces: string[],
    kept: Kept[],
    positions: Array<number | undefined>,
    current: string[],
  ): void {
    const kind = (index: number): string | undefined => {
      const name = doc.maybeChild(index)?.type.name
      return name === 'bullet_list' || name === 'ordered_list'
        ? name
        : undefined
    }
    const marker = (index: number): string | undefined =>
      markerAt(pieces[index]!, /^[ \t]*/.exec(pieces[index]!)![0].length)
        ?.marker
    const elsewhere = new Set(
      current.filter((_, index) => kept[index] !== 'unchanged'),
    )
    const moved = (index: number) =>
      positions[index] == null && this.loaded.originalForms.has(current[index]!)
    // Beside its source neighbour, or beside new blocks only, with nothing
    // between them in the source moved elsewhere.
    const inPlace = (index: number, step: -1 | 1): boolean => {
      const own = positions[index]!
      let next = index + step
      while (
        next >= 0 &&
        next < pieces.length &&
        positions[next] == null &&
        !moved(next)
      )
        next += step
      if (next >= 0 && next < pieces.length && positions[next] == null)
        return false
      const other =
        next < 0
          ? -1
          : next >= pieces.length
            ? this.loaded.blocks.length
            : positions[next]!
      if ((other - own) * step <= 0) return false
      for (let at = own + step; at !== other; at += step)
        if (elsewhere.has(this.loaded.blocks[at]!.form)) return false
      return true
    }
    // An unchanged list changes only to part from a list with its marker across
    // a boundary that a move disturbed, and one moved on both sides first.
    const cost = (index: number): number => {
      if (kept[index] === 'canonical' || kept[index] === 'moved') return 1
      if (kept[index] === 'edited') return 10
      const own = marker(index)
      const sides = ([-1, 1] as const).map((step) => inPlace(index, step))
      const collides = ([-1, 1] as const).some(
        (step, side) =>
          !sides[side] &&
          kind(index + step) === kind(index) &&
          marker(index + step) === own,
      )
      return collides
        ? [50, 150][Number(sides[0]) + Number(sides[1])]!
        : Infinity
    }
    for (let start = 0; start < pieces.length;) {
      const list = kind(start)
      let end = start + 1
      while (list && kind(end) === list) end++
      const run = Array.from({ length: end - start }, (_, i) => start + i)
      start = end
      if (
        run.length < 2 ||
        run.every((index, i) => !i || marker(index) !== marker(index - 1))
      )
        continue
      const markers = list === 'bullet_list' ? ['-', '*', '+'] : ['.', ')']
      const options = run.map((index) => {
        const own = marker(index)
        const change = cost(index)
        const choices: Array<{ marker: string; cost: number; text: string }> =
          own ? [{ marker: own, cost: 0, text: pieces[index]! }] : []
        if (change !== Infinity)
          for (const choice of markers) {
            if (choice === own) continue
            const text = this.relabelList(pieces[index]!, choice)
            if (text !== undefined)
              choices.push({ marker: choice, cost: change, text })
          }
        return choices
      })
      // Fewest and cheapest changes, with adjacent markers always different.
      const best = options.map((choices) => choices.map(() => Infinity))
      const from = options.map((choices) => choices.map(() => -1))
      options[0]!.forEach((choice, j) => (best[0]![j] = choice.cost))
      for (let i = 1; i < options.length; i++)
        options[i]!.forEach((choice, j) => {
          options[i - 1]!.forEach((previous, k) => {
            const total = best[i - 1]![k]! + choice.cost
            if (previous.marker !== choice.marker && total < best[i]![j]!) {
              best[i]![j] = total
              from[i]![j] = k
            }
          })
        })
      const last = best.at(-1)!
      let j = last.indexOf(Math.min(...last))
      if (j < 0 || last[j] === Infinity) continue
      for (let i = options.length - 1; i >= 0; j = from[i]![j]!, i--)
        pieces[run[i]!] = options[i]![j]!.text
    }
  }

  private relabelList(text: string, marker: string): string | undefined {
    const read = (text: string) =>
      parseTree(this.ctx, text).children as unknown as SourceNode[]
    const [list, ...rest] = read(text)
    if (list?.type !== 'list' || rest.length) return undefined
    const relabelled = relabel(
      text,
      list.children!.map((item) => item.position!.start.offset!),
      marker,
    )
    const reread = read(relabelled)
    // A bullet can turn an item into a thematic break, such as `* * *`.
    return reread.length === 1 &&
      signature(reread[0]!) === signature(list) &&
      markerAt(relabelled, list.children![0]!.position!.start.offset!)
        ?.marker === marker
      ? relabelled
      : undefined
  }

  // The gap the whole-document path writes before the current block at
  // `index`: the authored text between two blocks paired one after the other,
  // otherwise a blank line. The first block keeps the file's head when it is
  // paired with the first original.
  gap(index: number, positions: Array<number | undefined>): string {
    const position = positions[index]
    const block = position == null ? undefined : this.loaded.blocks[position]
    if (index === 0)
      return position === 0 && block
        ? this.loaded.source.slice(0, block.start)
        : leadingBOMLength(this.loaded.source)
          ? '\uFEFF'
          : ''
    const previous = positions[index - 1]
    // Appending after the last authored block keeps its trailing whitespace.
    // The existing reparse still decides whether the new block is separate.
    if (previous === this.loaded.blocks.length - 1 && position == null) {
      const ending = this.loaded.source.slice(this.loaded.blocks[previous]!.end)
      const lines = ending.replace(/\r\n?/g, '\n')
      if (/\n[ \t]*\n/.test(lines))
        return ending + (lines.endsWith('\n') ? '' : this.loaded.lineEnding)
      return (
        ending + this.loaded.lineEnding.repeat(lines.endsWith('\n') ? 1 : 2)
      )
    }
    return previous != null && position === previous + 1 && block
      ? this.loaded.source.slice(this.loaded.blocks[previous]!.end, block.start)
      : this.loaded.lineEnding.repeat(2)
  }

  // What the whole-document path writes for the current blocks from `from` to
  // `to`, and the gap before each. `canonical` is those blocks written as
  // canonical Markdown, and `tree` its parse, with the block at `from` as its
  // first child, when it reads back as one node for each block.
  private build(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
    carried: Carried,
    from: number,
    to: number,
    canonical: string,
    tree?: { raw: Root; transformed: Root },
  ): { gaps: string[]; pieces: string[]; kept: Kept[] } {
    const transformed = (index: number) =>
      tree!.transformed.children[index - from] as unknown as SourceNode
    // The editor also holds a block that failed to parse as literal Markdown,
    // which the transformed tree does not show.
    if (tree) {
      const failed: SourceNode[] = []
      for (let index = from; index < to; index++)
        if (doc.child(index).type.name === 'literal_markdown')
          failed.push(transformed(index))
      markLiterals(tree.raw, tree.transformed, failed)
    }
    // An original between the blocks paired around these is one an edit
    // could have joined into them. Pairing keeps order, so only the blocks
    // paired from just before `from` to just after `to` can lie between.
    const paired = new Set<Block>()
    for (
      let index = Math.max(0, from - 1);
      index < Math.min(positions.length, to + 1);
      index++
    ) {
      const position = positions[index]
      if (position != null) paired.add(this.loaded.blocks[position]!)
    }
    // The children each edited list or quote keeps at its start and end,
    // which a part split from the same original cannot also be.
    const taken = new Set<SourceNode>()
    if (tree)
      for (let index = from; index < to; index++) {
        const position = positions[index]
        const kids =
          position == null
            ? undefined
            : this.loaded.blocks[position]!.ast.children
        const now = transformed(index).children
        if (
          !kids ||
          !now ||
          this.loaded.blocks[position!]!.form === current[index]
        )
          continue
        let start = 0,
          end = 0
        while (
          start < Math.min(kids.length, now.length) &&
          signature(kids[start]!) === signature(now[start]!)
        )
          taken.add(kids[start++]!)
        while (
          end < Math.min(kids.length, now.length) - start &&
          signature(kids[kids.length - 1 - end]!) ===
            signature(now[now.length - 1 - end]!)
        )
          taken.add(kids[kids.length - 1 - end++]!)
      }
    const gaps: string[] = []
    const pieces: string[] = []
    const kept: Kept[] = []
    for (let index = from; index < to; index++) {
      const text = current[index]!
      const position = positions[index]
      const moved = carried.moved.get(index)
      const block =
        position == null
          ? moved === undefined
            ? undefined
            : this.loaded.blocks[moved]
          : this.loaded.blocks[position]
      gaps.push(this.gap(index, positions))
      const kind: Kept =
        block && block.form === text && !carried.within.has(index)
          ? position == null
            ? 'moved'
            : 'unchanged'
          : block && tree && position != null
            ? 'edited'
            : 'canonical'
      kept.push(kind)
      const node = tree
        ? positionalNode(tree.raw, transformed(index))
        : undefined
      pieces.push(
        kind === 'unchanged' || kind === 'moved'
          ? this.loaded.source.slice(block!.start, block!.end)
          : kind === 'edited'
            ? this.retainingForms(block!, doc.child(index), () =>
                this.loaded.retainBlock(
                  block!,
                  node!,
                  canonical,
                  this.loaded
                    .around(positions, index)
                    .filter(
                      (other) =>
                        !paired.has(other) &&
                        other.ast.type === block!.ast.type,
                    )
                    .flatMap((other) => other.ast.children ?? []),
                  carried.children
                    ? this.movement.carriedChildren(doc.child(index), position!)
                    : undefined,
                ),
              )
            : ((node &&
                (this.loaded.retainPart(
                  positions,
                  index,
                  node,
                  canonical,
                  taken,
                ) ??
                  this.loaded.retainLifted(positions, index, node))) ??
              restoreCodeEndings(
                this.ctx,
                doc.type.create(null, [doc.child(index)]),
                withEnding(text, this.loaded.lineEnding),
              )),
      )
    }
    return { gaps, pieces, kept }
  }

  // The canonical Markdown of `nodes` and its parse, which locates each block
  // in it when it reads back as one node for each.
  private canonicalBlocks(
    doc: ProseNode,
    nodes: ProseNode[],
  ): { canonical: string; tree?: { raw: Root; transformed: Root } } {
    const { written, extra } = this.writeBlocks(doc, nodes)
    // Read with the definitions its labels can refer to, as in the document.
    const definitions = written.includes('[')
      ? this.context.definitions(written)
      : undefined
    const canonical = definitions?.text
      ? written + this.loaded.lineEnding.repeat(2) + definitions.text
      : written
    const raw = parseTree(this.ctx, canonical)
    const transformed = this.ctx
      .get(remarkCtx)
      .runSync(structuredClone(raw), { value: canonical }) as Root
    return {
      canonical,
      tree:
        transformed.children.length ===
        nodes.length + extra + (definitions?.blocks ?? 0)
          ? { raw, transformed }
          : undefined,
    }
  }

  // The canonical Markdown of the whole document and its parse.
  private canonicalDocument(doc: ProseNode): {
    canonical: string
    tree?: { raw: Root; transformed: Root }
  } {
    const nodes: ProseNode[] = []
    doc.forEach((node) => nodes.push(node))
    const { written: canonical, extra } = this.writeBlocks(doc, nodes)
    const raw = parseTree(this.ctx, canonical)
    const transformed = this.ctx
      .get(remarkCtx)
      .runSync(structuredClone(raw), { value: canonical }) as Root
    return {
      canonical,
      tree:
        transformed.children.length === doc.childCount + extra
          ? { raw, transformed }
          : undefined,
    }
  }

  // Canonical Markdown for `nodes`. An empty paragraph at the end of a
  // document is written as nothing, so a paragraph is added after one there,
  // and `extra` counts it.
  private writeBlocks(
    doc: ProseNode,
    nodes: ProseNode[],
  ): { written: string; extra: number } {
    const last = nodes.at(-1)
    const extra =
      last?.type.name === 'paragraph' && last.content.size === 0 ? 1 : 0
    const written = write(
      this.ctx,
      doc.type.create(
        doc.attrs,
        extra
          ? [...nodes, last!.type.create(null, doc.type.schema.text('end'))]
          : nodes,
      ),
    )
    return { written, extra }
  }

  // The runs of changed blocks, each between two blocks the edit left as they
  // were, or an end of the document. A block is unchanged when it is paired
  // with an original of the same form, and the text between two unchanged
  // blocks is kept when they are paired with consecutive originals.
  runs(
    positions: Array<number | undefined>,
    current: string[],
    within: Set<number> = nothingCarried.within,
  ): Run[] {
    const unchanged = (index: number) => {
      const position = positions[index]
      return (
        position != null &&
        this.loaded.blocks[position]!.form === current[index] &&
        !within.has(index)
      )
    }
    const consecutive = (index: number) =>
      index === 0
        ? positions[0] === 0
        : positions[index] != null &&
          positions[index - 1] != null &&
          positions[index] === positions[index - 1]! + 1
    const runs: Run[] = []
    let previous: number | undefined
    let changed = false
    for (let index = 0; index < current.length; index++) {
      if (!unchanged(index)) changed = true
      else {
        if (changed || !consecutive(index)) runs.push({ previous, next: index })
        changed = false
        previous = index
      }
    }
    if (
      changed ||
      previous === undefined ||
      positions[previous] !== this.loaded.blocks.length - 1
    )
      runs.push({ previous })
    return runs
  }

  // Whether each run reads as it does in the document when it is read with
  // the definitions it refers to, which holds when every definition is a
  // top-level block that no run adds, changes or removes. Otherwise changed
  // blocks are read in the canonical Markdown of the whole document.
  readAlone(
    doc: ProseNode,
    positions: Array<number | undefined>,
    runs: Run[],
  ): boolean {
    if (this.loaded.definitionSources === undefined) return false
    return runs.every((run) => {
      const from = run.previous === undefined ? 0 : run.previous + 1
      const to = run.next ?? doc.childCount
      for (let index = from; index < to; index++)
        if (Reconstruction.defines(doc.child(index))) return false
      const first =
        run.previous === undefined ? 0 : positions[run.previous]! + 1
      const last =
        run.next === undefined
          ? this.loaded.blocks.length
          : positions[run.next]!
      for (let index = first; index < last; index++)
        if (definesSource(this.loaded.blocks[index]!.ast)) return false
      return true
    })
  }

  // What the whole-document path writes for the changed blocks of a run, read
  // from their own canonical Markdown.
  runPieces(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
    carried: Carried,
    run: Run,
  ): { gaps: string[]; pieces: string[]; kept: Kept[] } {
    const from = run.previous === undefined ? 0 : run.previous + 1
    const to = run.next ?? doc.childCount
    if (from === to) return { gaps: [], pieces: [], kept: [] }
    const nodes: ProseNode[] = []
    for (let index = from; index < to; index++) nodes.push(doc.child(index))
    const { canonical, tree } =
      from === 0 && to === doc.childCount
        ? this.canonicalDocument(doc)
        : this.canonicalBlocks(doc, nodes)
    return this.build(
      doc,
      positions,
      current,
      carried,
      from,
      to,
      canonical,
      tree,
    )
  }

  // Whether a block is or holds a link or footnote definition.
  private static defines(node: ProseNode): boolean {
    let found = false
    node.descendants((child) => {
      if (/^(?:reference|footnote)_definition$/.test(child.type.name))
        found = true
      return !found
    })
    return found || /^(?:reference|footnote)_definition$/.test(node.type.name)
  }

  // Runs `run` with the blocks whose links changed form written from the
  // edit instead of kept from the source.
  withLinkEdits<T>(run: () => T): T {
    this.linkEdits = true
    try {
      return run()
    } finally {
      this.linkEdits = false
    }
  }

  // Runs `retain`, which keeps the source of `block` where it reads as `node`,
  // so that its links count as changed when a link of `node` is written
  // another way than the original, such as an address given angle brackets.
  // Only such blocks do, so a link the canonical writer would spell another
  // way, in a block the edit left its links alone in, keeps its source.
  private retainingForms<T>(block: Block, node: ProseNode, retain: () => T): T {
    if (!this.linkEdits) return retain()
    const forms = (value: ProseNode): string => {
      const found: unknown[] = []
      let previous: Mark | undefined
      value.descendants((child) => {
        if (!child.isText) return true
        const link = child.marks.find((mark) => mark.type.name === 'link')
        if (link && !previous?.eq(link)) found.push(link.attrs.form ?? null)
        previous = link
        return false
      })
      return JSON.stringify(found)
    }
    const original = this.loaded.baseline.maybeChild(
      this.loaded.blocks.indexOf(block),
    )
    return !original ||
      this.loaded.baseline.childCount !== this.loaded.blocks.length ||
      forms(original) !== forms(node)
      ? withLinkForms(retain)
      : retain()
  }

  // The whole document written from `pairing`. Unchanged blocks keep their
  // source and the text between them. Each run of changed blocks is written
  // from its own canonical Markdown, or, when a run can't be read alone,
  // every block from the whole document's.
  writeDocument(
    doc: ProseNode,
    current: string[],
    { positions, carried }: Pairing,
  ): string {
    const gaps = current.map((_, index) => this.gap(index, positions))
    const pieces = positions.map((position) =>
      position == null
        ? ''
        : this.loaded.source.slice(
            this.loaded.blocks[position]!.start,
            this.loaded.blocks[position]!.end,
          ),
    )
    const kept: Kept[] = current.map(() => 'unchanged')
    const runs = this.runs(positions, current, carried.within)
    for (const run of this.readAlone(doc, positions, runs) ? runs : [{}]) {
      const from = run.previous === undefined ? 0 : run.previous + 1
      const written = this.runPieces(doc, positions, current, carried, run)
      written.pieces.forEach((piece, index) => {
        pieces[from + index] = piece
        kept[from + index] = written.kept[index]!
      })
    }
    this.separateLists(doc, pieces, kept, positions, current)
    let output = pieces.map((piece, index) => gaps[index] + piece).join('')
    if (this.endsAsAuthored(positions, carried))
      output += this.loaded.source.slice(this.loaded.blocks.at(-1)!.end)
    else if (output) output += finalCodeEnding(doc) ?? this.loaded.lineEnding
    // A `---` rule that opens the file reads back as front matter when
    // another `---` line follows, whether it is new or moved there.
    const bom = leadingBOMLength(output)
    if (
      doc.firstChild?.type.name === 'hr' &&
      sourceFrontmatter(output.slice(bom))?.startsWith('---')
    )
      output = output.slice(0, bom) + '***' + output.slice(bom + 3)
    return output
  }

  // Whether the text after the last block stays as authored: the last block
  // is paired with the last original, or a move carried the last original
  // elsewhere and a carried block ends the note.
  endsAsAuthored(
    positions: Array<number | undefined>,
    carried: Carried,
  ): boolean {
    const end = this.loaded.blocks.length - 1
    if (end < 0) return false
    if (positions.at(-1) === end) return true
    return (
      carried.moved.has(positions.length - 1) &&
      [...carried.moved.values()].includes(end)
    )
  }
}
