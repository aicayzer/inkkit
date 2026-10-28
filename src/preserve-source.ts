import { matchingTextEdges } from './text-edges'
import { leadingBOMLength, withoutLeadingBOM } from './bom'
import { remarkCtx } from '@milkdown/kit/core'
import { schemaCtx } from '@milkdown/kit/core'
import { parseMarkdown } from './parser'
import type { Ctx } from '@milkdown/kit/ctx'
import { Fragment } from '@milkdown/kit/prose/model'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { type Block, type SourceNode, type Reorder } from './preserve-types'
import { retainSource } from './preserve-retain'
import { PreservationError } from './preserve-error'
import { retainSplit, liftedSource } from './preserve-containers'
import { parseDoc, parseTree, write, blockForm } from './preserve-parse'
import {
  sourceRange,
  definitionLabel,
  lf,
  form,
  literalForms,
} from './preserve-shape'

// A loaded source owns its parse trees, authored blocks and canonical-form caches.
export class LoadedSource {
  readonly processor
  private readonly rawTree: Root
  readonly sourceTree: Root
  readonly baseline: ProseNode
  readonly blocks: Block[] = []
  readonly lineEnding: string
  readonly originalForms = new Set<string>()
  readonly blockForms: string[] = []
  private readonly forms = new WeakMap<ProseNode, string>()
  // Canonical literal forms are resolved once for each authored block.
  private readonly nestedLiterals = new Set<string>()
  private readonly literalsRead = new WeakSet<Block>()
  // Undefined when a definition sits inside another block, where appending
  // the top-level ones would not reproduce the document.
  readonly definitionSources?: Array<{ label: string; text: string }>

  constructor(
    private readonly ctx: Ctx,
    readonly source: string,
    previous?: LoadedSource,
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
      const offset = leadingBOMLength(source)
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
      leadingBOMLength(this.source) ||
      leadingBOMLength(source) ||
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
    const { prefix, suffix } = matchingTextEdges(source, this.source)
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
    const part = new LoadedSource(this.ctx, source.slice(start, nextEnd))
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

  retainBlock(
    block: Block,
    after: SourceNode,
    canonical: string,
    joined: readonly SourceNode[] = [],
    reorder?: Reorder,
  ): string {
    const offset = leadingBOMLength(this.source)
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
  around(positions: Array<number | undefined>, index: number): Block[] {
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
  retainPart(
    positions: Array<number | undefined>,
    index: number,
    after: SourceNode,
    canonical: string,
    taken: Set<SourceNode>,
  ): string | undefined {
    const source = withoutLeadingBOM(this.source)
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
  retainLifted(
    positions: Array<number | undefined>,
    index: number,
    after: SourceNode,
  ): string | undefined {
    return liftedSource(
      this.around(positions, index).map((block) => block.ast),
      after,
      withoutLeadingBOM(this.source),
    )
  }

  formOf(node: ProseNode): string {
    let form = this.forms.get(node)
    if (form == null) {
      form = blockForm(this.ctx, node)
      this.forms.set(node, form)
    }
    return form
  }
}
