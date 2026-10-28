import { remarkCtx } from '@milkdown/kit/core'
import { schemaCtx } from '@milkdown/kit/core'
import { parseMarkdown } from './parser'
import type { Ctx } from '@milkdown/kit/ctx'
import { Fragment } from '@milkdown/kit/prose/model'
import type { Mark } from '@milkdown/kit/prose/model'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'

import { restoreCodeEndings } from './code-fences'
import { finalCodeEnding } from './code-fences'
import { lineBreakHTML } from './literals'
import { sourceFrontmatter } from './literals'
import {
  type Block,
  type SourceNode,
  type Reorder,
  type Kept,
  type Carried,
  nothingCarried,
  type Pairing,
  type Run,
} from './preserve-types'
import {
  withLinkForms,
  signature,
  definesSource,
  sameBlocks,
  sourceRange,
  positionalNode,
  definitionLabel,
  withoutHeadingId,
  semanticSignature,
  lf,
  withEnding,
  form,
  literalForms,
} from './preserve-shape'
import {
  markerAt,
  relabel,
  parentKey,
  renumberItem,
  authoredMarker,
} from './preserve-list'
import { retainSplit, liftedSource } from './preserve-containers'
import { markLiterals } from './preserve-literal'
import { retainSource } from './preserve-retain'
import {
  preservationWork,
  parseDoc,
  parseTree,
  write,
  blockForm,
  crossCheck,
} from './preserve-parse'
import {
  SIMILARITY_BUDGET,
  correspondence,
  tooManyBlocks,
  pairSimilar,
} from './preserve-alignment'
import { PreservationError } from './preserve-error'
export { decodedOffsets } from './preserve-inline'
export { correspondence } from './preserve-alignment'
export { crossCheck, preservationWork } from './preserve-parse'
export { PreservationError } from './preserve-error'
export { semanticSignature } from './preserve-shape'

/** Retains the loaded source of blocks the edit leaves alone. */
export class Preservation {
  private static readonly recent = new WeakMap<Ctx, Preservation>()
  private readonly processor
  private readonly rawTree: Root
  readonly sourceTree: Root

  static read(ctx: Ctx, source: string): Preservation {
    const cached = this.recent.get(ctx)
    const previous =
      cached?.processor === ctx.get(remarkCtx) ? cached : undefined
    if (previous?.source === source) return previous
    const next = new Preservation(ctx, source, previous)
    this.recent.set(ctx, next)
    return next
  }
  /** The document as loaded from `source`. */
  readonly baseline: ProseNode
  private readonly blocks: Block[] = []
  private readonly lineEnding: string
  private readonly originalForms = new Set<string>()
  // Whether the save in progress writes the blocks whose links changed form
  // from the edit.
  private linkEdits = false
  // The form of each block, in order.
  private readonly blockForms: string[] = []
  private readonly forms = new WeakMap<ProseNode, string>()
  private readonly blockEdits = new WeakMap<
    ProseNode,
    { index: number; text: string }
  >()
  private readonly itemEdits = new WeakMap<
    ProseNode,
    { index: number; item: number; from?: number; text: string }
  >()
  private readonly regionEdits = new WeakMap<
    ProseNode,
    { identity: string; nodes: ProseNode[]; text: string }
  >()
  private readonly definitionNodes = new Map<string, number>()
  // The nodes block moves carried, for the save in progress, and where each
  // baseline block sits in the baseline, by node, made when first needed.
  private moves?: WeakSet<ProseNode>
  private origins?: WeakMap<ProseNode, number[]>
  // The source ranges of literal blocks inside other blocks, and the blocks
  // whose literal blocks have been given their canonical form.
  private readonly nestedLiterals = new Set<string>()
  private readonly literalsRead = new WeakSet<Block>()
  // Undefined when a definition sits inside another block, where appending
  // the top-level ones would not reproduce the document.
  private readonly definitionSources?: Array<{ label: string; text: string }>

