import { parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { clipboardText } from './clipboard'
import { revealCalloutAncestors } from './callouts'
import { InkKitError } from './types'

export interface Heading {
  readonly id: string
  readonly level: number
  readonly text: string
  readonly documentId: string
  readonly generation: number
  readonly revision: number
}
export interface OutlineContext {
  documentId: string
  generation: number
  revision: number
  epoch: number
  mode: 'source' | 'formatted'
}
interface LocatedHeading {
  node: ProseNode
  position: number
}
interface SourceNode {
  type: string
  depth?: number
  position?: { start: { offset?: number } }
  children?: SourceNode[]
}
function formattedLocations(doc: ProseNode): LocatedHeading[] {
  const headings: LocatedHeading[] = []
  doc.descendants((node, position) => {
    if (node.type.name === 'heading') headings.push({ node, position })
  })
  return headings
}
function sourceLocations(ctx: Ctx, source: string): LocatedHeading[] {
  const processor = ctx.get(remarkCtx)
  const tree = processor.runSync(processor.parse(source), {
    value: source,
  }) as unknown as SourceNode
  const positions: { position: number; level: number }[] = []
  const bom = source.startsWith('\uFEFF') ? 1 : 0
  const visit = (node: SourceNode) => {
    if (node.type === 'heading' && node.position?.start.offset != null)
      positions.push({
        position: node.position.start.offset + bom,
        level: node.depth!,
      })
    node.children?.forEach(visit)
  }
  visit(tree)
  const parsed = formattedLocations(ctx.get(parserCtx)(source))
  if (
    positions.length !== parsed.length ||
    positions.some(
      (item, index) => item.level !== parsed[index]!.node.attrs.level,
    )
  )
    throw new InkKitError(
      'preservation',
      'The current Markdown headings cannot be located safely',
    )
  return parsed.map((heading, index) => ({
    ...heading,
    position: positions[index]!.position,
  }))
}
function entry(heading: LocatedHeading, context: OutlineContext): Heading {
  return Object.freeze({
    id: `heading:${context.epoch}:${context.mode}:${context.generation}:${context.revision}:${heading.position}`,
    level: Number(heading.node.attrs.level),
    text: clipboardText(heading.node.content),
    documentId: context.documentId,
    generation: context.generation,
    revision: context.revision,
  })
}
export function collectFormattedHeadings(
  doc: ProseNode,
  context: OutlineContext,
): readonly Heading[] {
  return Object.freeze(
    formattedLocations(doc).map((item) => entry(item, context)),
  )
}
export function collectSourceHeadings(
  ctx: Ctx,
  source: string,
  context: OutlineContext,
): readonly Heading[] {
  return Object.freeze(
    sourceLocations(ctx, source).map((item) => entry(item, context)),
  )
}
function currentLocation(
  locations: LocatedHeading[],
  requested: Heading,
  context: OutlineContext,
): number {
  for (const location of locations) {
    const current = entry(location, context)
    if (
      current.id === requested.id &&
      current.documentId === requested.documentId &&
      current.generation === requested.generation &&
      current.revision === requested.revision &&
      current.level === requested.level &&
      current.text === requested.text
    )
      return location.position
  }
  throw new InkKitError('stale-document', 'The heading is no longer current')
}
export function sourceHeadingPosition(
  ctx: Ctx,
  source: string,
  requested: Heading,
  context: OutlineContext,
): number {
  return currentLocation(sourceLocations(ctx, source), requested, context)
}
export function navigateFormattedHeading(
  view: EditorView,
  requested: Heading,
  context: OutlineContext,
): boolean {
  const position = currentLocation(
    formattedLocations(view.state.doc),
    requested,
    context,
  )
  revealCalloutAncestors(view, position + 1)
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, position + 1))
      .scrollIntoView(),
  )
  view.focus()
  return true
}
