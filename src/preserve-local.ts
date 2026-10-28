import { leadingBOMLength, withoutLeadingBOM } from './bom'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { sourceFrontmatter } from './literals'
import { type SourceNode, type Reorder } from './preserve-types'
import { retainSource } from './preserve-retain'
import { SIMILARITY_BUDGET, pairSimilar } from './preserve-alignment'
import { parseDoc, parseTree, write } from './preserve-parse'
import { sameBlocks, withoutHeadingId, form } from './preserve-shape'
import {
  relabel,
  parentKey,
  renumberItem,
  authoredMarker,
} from './preserve-list'
import { type LoadedSource } from './preserve-source'
import { type DefinitionContext } from './preserve-context'
import { type MoveOrigins } from './preserve-moves'

// Validated block and item results are cached only for this loaded source.
export class LocalEdits {
  private readonly blockEdits = new WeakMap<
    ProseNode,
    { index: number; text: string }
  >()
  private readonly itemEdits = new WeakMap<
    ProseNode,
    { index: number; item: number; from?: number; text: string }
  >()

  constructor(
    private readonly ctx: Ctx,
    private readonly loaded: Pick<
      LoadedSource,
      | 'baseline'
      | 'blocks'
      | 'formOf'
      | 'lineEnding'
      | 'originalForms'
      | 'retainBlock'
      | 'source'
    >,
    private readonly context: Pick<
      DefinitionContext,
      'canonicalTree' | 'inContext' | 'parseLocally'
    >,
    private readonly movement: Pick<
      MoveOrigins,
      'carriedChildren' | 'carries' | 'current'
    >,
  ) {}

  localEdits(doc: ProseNode): string | undefined {
    if (
      this.loaded.baseline.childCount !== this.loaded.blocks.length ||
      doc.childCount !== this.loaded.blocks.length ||
      !doc.sameMarkup(this.loaded.baseline)
    )
      return undefined
    let output = '',
      previous = 0
    let run: number[] = []
    for (let index = 0; index <= doc.childCount; index++) {
      const node = index < doc.childCount ? doc.child(index) : undefined
      const before = node && this.loaded.baseline.child(index)
      // A block a move carried from another place is paired with its own
      // original, which only the whole-document path does.
      if (node && node !== before && this.movement.current?.has(node))
        return undefined
      if (
        !node ||
        node === before ||
        (node.eq(before!) && !this.movement.carries(node))
      ) {
        if (run.length > 1 && !this.pairedInPlace(doc, run)) return undefined
        run = []
        continue
      }
      run.push(index)
      const block = this.loaded.blocks[index]!
      let retained = this.blockEdits.get(node)
      if (retained?.index !== index) {
        const text = this.localBlock(index, node)
        if (text === undefined) return undefined
        retained = { index, text }
        this.blockEdits.set(node, retained)
      }
      output += this.loaded.source.slice(previous, block.start) + retained.text
      previous = block.end
    }
    output += this.loaded.source.slice(previous)
    // Front matter is found by reading from the start of the file to the next
    // delimiter line, which an edited block can supply.
    return sourceFrontmatter(withoutLeadingBOM(output)) ===
      sourceFrontmatter(withoutLeadingBOM(this.loaded.source))
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
    const before = run.map((index) => this.loaded.blocks[index]!.form)
    const after = run.map((index) => this.loaded.formOf(doc.child(index)))
    const result: Array<number | undefined> = run.map((_, at) => at)
    pairSimilar(before, after, 0, run.length, 0, run.length, result, {
      similarity: SIMILARITY_BUDGET,
    })
    return result.every((position, at) => position === at)
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
    const block = this.loaded.blocks[index]!
    return (
      (index === 0 ||
        /\r?\n[ \t]*\r?\n/.test(
          this.loaded.source.slice(
            this.loaded.blocks[index - 1]!.end,
            block.start,
          ),
        )) &&
      (index + 1 === this.loaded.blocks.length ||
        /\r?\n[ \t]*\r?\n/.test(
          this.loaded.source.slice(
            block.end,
            this.loaded.blocks[index + 1]!.start,
          ),
        ))
    )
  }