  constructor(
    private readonly ctx: Ctx,
    private readonly source: string,
    previous?: Preservation,
  ) {
    try {
      const parse = (text: string) => parseDoc(ctx, text)
      this.lineEnding = !source.includes('\n')
        ? source.includes('\r')
          ? '\r'
          : '\n'
        : source.includes('\r\n') &&
            !source.replaceAll('\r\n', '').includes('\n')
          ? '\r\n'
          : '\n'
      const processor = (this.processor = ctx.get(remarkCtx))
      const offset = source.startsWith('\uFEFF') ? 1 : 0
      const body = source.slice(offset)
      const incremental = previous?.readEditedSource(source)
      const rawTree = incremental?.raw ?? parseTree(ctx, source)
      const tree =
        incremental?.tree ??
        (processor.runSync(structuredClone(rawTree), {
          value: body,
        }) as Root)
      this.rawTree = rawTree
      this.sourceTree = tree
      this.baseline =
        incremental?.doc ??
        parseMarkdown(
          ctx.get(schemaCtx),
          processor,
          source,
          structuredClone(tree),
        )
      const positions = new Map(
        rawTree.children.map((node) => [
          `${node.position?.start.offset}:${node.position?.end.offset}`,
          node,
        ]),
      )
      for (const [index, node] of tree.children.entries()) {
        let start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start == null || end == null)
          throw new PreservationError('A source block has no location')
        start += offset
        const sourceEnd = end + offset
        const firstColumn = source.lastIndexOf('\n', start - 1) + 1
        if (/^[ \t]*$/.test(source.slice(firstColumn, start)))
          start = firstColumn
        const text = source.slice(start, sourceEnd)
        const own = this.baseline.childCount === tree.children.length
        const parsed = own
          ? this.baseline.type.create(null, [this.baseline.child(index)])
          : parse(text)
        const blockText =
          previous?.forms.get(parsed.firstChild!) ??
          (parsed.childCount === 1
            ? blockForm(ctx, parsed.firstChild!)
            : form(write(ctx, parsed)))
        // The editor shows the baseline, so its blocks are these nodes until
        // an edit replaces them, and their forms need not be written again.
        if (own) this.forms.set(this.baseline.child(index), blockText)
        const ast = (positions.get(
          `${node.position?.start.offset}:${node.position?.end.offset}`,
        ) ?? node) as unknown as SourceNode
        if (
          parsed.childCount === 1 &&
          parsed.firstChild!.type.name === 'literal_markdown'
        )
          literalForms.set(ast, blockText)
        this.blocks.push({
          start,
          end: sourceEnd,
          form: blockText,
          ast,
        })
      }
      for (const block of this.blocks) {
        this.originalForms.add(block.form)
        this.blockForms.push(block.form)
      }
      const inside = (node: SourceNode) =>
        node.children?.forEach((child) => {
          if (child.type === 'inkkitLiteral')
            this.nestedLiterals.add(sourceRange(child))
          else inside(child)
        })
      ;(tree.children as unknown as SourceNode[]).forEach(inside)
      const definition = (node: SourceNode) =>
        node.type === 'definition' || node.type === 'footnoteDefinition'
      const nested = (node: SourceNode): boolean =>
        (node.children ?? []).some(
          (child) => definition(child) || nested(child),
        )
      const top = rawTree.children as unknown as SourceNode[]
      if (!top.some(nested))
        this.definitionSources = top.filter(definition).map((node) => {
          const raw = source.slice(
            node.position!.start.offset! + offset,
            node.position!.end.offset! + offset,
          )
          // Inline references depend on the footnote label, not its body.
          // Validate the reference without reparsing that body on every key.
          const label = /^\[((?:\\[\s\S]|[^\\\]])*)\]:/.exec(raw)![1]!
          return node.type === 'footnoteDefinition'
            ? { label: definitionLabel(label), text: `[${label}]: x` }
            : { label: definitionLabel(label), text: raw }
        })
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot read Markdown for preservation', {
        cause,
      })
    }
  }

  // Paragraphs and headings separated by blank lines have no state outside
  // their neighbours. Everything that can define or consume distant syntax
  // stays on the full parser path. The changed run is parsed by that same
  // parser, including its neighbours, before any old nodes are reused.
  private readEditedSource(
    source: string,
  ): { raw: Root; tree: Root; doc: ProseNode } | undefined {
    if (
      this.source.startsWith('\uFEFF') ||
      source.startsWith('\uFEFF') ||
      /[\[\]<>%]/.test(this.source) ||
      /[\[\]<>%]/.test(source) ||
      this.blocks.length !== this.baseline.childCount ||
      this.blocks.some(
        (_, index) =>
          !['paragraph', 'heading'].includes(
            this.baseline.child(index).type.name,
          ),
      )
    )
      return
    let prefix = 0,
      suffix = 0
    while (
      prefix < source.length &&
      prefix < this.source.length &&
      source[prefix] === this.source[prefix]
    )
      prefix++
    while (
      suffix < source.length - prefix &&
      suffix < this.source.length - prefix &&
      source[source.length - suffix - 1] ===
        this.source[this.source.length - suffix - 1]
    )
      suffix++
    const first = Math.max(
      0,
      this.blocks.findIndex((block) => block.end >= prefix) - 1,
    )
    let last = this.blocks.findIndex(
      (block) => block.start > this.source.length - suffix,
    )
    if (last < 0) last = this.blocks.length - 1
    else last = Math.min(this.blocks.length - 1, last + 1)
    if (!this.blocks[first] || !this.blocks[last]) return
    const start = this.blocks[first]!.start
    const end = this.blocks[last]!.end
    const delta = source.length - this.source.length
    const nextEnd = end + delta
    if (nextEnd < start || prefix < start || this.source.length - suffix > end)
      return
    const part = new Preservation(this.ctx, source.slice(start, nextEnd))
    if (
      part.blocks.length !== part.baseline.childCount ||
      part.blocks.some(
        (_, index) =>
          !['paragraph', 'heading'].includes(
            part.baseline.child(index).type.name,
          ),
      )
    )
      return
    const lines = [0]
    for (const match of source.matchAll(/\r\n|\r|\n/g))
      lines.push(match.index + match[0].length)
    const point = (offset: number) => {
      let low = 0,
        high = lines.length
      while (low + 1 < high) {
        const middle = (low + high) >> 1
        if (lines[middle]! <= offset) low = middle
        else high = middle
      }
      return { offset, line: low + 1, column: offset - lines[low]! + 1 }
    }
    const shifted = <T>(node: T, amount: number): T => {
      const visit = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(visit)
        if (!value || typeof value !== 'object') return value
        if ('offset' in value && typeof value.offset === 'number')
          return point(value.offset + amount)
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, visit(child)]),
        )
      }
      return visit(node) as T
    }
    const splice = (old: Root, fresh: Root): Root => ({
      type: 'root',
      children: [
        ...old.children.slice(0, first),
        ...fresh.children.map((node) => shifted(node, start)),
        ...old.children.slice(last + 1).map((node) => shifted(node, delta)),
      ],
    })
    const children: ProseNode[] = []
    this.baseline.forEach((node, _offset, index) => {
      if (index === first)
        part.baseline.forEach((child) => children.push(child))
      if (index < first || index > last) children.push(node)
    })
    return {
      raw: splice(this.rawTree, part.rawTree),
      tree: splice(this.sourceTree, part.sourceTree),
      doc: this.baseline.copy(Fragment.fromArray(children)),
    }
  }

  private retainBlock(
    block: Block,
    after: SourceNode,
    canonical: string,
    joined: readonly SourceNode[] = [],
    reorder?: Reorder,
  ): string {
    const offset = this.source.startsWith('\uFEFF') ? 1 : 0
    const start = block.ast.position?.start.offset
    if (start == null)
      throw new PreservationError('A source block has no location')
    this.readNestedLiterals(block)
    return (
      this.source.slice(block.start, start + offset) +
      retainSource(
        block.ast,
        after,
        this.source.slice(offset),
        canonical,
        this.lineEnding,
        false,
        undefined,
        undefined,
        joined,
        reorder,
      )
    )
  }

  // Gives each literal block inside `block` the canonical form it has in the
  // block's own canonical Markdown, found at the same place in its tree.
  private readNestedLiterals(block: Block): void {
    if (!this.nestedLiterals.size || this.literalsRead.has(block)) return
    this.literalsRead.add(block)
    const holds = (node: SourceNode): boolean =>
      (node.children ?? []).some(
        (child) => this.nestedLiterals.has(sourceRange(child)) || holds(child),
      )
    if (!holds(block.ast)) return
    const tree = parseTree(this.ctx, block.form)
    if (tree.children.length !== 1) return
    const pair = (source: SourceNode, written: SourceNode) => {
      if (source.children?.length !== written.children?.length) return
      source.children?.forEach((child, index) => {
        const other = written.children![index]!
        if (other.type !== child.type) return
        if (this.nestedLiterals.has(sourceRange(child)))
          literalForms.set(
            child,
            lf(
              block.form.slice(
                other.position!.start.offset!,
                other.position!.end.offset!,
              ),
            ),
          )
        else pair(child, other)
      })
    }
    pair(block.ast, tree.children[0] as unknown as SourceNode)
  }

  // The original blocks between those paired around a current block, which
  // an edit could have split it from or joined into it.
  private around(positions: Array<number | undefined>, index: number): Block[] {
    let low = index - 1,
      high = index + 1
    while (low >= 0 && positions[low] == null) low--
    while (high < positions.length && positions[high] == null) high++
    const [from, to] = [
      low < 0 ? 0 : positions[low]!,
      high >= positions.length ? this.blocks.length - 1 : positions[high]!,
    ].sort((left, right) => left - right)
    return this.blocks.slice(from, to! + 1)
  }

  // A new list or quote split from one between the blocks paired around it.
  private retainPart(
    positions: Array<number | undefined>,
    index: number,
    after: SourceNode,
    canonical: string,
    taken: Set<SourceNode>,
  ): string | undefined {
    const source = this.source.slice(this.source.startsWith('\uFEFF') ? 1 : 0)
    const part = retainSplit(
      retainSource,
      this.around(positions, index).map((block) => block.ast),
      after,
      source,
      canonical,
      this.lineEnding,
      taken,
    )
    if (!part) return undefined
    const indent = source.slice(
      source.lastIndexOf('\n', part.from - 1) + 1,
      part.from,
    )
    return (/^[ \t]*$/.test(indent) ? indent : '') + part.text
  }

  // A block lifted out of a list item or quote, between the blocks paired
  // around it, keeps the source it was written in.
  private retainLifted(
    positions: Array<number | undefined>,
    index: number,
    after: SourceNode,
  ): string | undefined {
    return liftedSource(
      this.around(positions, index).map((block) => block.ast),
      after,
      this.source.slice(this.source.startsWith('\uFEFF') ? 1 : 0),
    )
  }

  private localEdits(doc: ProseNode): string | undefined {
    if (
      this.baseline.childCount !== this.blocks.length ||
      doc.childCount !== this.blocks.length ||
      !doc.sameMarkup(this.baseline)
    )
      return undefined
    let output = '',
      previous = 0
    let run: number[] = []
    for (let index = 0; index <= doc.childCount; index++) {
      const node = index < doc.childCount ? doc.child(index) : undefined
      const before = node && this.baseline.child(index)
      // A block a move carried from another place is paired with its own
      // original, which only the whole-document path does.
      if (node && node !== before && this.moves?.has(node)) return undefined
      if (
        !node ||
        node === before ||
        (node.eq(before!) && !this.carries(node))
      ) {
        if (run.length > 1 && !this.pairedInPlace(doc, run)) return undefined
        run = []
        continue
      }
      run.push(index)
      const block = this.blocks[index]!
      let retained = this.blockEdits.get(node)
      if (retained?.index !== index) {
        const text = this.localBlock(index, node)
        if (text === undefined) return undefined
        retained = { index, text }
        this.blockEdits.set(node, retained)
      }
      output += this.source.slice(previous, block.start) + retained.text
      previous = block.end
    }
    output += this.source.slice(previous)
    // Front matter is found by reading from the start of the file to the next
    // delimiter line, which an edited block can supply.
    const bom = (text: string) => text.replace(/^\uFEFF/, '')
    return sourceFrontmatter(bom(output)) ===
      sourceFrontmatter(bom(this.source))
      ? output
      : undefined
  }

  // Whole-document matching pairs adjacent edited blocks by resemblance, which
  // can pair one with its neighbour's original. Keep its result exactly.
  private pairedInPlace(doc: ProseNode, run: number[]): boolean {
    if (
      run.some((index) =>
        ['bullet_list', 'ordered_list'].includes(doc.child(index).type.name),
      )
    )
      return false
    const before = run.map((index) => this.blocks[index]!.form)
    const after = run.map((index) => this.formOf(doc.child(index)))
    const result: Array<number | undefined> = run.map((_, at) => at)
    pairSimilar(before, after, 0, run.length, 0, run.length, result, {
      similarity: SIMILARITY_BUDGET,
    })
    return result.every((position, at) => position === at)
  }

  // Every definition in the source, in order. A block's links can depend on
  // definitions and nothing else outside it, so parsing it with these gives
  // the meaning it has in the document.
  // The definitions a block's text can refer to: only a bracketed label that
  // matches one can resolve, so the others need not be parsed with it.
  private definitions(
    text: string,
  ): { text: string; blocks: number; nodes: number } | undefined {
    if (this.definitionSources === undefined) return undefined
    const labels = new Set<string>()
    for (const match of text.matchAll(/\[((?:\\[\s\S]|[^\\[\]])*)\]/g))
      labels.add(definitionLabel(match[1]!))
    const sources = this.definitionSources
      .filter((source) => labels.has(source.label))
      .map((source) => source.text)
    const appended = sources.join('\n\n')
    let nodes = this.definitionNodes.get(appended)
    if (nodes === undefined) {
      nodes = appended ? parseDoc(this.ctx, appended).childCount : 0
      this.definitionNodes.set(appended, nodes)
    }
    return { text: appended, blocks: sources.length, nodes }
  }

  // The block's text followed by what it can depend on elsewhere in the
  // document, or undefined when that cannot be known from the block alone.
  private inContext(
    text: string,
  ): { text: string; blocks: number; nodes: number } | undefined {
    // HTML and %% comments can span blocks.
    if (/<|%%/.test(text)) return undefined
    if (!text.includes('[')) return { text, blocks: 1, nodes: 1 }
    const definitions = this.definitions(text)
    if (!definitions) return undefined
    return definitions.text
      ? {
          text: text + this.lineEnding.repeat(2) + definitions.text,
          blocks: 1 + definitions.blocks,
          nodes: 1 + definitions.nodes,
        }
      : { text, blocks: 1, nodes: 1 }
  }

  // The first block of text as the document would read it in place.
  private parseLocally(text: string): ProseNode | undefined {
    const local = this.inContext(text)
    if (!local) return undefined
    const parsed = parseDoc(this.ctx, local.text)
    return parsed.childCount === local.nodes ? parsed.firstChild! : undefined
  }

  // Canonical Markdown for a block and its source tree, read in the same
  // context, so references in it resolve as they do in the document.
  private canonicalTree(
    text: string,
  ): { canonical: string; node: SourceNode } | undefined {
    const local = this.inContext(text)
    if (!local) return undefined
    const tree = parseTree(this.ctx, local.text)
    return tree.children.length === local.blocks
      ? {
          canonical: local.text,
          node: tree.children[0] as unknown as SourceNode,
        }
      : undefined
  }

  // Inline content other than text and line breaks can depend on other blocks
  // or carry attributes that a reparse does not reproduce.
  private static plainInline(node: ProseNode): boolean {
    let plain = true
    node.descendants((child) => {
      if (
        child.isInline &&
        !child.isText &&
        !['hardbreak', 'footnote_reference'].includes(child.type.name)
      )
        plain = false
      return plain
    })
    return plain
  }

  private separated(index: number): boolean {
    const block = this.blocks[index]!
    return (
      (index === 0 ||
        /\r?\n[ \t]*\r?\n/.test(
          this.source.slice(this.blocks[index - 1]!.end, block.start),
        )) &&
      (index + 1 === this.blocks.length ||
        /\r?\n[ \t]*\r?\n/.test(
          this.source.slice(block.end, this.blocks[index + 1]!.start),
        ))
    )
  }

  // Validates a changed block on its own when nothing outside it can change
  // what it means, so a keystroke does not serialize and reparse the document.
  private localBlock(index: number, node: ProseNode): string | undefined {
    const before = this.baseline.child(index)
    const block = this.blocks[index]!
    const expected = withoutHeadingId(node)
    if (
      !expected.sameMarkup(withoutHeadingId(before)) ||
      !this.separated(index)
    )
      return undefined
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list')
      return this.localItems(index, node)
    const code = node.type.name === 'code_block'
    // Indented code is rewritten fenced, and the blocks after it can then read
    // differently.
    if (
      code &&
      !/^ {0,3}(?:`{3,}|~{3,})/.test(this.source.slice(block.start, block.end))
    )
      return undefined
    if (
      !code &&
      (!['paragraph', 'heading', 'table'].includes(node.type.name) ||
        !Preservation.plainInline(node) ||
        !Preservation.plainInline(before) ||
        !this.inContext(this.source.slice(block.start, block.end)))
    )
      return undefined
    const form = this.formOf(node)
    if (form !== block.form && this.originalForms.has(form)) return undefined
    // Code is literal, so only its fence decides where it ends.
    const canonical = code
      ? (() => {
          const tree = parseTree(this.ctx, form)
          return tree.children.length === 1
            ? {
                canonical: form,
                node: tree.children[0] as unknown as SourceNode,
              }
            : undefined
        })()
      : this.canonicalTree(form)
    if (!canonical) return undefined
    const text = this.retainBlock(block, canonical.node, canonical.canonical)
    const reopened = code
      ? (() => {
          const parsed = parseDoc(this.ctx, text)
          return parsed.childCount === 1 ? parsed.firstChild! : undefined
        })()
      : this.parseLocally(text)
    // The authored fence is presentation the editor keeps from loading.
    const same = (node: ProseNode) =>
      code
        ? node.type === expected.type &&
          node.attrs.language === expected.attrs.language &&
          node.content.eq(expected.content)
        : withoutHeadingId(node).eq(expected)
    return reopened && same(reopened) ? text : undefined
  }

  private formOf(node: ProseNode): string {
    let form = this.forms.get(node)
    if (form == null) {
      form = blockForm(this.ctx, node)
      this.forms.set(node, form)
    }
    return form
  }

  // A list is one block, so typing in one item of a long list validates that
  // item alone, read as the only item of a list with the same marker.
  private localItems(index: number, node: ProseNode): string | undefined {
    const before = this.baseline.child(index)
    const block = this.blocks[index]!
    const list = block.ast
    const offset = this.source.startsWith('\uFEFF') ? 1 : 0
    const source = this.source.slice(offset)
    if (
      list.type !== 'list' ||
      list.children?.length !== node.childCount ||
      before.childCount !== node.childCount
    )
      return undefined
    // Whole-document matching would read a list that now matches another one
    // as moved there.
    for (let other = 0; other < this.baseline.childCount; other++) {
      const candidate = this.baseline.child(other)
      if (
        other !== index &&
        candidate.type === node.type &&
        candidate.childCount === node.childCount &&
        candidate.textContent === node.textContent
      )
        return undefined
    }
    const marker = authoredMarker(list, source)
    // Items a block move carried within this list, and below it.
    const reorder = this.moves ? this.carriedChildren(node, index) : undefined
    const carried = reorder?.get(parentKey(list))
    let output = ''
    let previous = block.start
    for (let at = 0; at < node.childCount; at++) {
      const item = node.child(at)
      const original = before.child(at)
      if (item === original || (item.eq(original) && !this.carries(item)))
        continue
      const moved = carried?.get(at)
      // A carried item keeps its source only where both trees agree on it.
      const from =
        moved !== undefined && list.children[moved] ? moved : undefined
      let retained = this.itemEdits.get(item)
      if (
        retained?.index !== index ||
        retained.item !== at ||
        retained.from !== from
      ) {
        const text =
          from === undefined
            ? this.localItem(
                node,
                item,
                before.child(at),
                list.children[at]!,
                source,
                marker,
                reorder,
              )
            : this.movedItem(
                node,
                item,
                list,
                list.children[from]!,
                list.children[at]!,
                source,
                marker,
              )
        if (text === undefined) return undefined
        retained = { index, item: at, from, text }
        this.itemEdits.set(item, retained)
      }
      const ast = list.children[at]!
      output +=
        this.source.slice(previous, ast.position!.start.offset! + offset) +
        retained.text
      previous = ast.position!.end.offset! + offset
    }
    return output + this.source.slice(previous, block.end)
  }

  // The source of an item a block move carried from `original`'s place to
  // `place`'s, when it reads there as the same item with the same marker and
  // spacing as that place.
  private movedItem(
    node: ProseNode,
    item: ProseNode,
    list: SourceNode,
    original: SourceNode,
    place: SourceNode,
    source: string,
    marker: string | undefined,
  ): string | undefined {
    const start = original.position!.start.offset!
    const end = original.position!.end.offset!
    if (
      !Preservation.plainInline(item) ||
      !this.inContext(source.slice(start, end))
    )
      return undefined
    let text = source.slice(start, end)
    if (list.ordered) text = renumberItem(text, source, original, place)
    if (marker) text = relabel(text, [0], marker)
    return this.readsAsItem(node, item, text, place, source)
  }

  // `text` in place of the item at `ast`, when it starts with the same marker
  // and spacing, which set the column that continuation lines and blocks after
  // the list are read against, and reads alone as `item`.
  private readsAsItem(
    list: ProseNode,
    item: ProseNode,
    text: string,
    ast: SourceNode,
    source: string,
  ): string | undefined {
    const start = ast.position!.start.offset!
    const content = ast.children?.[0]?.position?.start.offset
    if (content == null || !text.startsWith(source.slice(start, content)))
      return undefined
    // An item with nothing on its first line has a different content column.
    if (/^(?:[-*+]|\d{1,9}[.)])[ \t]*(?:\r?\n|$)/.test(text)) return undefined
    const indent = source.slice(source.lastIndexOf('\n', start - 1) + 1, start)
    if (!/^[ \t]*$/.test(indent)) return undefined
    const reopened = this.parseLocally(indent + text)
    if (reopened?.type !== list.type || reopened.childCount !== 1)
      return undefined
    const reread = reopened.firstChild!
    // The label and spacing of an item come from its list.
    const { label: _label, spread: _spread, ...attrs } = reread.attrs
    const { label: _l, spread: _s, ...expected } = item.attrs
    return reread.type === item.type &&
      JSON.stringify(attrs) === JSON.stringify(expected) &&
      reread.content.eq(item.content)
      ? text
      : undefined
  }

  private localItem(
    list: ProseNode,
    item: ProseNode,
    before: ProseNode,
    ast: SourceNode,
    source: string,
    marker: string | undefined,
    reorder?: Reorder,
  ): string | undefined {
    const start = ast.position!.start.offset!
    const end = ast.position!.end.offset!
    if (
      !item.sameMarkup(before) ||
      !sameBlocks(item, before) ||
      !Preservation.plainInline(item) ||
      !Preservation.plainInline(before) ||
      // The authored item is compared with the edit, so it must read the same
      // in this context too.
      !this.inContext(source.slice(start, end))
    )
      return undefined
    const local = this.canonicalTree(
      form(
        write(
          this.ctx,
          list.type.schema.topNodeType.create(null, [
            list.type.create(list.attrs, [item]),
          ]),
        ),
      ),
    )
    const after = local?.node.children?.[0]
    if (!local || local.node.children!.length !== 1 || !after) return undefined
    // Whether an item is spread depends on the blank lines around it, which an
    // edit that keeps its blocks does not change.
    let text = retainSource(
      ast,
      { ...after, spread: ast.spread },
      source,
      local.canonical,
      this.lineEnding,
      false,
      undefined,
      undefined,
      [],
      reorder,
    )
    if (marker) text = relabel(text, [0], marker)
    return this.readsAsItem(list, item, text, ast, source)
  }

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
      positions[index] == null && this.originalForms.has(current[index]!)
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
            ? this.blocks.length
            : positions[next]!
      if ((other - own) * step <= 0) return false
      for (let at = own + step; at !== other; at += step)
        if (elsewhere.has(this.blocks[at]!.form)) return false
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

  /** `moved` holds the nodes block moves carried. A moved node that is still a
   *  node of the loaded document keeps that node's source where it reads the
   *  same; every other edit is saved without it. */
  serialize(doc: ProseNode, moved?: WeakSet<ProseNode>): string {
    this.moves = moved
    try {
      return this.serializeWith(doc)
    } finally {
      this.moves = undefined
    }
  }

  private serializeWith(doc: ProseNode): string {
    if (this.unchanged(doc)) return this.source
    let local: string | undefined
    try {
      local = this.localEdits(doc)
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot preserve the edited Markdown', {
        cause,
      })
    }
    if (local === undefined)
      try {
        local = this.regions(doc)
      } catch {
        // The whole-document path decides, and refuses if it fails too.
        local = undefined
      }
    return local === undefined
      ? this.wholeDocument(doc)
      : this.checked(doc, local)
  }

  // Equal to the loaded document. The editor shows the baseline's own nodes,
  // and an edit keeps the nodes it does not reach, so most blocks are
  // compared by identity rather than by content.
  private unchanged(doc: ProseNode): boolean {
    if (doc === this.baseline) return true
    if (
      doc.childCount !== this.baseline.childCount ||
      !doc.sameMarkup(this.baseline)
    )
      return false
    for (let index = 0; index < doc.childCount; index++) {
      const node = doc.child(index)
      const before = this.baseline.child(index)
      if (node !== before && (!node.eq(before) || this.carries(node)))
        return false
    }
    return true
  }

  // Whether a move carried `node` or a block inside it, so that a node equal
  // to its original can still be written differently.
  private carries(node: ProseNode): boolean {
    const moves = this.moves
    if (!moves) return false
    let found = moves.has(node)
    node.descendants((child) => {
      found ||= moves.has(child)
      return !found && !child.isTextblock
    })
    return found
  }

  // In cross-check mode, records where the whole-document path would save
  // different bytes or refuse.
  private checked(doc: ProseNode, text: string): string {
    if (!crossCheck.enabled) return text
    crossCheck.compared++
    const { characters } = preservationWork
    let whole: string
    try {
      whole = this.wholeDocument(doc)
    } catch (error) {
      // An edit validated where it stands needs no matching, so it can save
      // when matching the whole document would run out of budget.
      whole =
        (error as Error).message === tooManyBlocks().message &&
        this.reopens(doc, text)
          ? text
          : `refused: ${(error as Error).message}`
    }
    preservationWork.characters = characters
    if (whole !== text)
      crossCheck.differences.push(
        JSON.stringify({ source: this.source, fast: text, whole }),
      )
    return text
  }

  // Whether `output` reads back as `doc`.
  private reopens(
    doc: ProseNode,
    output: string,
    canonical = write(this.ctx, doc),
  ): boolean {
    const reopened = parseDoc(this.ctx, output)
    if (semanticSignature(reopened) !== semanticSignature(doc)) return false
    const normalized = (text: string): string => text.replace(/\r\n?/g, '\n')
    const actual = normalized(write(this.ctx, reopened))
    // Parsing may normalize loose-list spacing. Compare both reconstructed
    // source and intended canonical source after that same normalization.
    return (
      actual === normalized(canonical) ||
      actual === normalized(write(this.ctx, parseDoc(this.ctx, canonical)))
    )
  }

  // The gap the whole-document path writes before the current block at
  // `index`: the authored text between two blocks paired one after the other,
  // otherwise a blank line. The first block keeps the file's head when it is
  // paired with the first original.
  private gap(index: number, positions: Array<number | undefined>): string {
    const position = positions[index]
    const block = position == null ? undefined : this.blocks[position]
    if (index === 0)
      return position === 0 && block
        ? this.source.slice(0, block.start)
        : this.source.startsWith('\uFEFF')
          ? '\uFEFF'
          : ''
    const previous = positions[index - 1]
    // Appending after the last authored block keeps its trailing whitespace.
    // The existing reparse still decides whether the new block is separate.
    if (previous === this.blocks.length - 1 && position == null) {
      const ending = this.source.slice(this.blocks[previous]!.end)
      const lines = ending.replace(/\r\n?/g, '\n')
      if (/\n[ \t]*\n/.test(lines))
        return ending + (lines.endsWith('\n') ? '' : this.lineEnding)
      return ending + this.lineEnding.repeat(lines.endsWith('\n') ? 1 : 2)
    }
    return previous != null && position === previous + 1 && block
      ? this.source.slice(this.blocks[previous]!.end, block.start)
      : this.lineEnding.repeat(2)
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
      if (position != null) paired.add(this.blocks[position]!)
    }
    // The children each edited list or quote keeps at its start and end,
    // which a part split from the same original cannot also be.
    const taken = new Set<SourceNode>()
    if (tree)
      for (let index = from; index < to; index++) {
        const position = positions[index]
        const kids =
          position == null ? undefined : this.blocks[position]!.ast.children
        const now = transformed(index).children
        if (!kids || !now || this.blocks[position!]!.form === current[index])
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
            : this.blocks[moved]
          : this.blocks[position]
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
          ? this.source.slice(block!.start, block!.end)
          : kind === 'edited'
            ? this.retainingForms(block!, doc.child(index), () =>
                this.retainBlock(
                  block!,
                  node!,
                  canonical,
                  this.around(positions, index)
                    .filter(
                      (other) =>
                        !paired.has(other) &&
                        other.ast.type === block!.ast.type,
                    )
                    .flatMap((other) => other.ast.children ?? []),
                  carried.children
                    ? this.carriedChildren(doc.child(index), position!)
                    : undefined,
                ),
              )
            : ((node &&
                (this.retainPart(positions, index, node, canonical, taken) ??
                  this.retainLifted(positions, index, node))) ??
              restoreCodeEndings(
                this.ctx,
                doc.type.create(null, [doc.child(index)]),
                withEnding(text, this.lineEnding),
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
      ? this.definitions(written)
      : undefined
    const canonical = definitions?.text
      ? written + this.lineEnding.repeat(2) + definitions.text
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
  private runs(
    positions: Array<number | undefined>,
    current: string[],
    within: Set<number> = nothingCarried.within,
  ): Run[] {
    const unchanged = (index: number) => {
      const position = positions[index]
      return (
        position != null &&
        this.blocks[position]!.form === current[index] &&
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
      positions[previous] !== this.blocks.length - 1
    )
      runs.push({ previous })
    return runs
  }

  // Whether each run reads as it does in the document when it is read with
  // the definitions it refers to, which holds when every definition is a
  // top-level block that no run adds, changes or removes. Otherwise changed
  // blocks are read in the canonical Markdown of the whole document.
  private readAlone(
    doc: ProseNode,
    positions: Array<number | undefined>,
    runs: Run[],
  ): boolean {
    if (this.definitionSources === undefined) return false
    return runs.every((run) => {
      const from = run.previous === undefined ? 0 : run.previous + 1
      const to = run.next ?? doc.childCount
      for (let index = from; index < to; index++)
        if (Preservation.defines(doc.child(index))) return false
      const first =
        run.previous === undefined ? 0 : positions[run.previous]! + 1
      const last =
        run.next === undefined ? this.blocks.length : positions[run.next]!
      for (let index = first; index < last; index++)
        if (definesSource(this.blocks[index]!.ast)) return false
      return true
    })
  }

  // What the whole-document path writes for the changed blocks of a run, read
  // from their own canonical Markdown.
  private runPieces(
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

  // Saves an edit that inserts, removes, splits or joins blocks by validating
  // only what changed. Blocks are paired with their originals as the
  // whole-document path pairs them, and each run of changed blocks between
  // unchanged ones is written by the same code. Each run is then read back
  // with the unchanged block on either side, which shows that nothing in it
  // changes how those blocks, or the blocks beyond them, read. Returns
  // undefined whenever that cannot be shown, and the whole-document path
  // decides.
  private regions(doc: ProseNode): string | undefined {
    const count = doc.childCount
    if (
      !count ||
      this.baseline.childCount !== this.blocks.length ||
      !doc.sameMarkup(this.baseline) ||
      // `readAlone` would refuse this after pairing; checking first skips it.
      this.definitionSources === undefined
    )
      return undefined
    const current: string[] = []
    doc.forEach((node) => current.push(this.formOf(node)))
    let positions: Array<number | undefined>
    let carried: Carried
    try {
      ;({ positions, carried } = this.pairing(doc, current))
    } catch {
      return undefined
    }
    const runs = this.runs(positions, current, carried.within)
    if (
      // With nothing left as it was, the whole document is one run.
      runs.some(
        (run) => run.previous === undefined && run.next === undefined,
      ) ||
      !this.readAlone(doc, positions, runs)
    )
      return undefined
    let output = ''
    let at = 0
    for (const run of runs) {
      const from =
        run.previous === undefined
          ? 0
          : this.blocks[positions[run.previous]!]!.end
      const to =
        run.next === undefined
          ? this.source.length
          : this.blocks[positions[run.next]!]!.start
      const text = this.region(doc, positions, current, carried, run)
      if (text === undefined) return undefined
      output += this.source.slice(at, from) + text
      at = to
    }
    output += this.source.slice(at)
    // Front matter runs from the start of the file to the next delimiter
    // line, which a changed block can supply, and a rule that opens the file
    // would then be rewritten.
    const bom = (text: string) => text.replace(/^\uFEFF/, '')
    const frontmatter = sourceFrontmatter(bom(output))
    if (
      frontmatter !== sourceFrontmatter(bom(this.source)) ||
      (doc.firstChild?.type.name === 'hr' && frontmatter?.startsWith('---'))
    )
      return undefined
    return output
  }

  // The text that replaces the source between the unchanged blocks around a
  // run, or undefined when the run cannot be validated on its own.
  private region(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
    carried: Carried,
    run: Run,
  ): string | undefined {
    const from = run.previous === undefined ? 0 : run.previous + 1
    const to = run.next ?? doc.childCount
    const nodes: ProseNode[] = []
    for (let index = from; index < to; index++) nodes.push(doc.child(index))
    const neighbours = [run.previous, run.next].flatMap((index) =>
      index === undefined ? [] : [doc.child(index)],
    )
    const key = nodes[0] ?? neighbours[0]!
    const original = (index: number | undefined) =>
      index === undefined ? -1 : positions[index]!
    const identity = [
      original(run.previous),
      original(run.next),
      // Unpaired positions are holes, which `slice` keeps as holes.
      ...Array.from(
        { length: to - from },
        (_, at) =>
          positions[from + at] ?? `m${carried.moved.get(from + at) ?? ''}`,
      ),
    ].join()
    const cached = this.regionEdits.get(key)
    if (
      cached &&
      cached.identity === identity &&
      cached.nodes.length === nodes.length + neighbours.length &&
      [...nodes, ...neighbours].every(
        (node, index) => cached.nodes[index] === node,
      )
    )
      return cached.text
    // Two lists of one kind side by side need markers chosen across both.
    const list = (index: number) => {
      const name = doc.maybeChild(index)?.type.name
      return name === 'bullet_list' || name === 'ordered_list'
        ? name
        : undefined
    }
    for (
      let index = Math.max(1, from);
      index <= Math.min(to, doc.childCount - 1);
      index++
    )
      if (list(index) && list(index) === list(index - 1)) return undefined
    const { gaps, pieces } = this.runPieces(
      doc,
      positions,
      current,
      carried,
      run,
    )
    let text = pieces.map((piece, index) => gaps[index] + piece).join('')
    if (run.next !== undefined) text += this.gap(run.next, positions)
    else
      text += this.endsAsAuthored(positions, carried)
        ? this.source.slice(this.blocks.at(-1)!.end)
        : (finalCodeEnding(doc) ?? this.lineEnding)
    const slice = (index: number | undefined) => {
      if (index === undefined) return ''
      const block = this.blocks[positions[index]!]!
      return this.source.slice(block.start, block.end)
    }
    const read = [
      ...(run.previous === undefined ? [] : [doc.child(run.previous)]),
      ...nodes,
      ...(run.next === undefined ? [] : [doc.child(run.next)]),
    ]
    if (!this.readsAs(slice(run.previous) + text + slice(run.next), read))
      return undefined
    this.regionEdits.set(key, {
      identity,
      nodes: [...nodes, ...neighbours],
      text,
    })
    return text
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

  // Whether `text` reads as `nodes` in place. HTML blocks, HTML comments and
  // `%%` comments can span blocks, so text holding them is not read alone;
  // the `<br />` line an empty paragraph is written as is the exception. A
  // paragraph after the text must still read as a paragraph of its own, which
  // shows that nothing in the text runs on into what follows it.
  private readsAs(text: string, nodes: ProseNode[]): boolean {
    if (
      text.includes('%%') ||
      text
        .split(/\r?\n/)
        .some((line) => line.includes('<') && !lineBreakHTML(line))
    )
      return false
    const definitions = text.includes('[')
      ? this.definitions(text)
      : { text: '', blocks: 0, nodes: 0 }
    if (!definitions) return false
    const sentinel = 'InkKit end of region'
    const separator = this.lineEnding.repeat(2)
    const read = parseDoc(
      this.ctx,
      text +
        separator +
        sentinel +
        (definitions.text ? separator + definitions.text : ''),
    )
    if (
      read.childCount !== nodes.length + 1 + definitions.nodes ||
      read.child(nodes.length).type.name !== 'paragraph' ||
      read.child(nodes.length).textContent !== sentinel
    )
      return false
    const children: ProseNode[] = []
    for (let index = 0; index < nodes.length; index++)
      children.push(read.child(index))
    const expected = read.type.create(null, nodes)
    const reopened = read.type.create(null, children)
    if (semanticSignature(reopened) !== semanticSignature(expected))
      return false
    const normalized = (value: string): string => value.replace(/\r\n?/g, '\n')
    const canonical = write(this.ctx, expected)
    const actual = normalized(write(this.ctx, reopened))
    if (actual === normalized(canonical)) return true
    // Parsing may normalize loose-list spacing, as in `reopens`.
    const again = parseDoc(
      this.ctx,
      canonical + (definitions.text ? separator + definitions.text : ''),
    )
    if (again.childCount !== nodes.length + definitions.nodes) return false
    const rewritten: ProseNode[] = []
    for (let index = 0; index < nodes.length; index++)
      rewritten.push(again.child(index))
    return (
      actual === normalized(write(this.ctx, read.type.create(null, rewritten)))
    )
  }

  // Runs `run` with the blocks whose links changed form written from the
  // edit instead of kept from the source.
  private withLinkEdits<T>(run: () => T): T {
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
    const original = this.baseline.maybeChild(this.blocks.indexOf(block))
    return !original ||
      this.baseline.childCount !== this.blocks.length ||
      forms(original) !== forms(node)
      ? withLinkForms(retain)
      : retain()
  }

  private wholeDocument(doc: ProseNode): string {
    try {
      const canonical = write(this.ctx, doc)
      if (canonical === '')
        return this.source.startsWith('\uFEFF') ? '\uFEFF' : ''
      const current: string[] = []
      doc.forEach((node) => current.push(this.formOf(node)))
      const pairing = this.pairing(doc, current)
      const carries = pairing.carried.moved.size > 0 || pairing.carried.children
      // The document as the source and the edit leave it, or undefined when
      // it does not read back as `doc`.
      const attempt = (): string | undefined => {
        if (carries) {
          // A moved block's source can read differently where it now stands,
          // such as indented code under a list. The moved blocks are then
          // written as an edit without the move's record writes them.
          let output: string | undefined
          try {
            output = this.writeDocument(doc, current, pairing)
          } catch {
            output = undefined
          }
          if (output !== undefined && this.reopens(doc, output, canonical))
            return output
        }
        const output = this.writeDocument(
          doc,
          current,
          carries
            ? {
                positions: correspondence(this.blockForms, current),
                carried: nothingCarried,
              }
            : pairing,
        )
        return this.reopens(doc, output, canonical) ? output : undefined
      }
      // An address typed into angle brackets, or out of them, reads as the
      // same link, so the first attempt keeps its source and is refused on
      // reading back. The second attempt writes the links that edit changed
      // as the edit left them.
      const output = attempt() ?? this.withLinkEdits(attempt)
      if (output !== undefined) return output
      throw new PreservationError(
        'The edited Markdown cannot be reopened without changing its content',
      )
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot preserve the edited Markdown', {
        cause,
      })
    }
  }

  // The whole document written from `pairing`. Unchanged blocks keep their
  // source and the text between them. Each run of changed blocks is written
  // from its own canonical Markdown, or, when a run can't be read alone,
  // every block from the whole document's.
  private writeDocument(
    doc: ProseNode,
    current: string[],
    { positions, carried }: Pairing,
  ): string {
    const gaps = current.map((_, index) => this.gap(index, positions))
    const pieces = positions.map((position) =>
      position == null
        ? ''
        : this.source.slice(
            this.blocks[position]!.start,
            this.blocks[position]!.end,
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
    const previous = positions.at(-1)
    this.separateLists(doc, pieces, kept, positions, current)
    let output = pieces.map((piece, index) => gaps[index] + piece).join('')
    if (this.endsAsAuthored(positions, carried))
      output += this.source.slice(this.blocks.at(-1)!.end)
    else if (output) output += finalCodeEnding(doc) ?? this.lineEnding
    // A `---` rule that opens the file reads back as front matter when
    // another `---` line follows, whether it is new or moved there.
    const bom = output.startsWith('\uFEFF') ? 1 : 0
    if (
      doc.firstChild?.type.name === 'hr' &&
      sourceFrontmatter(output.slice(bom))?.startsWith('---')
    )
      output = output.slice(0, bom) + '***' + output.slice(bom + 3)
    return output
  }

  // Where each baseline block sits in the baseline, by node: its index among
  // the top-level blocks, then among the children of each block above it.
  private originIndex(): WeakMap<ProseNode, number[]> {
    if (this.origins) return this.origins
    const origins = new WeakMap<ProseNode, number[]>()
    const visit = (node: ProseNode, path: number[]) =>
      node.forEach((child, _, index) => {
        const at = [...path, index]
        origins.set(child, at)
        if (!child.isTextblock && !child.isLeaf && child.type.name !== 'table')
          visit(child, at)
      })
    visit(this.baseline, [])
    return (this.origins = origins)
  }

  // Pairs the current blocks with the originals. Without block moves, this is
  // `correspondence`. A top-level block a move carried, that is still a node
  // of the baseline, is paired with its own original before the others are
  // matched, so a copy of its text elsewhere can't take its source or give it
  // another's. Back beside a neighbor it had in the source, it is paired in
  // place, as if it had not moved; otherwise it keeps its source as a moved
  // block.
  private pairing(doc: ProseNode, current: string[]): Pairing {
    const moves = this.moves
    if (!moves || this.baseline.childCount !== this.blocks.length)
      return {
        positions: correspondence(this.blockForms, current),
        carried: nothingCarried,
      }
    const origins = this.originIndex()
    const pinned = new Map<number, number>()
    doc.forEach((node, _, index) => {
      if (moves.has(node)) {
        const origin = origins.get(node)
        if (origin?.length === 1) pinned.set(index, origin[0]!)
      }
    })
    if (!pinned.size) {
      const positions = correspondence(this.blockForms, current)
      return {
        positions,
        carried: {
          moved: pinned,
          children: true,
          within: this.within(doc, positions, current),
        },
      }
    }
    const taken = new Set(pinned.values())
    const before = this.blocks.flatMap((_, index) =>
      taken.has(index) ? [] : [index],
    )
    const after = current.flatMap((_, index) =>
      pinned.has(index) ? [] : [index],
    )
    // A block that is still a node of the baseline is matched with its own
    // original, so a copy of it elsewhere can't take its place when a move
    // has left its neighbors out of order.
    const present = new Map<number, number>()
    for (const index of after) {
      const origin = origins.get(doc.child(index))
      if (origin?.length === 1) present.set(index, origin[0]!)
    }
    const kept = new Set(present.values())
    const matched = correspondence(
      before.map((index) =>
        kept.has(index)
          ? `${this.blockForms[index]!}\u0000${index}`
          : this.blockForms[index]!,
      ),
      after.map((index) =>
        present.has(index)
          ? `${current[index]!}\u0000${present.get(index)!}`
          : current[index]!,
      ),
    )
    const positions: Array<number | undefined> = new Array(current.length)
    after.forEach((index, at) => {
      const match = matched[at]
      if (match !== undefined) positions[index] = before[match]
    })
    // The paired original after each current block, so a carried block back
    // in its own place is paired there, as if it had not moved.
    const next: number[] = new Array(current.length)
    let following = this.blocks.length
    for (let index = current.length - 1; index >= 0; index--) {
      next[index] = following
      if (positions[index] !== undefined) following = positions[index]!
    }
    // The original of each block that is still a node of the baseline. A
    // carried block between two of them in their source order is in its own
    // place, as after Undo, even when blocks around it were deleted since.
    const own = (index: number) => {
      const origin = origins.get(doc.child(index))
      return origin?.length === 1 ? origin[0]! : undefined
    }
    const above: number[] = new Array(current.length)
    let upper = this.blocks.length
    for (let index = current.length - 1; index >= 0; index--) {
      above[index] = upper
      upper = own(index) ?? upper
    }
    const moved = new Map<number, number>()
    let last = -1
    let lower = -1
    for (let index = 0; index < current.length; index++) {
      const origin = pinned.get(index)
      const inOrder = origin! > lower && origin! < above[index]!
      lower = own(index) ?? lower
      if (origin === undefined) {
        if (positions[index] !== undefined) last = positions[index]!
      } else if (origin > last && origin < next[index]! && inOrder) {
        positions[index] = origin
        last = origin
      } else moved.set(index, origin)
    }
    return {
      positions,
      carried: {
        moved,
        children: true,
        within: this.within(doc, positions, current),
      },
    }
  }

  // Whether the text after the last block stays as authored: the last block
  // is paired with the last original, or a move carried the last original
  // elsewhere and a carried block ends the note.
  private endsAsAuthored(
    positions: Array<number | undefined>,
    carried: Carried,
  ): boolean {
    const end = this.blocks.length - 1
    if (end < 0) return false
    if (positions.at(-1) === end) return true
    return (
      carried.moved.has(positions.length - 1) &&
      [...carried.moved.values()].includes(end)
    )
  }

  // The blocks that read the same as the originals they are paired with, but
  // hold children a move carried, so their source can change.
  private within(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
  ): Set<number> {
    const within = new Set<number>()
    positions.forEach((position, index) => {
      const node = doc.child(index)
      if (
        position !== undefined &&
        this.blocks[position]!.form === current[index] &&
        node !== this.baseline.child(position) &&
        this.carries(node)
      )
        within.add(index)
    })
    return within
  }

  // Where block moves carried the children of the current block `node`,
  // paired with the original at `original`: for each list, quote, callout or
  // footnote of the original, by where it starts in the source, the original
  // index of each child a move carried, by its current index.
  private carriedChildren(
    node: ProseNode,
    original: number,
  ): Reorder | undefined {
    const moves = this.moves
    if (!moves || this.baseline.childCount !== this.blocks.length) return
    const origins = this.originIndex()
    let reorder: Reorder | undefined
    const walk = (
      current: ProseNode,
      path: number[],
      ast: SourceNode | undefined,
    ) => {
      if (!ast?.children || ast.position?.start.offset == null) return
      current.forEach((child, _, index) => {
        let from = index
        const origin = moves.has(child) ? origins.get(child) : undefined
        if (
          origin?.length === path.length + 1 &&
          origin.every((step, at) => at === path.length || step === path[at])
        ) {
          from = origin.at(-1)!
          if (from !== index) {
            reorder ??= new Map()
            const key = parentKey(ast)
            if (!reorder.has(key)) reorder.set(key, new Map())
            reorder.get(key)!.set(index, from)
          }
        }
        if (!child.isTextblock && !child.isLeaf && child.type.name !== 'table')
          walk(child, [...path, from], ast.children![from])
      })
    }
    walk(node, [original], this.blocks[original]!.ast)
    return reorder
  }
}
