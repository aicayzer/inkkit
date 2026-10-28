import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { leadingBOMLength } from './bom'
import type { Block, SourceNode } from './preserve-types'
import type { DefinitionContext } from './preserve-context'
import { write } from './preserve-parse'
import { form, withEnding } from './preserve-shape'
import { authoredMarker, canonicalSlice, childGutters } from './preserve-list'
import { retainSource } from './preserve-retain'
import { retainParts } from './preserve-containers'

interface ItemRun {
  before: number
  beforeEnd: number
  after: number
  afterEnd: number
}

interface SimpleList {
  origins: WeakMap<ProseNode, number>
  text: Map<string, number>
}

// Structural edits use the whole writer's item matching, over only the run
// they change. Simple uniquely named items can also delimit independent runs.
export class ItemRegions {
  private readonly simple = new WeakMap<ProseNode, SimpleList | null>()
  private readonly unique = new WeakMap<ProseNode, boolean>()

  constructor(
    private readonly ctx: Ctx,
    private readonly context: Pick<
      DefinitionContext,
      'canonicalTree' | 'inContext' | 'readsAs'
    >,
    private readonly lineEnding: string,
  ) {}

  write(
    before: ProseNode,
    node: ProseNode,
    block: Block,
    loadedSource: string,
  ): string | undefined {
    const list = block.ast
    if (list.ordered || !node.childCount) return undefined
    const structural = before.childCount !== node.childCount
    // A whole structural write matches items by their first paragraph, even
    // beyond an equal-looking boundary. Repeated openings can choose another
    // spelling, so a slice cannot decide which source the whole list takes.
    if (structural && !this.uniqueOpenings(before)) return undefined
    const offset = leadingBOMLength(loadedSource)
    const source = loadedSource.slice(offset)
    const runs =
      this.independentRuns(before, node, list, source) ??
      this.singleRun(before, node)
    if (!runs?.length) return undefined
    let text = ''
    let previous = block.start - offset
    for (const run of runs) {
      const patch = this.run(before, node, list, source, run, structural)
      if (!patch) return undefined
      text += source.slice(previous, patch.from) + patch.text
      previous = patch.to
    }
    return text + source.slice(previous, block.end - offset)
  }

  private uniqueOpenings(before: ProseNode): boolean {
    const cached = this.unique.get(before)
    if (cached !== undefined) return cached
    const openings = new Set<string>()
    let unique = true
    before.forEach((item) => {
      const opening = item.firstChild?.textContent ?? ''
      if (openings.has(opening)) unique = false
      openings.add(opening)
    })
    this.unique.set(before, unique)
    return unique
  }

  private singleRun(before: ProseNode, node: ProseNode): ItemRun[] | undefined {
    let prefix = 0,
      suffix = 0
    while (
      prefix < before.childCount &&
      prefix < node.childCount &&
      before.child(prefix).eq(node.child(prefix))
    )
      prefix++
    while (
      suffix < before.childCount - prefix &&
      suffix < node.childCount - prefix &&
      before
        .child(before.childCount - suffix - 1)
        .eq(node.child(node.childCount - suffix - 1))
    )
      suffix++
    return prefix || suffix
      ? [
          {
            before: prefix,
            beforeEnd: before.childCount - suffix,
            after: prefix,
            afterEnd: node.childCount - suffix,
          },
        ]
      : undefined
  }

  private independentRuns(
    before: ProseNode,
    node: ProseNode,
    list: SourceNode,
    source: string,
  ): ItemRun[] | undefined {
    let simple = this.simple.get(before)
    if (simple === undefined) {
      simple = this.simpleList(before, list, source)
      this.simple.set(before, simple)
    }
    if (!simple) return undefined
    const anchors: Array<{ before: number; after: number }> = []
    let last = -1
    for (let at = 0; at < node.childCount; at++) {
      const original = simple.origins.get(node.child(at))
      if (original === undefined) continue
      if (before.childCount === node.childCount && original !== at)
        return undefined
      if (original <= last) return undefined
      anchors.push({ before: original, after: at })
      last = original
    }
    if (!anchors.length) return undefined
    anchors.push({ before: before.childCount, after: node.childCount })
    const runs: ItemRun[] = []
    let previous = { before: -1, after: -1 }
    for (const anchor of anchors) {
      if (
        anchor.before > previous.before + 1 ||
        anchor.after > previous.after + 1
      ) {
        const run = {
          before: previous.before + 1,
          beforeEnd: anchor.before,
          after: previous.after + 1,
          afterEnd: anchor.after,
        }
        for (let at = run.after; at < run.afterEnd; at++) {
          const item = node.child(at)
          if (before.childCount === node.childCount) continue
          if (!this.simpleItem(item)) return undefined
          const original = simple.text.get(item.textContent)
          // Whole-list matching could take this item's source from another
          // run; those ambiguous cases keep the single-run path.
          if (
            original !== undefined &&
            (original < run.before || original >= run.beforeEnd)
          )
            return undefined
        }
        // Runs sharing a boundary item must be checked as one slice.
        const prior = runs.at(-1)
        if (prior && prior.beforeEnd + 1 >= run.before) {
          prior.beforeEnd = run.beforeEnd
          prior.afterEnd = run.afterEnd
        } else runs.push(run)
      }
      previous = anchor
    }
    return runs
  }

