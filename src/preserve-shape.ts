import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { lineBreakHTML } from './literals'
import { htmlMarkTypes } from './inline-html-marks'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
import { type SourceNode } from './preserve-types'

// Whether `signature` tells how a link was written, `https://x.com` from
// `<https://x.com>`. It does not by default: the canonical writer spells a bare
// address in angle brackets beside text that could run into it, and a source
// that reads the same keeps its own spelling. `retainingForms` turns it on for
// a block whose links changed form.
let linkFormsMatter = false

export function withLinkForms<T>(run: () => T): T {
  const before = linkFormsMatter
  linkFormsMatter = true
  try {
    return run()
  } finally {
    linkFormsMatter = before
  }
}

// Line endings are the document's, not the node's: a CRLF source and its LF
// canonical form describe the same text.
export function signature(node: SourceNode): string {
  return JSON.stringify(ordered(node), function (key, value) {
    const holder = this as SourceNode
    if (key === 'data' && holder.type === 'link' && linkFormsMatter)
      return {
        inkkitLinkForm: (value as { inkkitLinkForm?: unknown } | undefined)
          ?.inkkitLinkForm,
      }
    if (['position', 'data', 'marker'].includes(key)) return undefined
    // Every spelling of a line break reads back as the same break.
    if (key === 'value' && holder.type === 'html' && lineBreakHTML(value))
      return '<br />'
    // A row read as ending in empty cells is the row written without them.
    if (key === 'children' && holder.type === 'tableRow') {
      let end = (value as SourceNode[]).length
      while (end > 0 && !(value as SourceNode[])[end - 1]!.children?.length)
        end--
      return (value as SourceNode[]).slice(0, end)
    }
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value
  })
}

export const formatting = new Set([
  'emphasis',
  'strong',
  'delete',
  'highlight',
  ...htmlMarkTypes,
])

const linkTypes = new Set(['link', 'linkReference'])

// Formatting around a whole link and a link around whole formatting read the
// same, so both are compared with the formatting outside.
function ordered(node: SourceNode): SourceNode {
  let current = node
  const inner = current.children?.[0]
  if (
    linkTypes.has(current.type) &&
    current.children!.length === 1 &&
    formatting.has(inner!.type)
  )
    current = {
      ...inner!,
      children: [{ ...current, children: inner!.children }],
    }
  return current.children
    ? { ...current, children: current.children.map(ordered) }
    : current
}

// A link and the formatting that each wrap the one node inside, outermost
// first, down to the first node that wraps more than one.
function wrappers(node: SourceNode): SourceNode[] {
  const chain: SourceNode[] = []
  for (
    let at: SourceNode | undefined = node;
    at && (linkTypes.has(at.type) || formatting.has(at.type));
    at = at.children?.length === 1 ? at.children[0] : undefined
  )
    chain.push(at)
  return chain
}

// The writer puts a link outside the formatting that covers the same text,
// which reads the same as formatting outside the link. An edited node written
// the other way round is nested as authored, so its source keeps the
// delimiters where they were. Each level then has one child on both sides
// and keeps its source around that child.
export function authoredNesting(
  before: SourceNode,
  after: SourceNode,
): SourceNode {
  if (before.type === after.type || !formatting.has(before.type)) return after
  const authored = wrappers(before)
  const written = wrappers(after)
  const types = (chain: SourceNode[]) =>
    chain
      .map((node) => node.type)
      .sort()
      .join()
  const linksIn = (chain: SourceNode[]) =>
    chain.filter((node) => linkTypes.has(node.type))
  const shape = (node: SourceNode) => ownShape({ ...node, children: [] })
  const [authoredLink] = linksIn(authored)
  const [writtenLink] = linksIn(written)
  if (
    linksIn(authored).length !== 1 ||
    linksIn(written).length !== 1 ||
    types(authored) !== types(written) ||
    shape(authoredLink!) !== shape(writtenLink!) ||
    authored.at(-1)!.children?.length !== written.at(-1)!.children?.length
  )
    return after
  const inner = written.at(-1)!.children!
  const byType = new Map(written.map((node) => [node.type, node]))
  return authored.reduceRight<SourceNode | undefined>(
    (child, node, level) => ({
      ...byType.get(node.type)!,
      // The outermost takes the whole written range.
      ...(level === 0 && { position: after.position }),
      children: child ? [child] : inner,
    }),
    undefined,
  )!
}