  // Validates a changed block on its own when nothing outside it can change
  // what it means, so a keystroke does not serialize and reparse the document.
  private localBlock(index: number, node: ProseNode): string | undefined {
    const before = this.loaded.baseline.child(index)
    const block = this.loaded.blocks[index]!
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
      !/^ {0,3}(?:`{3,}|~{3,})/.test(
        this.loaded.source.slice(block.start, block.end),
      )
    )
      return undefined
    if (
      !code &&
      (!['paragraph', 'heading', 'table'].includes(node.type.name) ||
        !LocalEdits.plainInline(node) ||
        !LocalEdits.plainInline(before) ||
        !this.context.inContext(
          this.loaded.source.slice(block.start, block.end),
        ))
    )
      return undefined
    const form = this.loaded.formOf(node)
    if (form !== block.form && this.loaded.originalForms.has(form))
      return undefined
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
      : this.context.canonicalTree(form)
    if (!canonical) return undefined
    const text = this.loaded.retainBlock(
      block,
      canonical.node,
      canonical.canonical,
    )
    const reopened = code
      ? (() => {
          const parsed = parseDoc(this.ctx, text)
          return parsed.childCount === 1 ? parsed.firstChild! : undefined
        })()
      : this.context.parseLocally(text)
    // The authored fence is presentation the editor keeps from loading.
    const same = (node: ProseNode) =>
      code
        ? node.type === expected.type &&
          node.attrs.language === expected.attrs.language &&
          node.content.eq(expected.content)
        : withoutHeadingId(node).eq(expected)
    return reopened && same(reopened) ? text : undefined
  }

  // A list is one block, so typing in one item of a long list validates that
  // item alone, read as the only item of a list with the same marker.
  private localItems(index: number, node: ProseNode): string | undefined {
    const before = this.loaded.baseline.child(index)
    const block = this.loaded.blocks[index]!
    const list = block.ast
    const offset = leadingBOMLength(this.loaded.source)
    const source = this.loaded.source.slice(offset)
    if (
      list.type !== 'list' ||
      list.children?.length !== node.childCount ||
      before.childCount !== node.childCount
    )
      return undefined
    // Whole-document matching would read a list that now matches another one
    // as moved there.
    for (let other = 0; other < this.loaded.baseline.childCount; other++) {
      const candidate = this.loaded.baseline.child(other)
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
    const reorder = this.movement.current
      ? this.movement.carriedChildren(node, index)
      : undefined
    const carried = reorder?.get(parentKey(list))
    let output = ''
    let previous = block.start
    for (let at = 0; at < node.childCount; at++) {
      const item = node.child(at)
      const original = before.child(at)
      if (
        item === original ||
        (item.eq(original) && !this.movement.carries(item))
      )
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
        this.loaded.source.slice(
          previous,
          ast.position!.start.offset! + offset,
        ) + retained.text
      previous = ast.position!.end.offset! + offset
    }
    return output + this.loaded.source.slice(previous, block.end)
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
      !LocalEdits.plainInline(item) ||
      !this.context.inContext(source.slice(start, end))
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
    const reopened = this.context.parseLocally(indent + text)
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
      !LocalEdits.plainInline(item) ||
      !LocalEdits.plainInline(before) ||
      // The authored item is compared with the edit, so it must read the same
      // in this context too.
      !this.context.inContext(source.slice(start, end))
    )
      return undefined
    const local = this.context.canonicalTree(
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
      this.loaded.lineEnding,
      false,
      undefined,
      undefined,
      [],
      reorder,
    )
    if (marker) text = relabel(text, [0], marker)
    return this.readsAsItem(list, item, text, ast, source)
  }
}