  private simpleItem(item: ProseNode): boolean {
    const paragraph = item.firstChild
    if (item.childCount !== 1 || paragraph?.type.name !== 'paragraph')
      return false
    let simple = true
    paragraph.forEach((child) => {
      simple &&= child.isText || child.type.name === 'hardbreak'
    })
    return simple
  }

  private simpleList(
    before: ProseNode,
    list: SourceNode,
    source: string,
  ): SimpleList | null {
    const origins = new WeakMap<ProseNode, number>()
    const text = new Map<string, number>()
    const children = list.children!
    const first = children[0]!.position!.start.offset!
    const indent = source.slice(source.lastIndexOf('\n', first - 1) + 1, first)
    if (!/^[ \t]*$/.test(indent)) return null
    for (let at = 0; at < before.childCount; at++) {
      const item = before.child(at)
      if (!this.simpleItem(item) || text.has(item.textContent)) return null
      origins.set(item, at)
      text.set(item.textContent, at)
      if (at) {
        const start = children[at]!.position!.start.offset!
        const ownIndent = source.slice(
          source.lastIndexOf('\n', start - 1) + 1,
          start,
        )
        const gap = source.slice(children[at - 1]!.position!.end.offset!, start)
        // The whole structural writer uses canonical gaps throughout its
        // middle span. Keeping untouched gaps is equivalent only here.
        if (
          ownIndent !== indent ||
          gap !== this.lineEnding.repeat(list.spread ? 2 : 1) + indent
        )
          return null
      }
    }
    return { origins, text }
  }

  private run(
    before: ProseNode,
    node: ProseNode,
    list: SourceNode,
    source: string,
    run: ItemRun,
    structural: boolean,
  ): { from: number; to: number; text: string } | undefined {
    for (let at = run.after; at < run.afterEnd; at++) {
      const item = node.child(at)
      // Removing an item's introduction can change the content column of its
      // following blocks. Keep that existing whole-document safety boundary.
      if (item.childCount > 1 && item.firstChild?.content.size === 0)
        return undefined
    }
    const prefix = run.before > 0 ? 1 : 0
    const suffix = run.beforeEnd < before.childCount ? 1 : 0
    const children = list.children!.slice(
      run.before - prefix,
      run.beforeEnd + suffix,
    )
    const from = children[0]?.position?.start.offset
    const to = children.at(-1)?.position?.end.offset
    if (from == null || to == null) return undefined
    const indent = source.slice(source.lastIndexOf('\n', from - 1) + 1, from)
    if (!/^[ \t]*$/.test(indent)) return undefined
    const items: ProseNode[] = []
    for (let at = run.after - prefix; at < run.afterEnd + suffix; at++)
      items.push(node.child(at))
    const part = node.type.create(node.attrs, items)
    const local = this.context.canonicalTree(
      form(write(this.ctx, node.type.schema.topNodeType.create(null, [part]))),
      true,
    )
    if (
      !local ||
      local.node.type !== 'list' ||
      local.node.spread !== list.spread ||
      !this.context.inContext(source.slice(from, to), true)
    )
      return undefined
    const original: SourceNode = {
      ...list,
      children,
      position: { start: { offset: from }, end: { offset: to } },
    }
    if (!structural) {
      const text = retainSource(
        original,
        local.node,
        source,
        local.canonical,
        this.lineEnding,
      )
      return this.context.readsAs(indent + text, [part], true)
        ? { from, to, text }
        : undefined
    }
    const incoming = local.node.children!
    const start = prefix ? children[0]!.position!.end.offset! : from
    const end = suffix ? children.at(-1)!.position!.start.offset! : to
    const newStart = prefix
      ? incoming[0]!.position!.end.offset!
      : local.node.position!.start.offset!
    const newEnd = suffix
      ? incoming.at(-1)!.position!.start.offset!
      : local.node.position!.end.offset!
    const changed = incoming.slice(prefix, incoming.length - suffix)
    const marker = authoredMarker(list, source)
    const gutters = childGutters(
      list,
      local.node,
      source,
      local.canonical,
      !prefix,
    )
    const middle = withEnding(
      retainParts(
        retainSource,
        marker,
        children.slice(prefix, children.length - suffix),
        changed,
        source,
        local.canonical,
        newStart,
        newEnd,
        this.lineEnding,
        undefined,
        undefined,
        gutters,
        !!suffix,
      ) ??
        canonicalSlice(
          marker,
          changed,
          local.canonical,
          newStart,
          newEnd,
          undefined,
          undefined,
          gutters,
          !!suffix,
        ),
      this.lineEnding,
    )
    const text = source.slice(from, start) + middle + source.slice(end, to)
    return this.context.readsAs(indent + text, [part], true)
      ? { from, to, text }
      : undefined
  }
}