export function ownShape(node: SourceNode, spreadless = false): string {
  return JSON.stringify(ordered(node), (key, value) =>
    ['position', 'data', 'children', 'value', 'marker'].includes(key) ||
    (spreadless && key === 'spread')
      ? undefined
      : value,
  )
}

// A list or item that holds a literal block, which is written as HTML, is
// separated by blank lines as the canonical writer decides: it writes one
// where HTML could not follow a paragraph without it, even before a quote.
// That says nothing of how the list was spelled, so the blank lines the
// author wrote or left out stay.
const holdsLiteralBlock = (node: SourceNode): boolean =>
  (node.type === 'listItem' || node.type === 'list') &&
  !!node.children?.some(
    (child) =>
      child.type === 'inkkitLiteral' ||
      literals.has(child) ||
      holdsLiteralBlock(child),
  )

// Whether two nodes are the same kind of node with the same own properties.
export const sameShape = (before: SourceNode, after: SourceNode): boolean =>
  ownShape(before) === ownShape(after) ||
  ((holdsLiteralBlock(before) || holdsLiteralBlock(after)) &&
    ownShape(before, true) === ownShape(after, true))

// The shape two nodes must share to be the same child of a list or quote. A
// task ticked since is still the same item.
export const matchShape = (node: SourceNode): string =>
  ownShape({ ...node, checked: undefined })

// Nodes whose children are inline content.
export const inlineParents = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'emphasis',
  'strong',
  'delete',
  'highlight',
  ...htmlMarkTypes,
  'link',
])

// HTML stops an address at its `<`, and a line break at the end of the line.
export const inlineText = (node: SourceNode): string =>
  node.type === 'html'
    ? '<'
    : node.type === 'break'
      ? '\n'
      : (node.value ?? '') + (node.children?.map(inlineText).join('') ?? '')

// A `<br />` line, read as an HTML block or as a paragraph holding only it.
export function spacer(node: SourceNode | undefined): boolean {
  const html = node?.type === 'paragraph' ? node.children?.[0] : node
  return (
    (node?.type !== 'paragraph' || node.children?.length === 1) &&
    html?.type === 'html' &&
    lineBreakHTML(String(html.value))
  )
}

// Whether a source node is or holds a link or footnote definition.
export function definesSource(node: SourceNode): boolean {
  return (
    node.type === 'definition' ||
    node.type === 'footnoteDefinition' ||
    (node.children ?? []).some(definesSource)
  )
}

// Whether two nodes have the same blocks, leaving inline content aside.
export function sameBlocks(left: ProseNode, right: ProseNode): boolean {
  if (left.type !== right.type || left.isTextblock !== right.isTextblock)
    return false
  if (left.isTextblock) return true
  if (left.childCount !== right.childCount) return false
  for (let index = 0; index < left.childCount; index++)
    if (!sameBlocks(left.child(index), right.child(index))) return false
  return true
}

export const sourceRange = (node: SourceNode) =>
  `${node.position?.start.offset}:${node.position?.end.offset}`

export function positionalNode(
  tree: Root,
  transformed: SourceNode,
): SourceNode {
  return (
    (tree.children.find(
      (node) =>
        node.position?.start.offset === transformed.position?.start.offset &&
        node.position?.end.offset === transformed.position?.end.offset,
    ) as unknown as SourceNode | undefined) ?? transformed
  )
}

// How a reference label is matched to a definition. Footnote labels, which
// start with `^`, are a separate set.
export function definitionLabel(label: string): string {
  return label.startsWith('^')
    ? '^' + normalizeIdentifier(label.slice(1))
    : normalizeIdentifier(label)
}

// Milkdown derives heading DOM IDs; Markdown stores the level and content.
export function withoutHeadingId(node: ProseNode): ProseNode {
  return node.type.name === 'heading' && node.attrs.id
    ? node.type.create({ ...node.attrs, id: '' }, node.content, node.marks)
    : node
}

export function semanticSignature(doc: ProseNode): string {
  const clean = (value: Record<string, unknown>): Record<string, unknown> => {
    if (value.type === 'inkkit_wiki_link' && value.attrs) {
      const {
        raw: _raw,
        inTable: _inTable,
        ...attrs
      } = value.attrs as Record<string, unknown>
      value = { ...value, attrs }
    }
    // Whether a block comment sits on one line or three is its spelling.
    if (value.type === 'comment_block' && value.attrs) {
      const { block: _block, ...attrs } = value.attrs as Record<string, unknown>
      value = { ...value, attrs }
    }
    const content = value.content as Record<string, unknown>[] | undefined
    if (!content) return value
    const tokens: Record<string, unknown>[] = []
    for (const [index, child] of content.entries()) {
      const attrs = child.attrs as Record<string, unknown> | undefined
      const next = content[index + 1]
      // A hard break before an inline HTML comment must use the HTML spelling.
      if (
        child.type === 'hardbreak' &&
        attrs?.isInline === false &&
        next?.type === 'comment_inline' &&
        (next.attrs as Record<string, unknown> | undefined)?.syntax === 'html'
      )
        child.attrs = { ...attrs, isHTML: true }
      if (child.type !== 'text') {
        tokens.push(clean(child))
        continue
      }
      const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(child.text))!
      for (const [index, text] of parts.slice(1).entries()) {
        if (!text) continue
        const token = {
          ...child,
          text: text.replace(/\r\n?/g, '\n'),
          marks: index === 1 ? child.marks : undefined,
        }
        const previous = tokens.at(-1)
        if (
          previous?.type === 'text' &&
          JSON.stringify(previous.marks) === JSON.stringify(token.marks)
        )
          previous.text = String(previous.text) + text
        else tokens.push(token)
      }
    }
    return { ...value, content: tokens }
  }
  const json = JSON.parse(
    JSON.stringify(doc.toJSON(), (key, value) =>
      // Fresh list items default to loose even when their Markdown reopens tight.
      [
        'referenceContent',
        'referenceType',
        'marker',
        'id',
        'label',
        'spread',
        'authoredFence',
        'form',
        'inkkitFileRaw',
        'inkkitFileSource',
        'inkkitFileWidth',
        'inkkitFileInTable',
      ].includes(key)
        ? undefined
        : value,
    ),
  ) as Record<string, unknown>
  return JSON.stringify(clean(json))
}

export const lf = (text: string) => text.replace(/\r\n?/g, '\n')

// Canonical Markdown keeps authored CRLF inside literal blocks and code fences.
export function withEnding(text: string, lineEnding: string): string {
  return lineEnding === '\n' ? text : text.replace(/\r?\n/g, lineEnding)
}

export function form(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
}

// Ordered lists already given their new start, which are not renumbered again.
export const numbered = new WeakSet<SourceNode>()

// Canonical source nodes that read back as literal Markdown. The editor holds
// a literal block's source as its text, so an edit to it is written as it is;
// retaining it as Markdown would escape what was typed.
export const literals = new WeakSet<SourceNode>()

// The canonical Markdown of each loaded block the editor holds as literal
// Markdown, by its source node. It differs from the source where the editor
// does not keep authored spelling, such as quote markers inside a comment or
// the indentation of a block inside another.
export const literalForms = new WeakMap<SourceNode, string>()
