import { withoutLeadingBOM } from './bom'
import {
  ParserReady,
  parserCtx,
  remarkCtx,
  schemaCtx,
} from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type {
  Attrs,
  Node as ProseNode,
  NodeType,
  Schema,
} from '@milkdown/kit/prose/model'
import {
  ParserState,
  type MarkdownNode,
  type RemarkParser,
} from '@milkdown/kit/transformer'
import type { Root, RootContent } from 'mdast'
import { literalCommentSpans } from './comments'
import { InkKitError } from './types'

/**
 * Milkdown's parser state, except that it throws where Milkdown would drop content. Milkdown
 * catches the failure to build a node (`createNodeInParserFail`), logs it and carries on without
 * the node and everything inside it, so the document it returns can silently lack part of its
 * source.
 */
class CheckedParserState extends ParserState {
  constructor(schema: Schema) {
    super(schema)
    const closeNode = this.closeNode
    const addNode = this.addNode
    // Marks never stop a node being built, so building it without them is the same test.
    const unbuildable = (
      type: NodeType,
      attrs?: Attrs,
      content?: ProseNode[],
    ): boolean => {
      try {
        return !type.createAndFill(attrs, content)
      } catch {
        return true
      }
    }
    this.closeNode = () => {
      const element = this.top()
      if (
        !element ||
        this.size() < 2 ||
        unbuildable(element.type, element.attrs, element.content)
      )
        throw new Error(`Cannot build ${element?.type.name ?? 'a node'}`)
      return closeNode()
    }
    this.addNode = (type, attrs, content) => {
      if (!this.top() || unbuildable(type, attrs, content))
        throw new Error(`Cannot build ${type.name}`)
      return addNode(type, attrs, content)
    }
  }
}

/** The document, or undefined when Milkdown cannot build all of it. */
function build(schema: Schema, tree: MarkdownNode): ProseNode | undefined {
  // A fresh state each time: one that throws part way keeps its open nodes.
  try {
    return new CheckedParserState(schema).next(tree).toDoc()
  } catch {
    // Also an unmatched node type (`parserMatchError`) or a document that cannot be built.
    return undefined
  }
}

/**
 * Parses Markdown as Milkdown does, but never returns a document that lacks part of its source.
 * A top-level block that cannot be built is kept as its literal source, as unsupported syntax is,
 * so the rest of the document stays editable; when that is not enough, it throws `preservation`.
 */
export function parseMarkdown(
  schema: Schema,
  remark: RemarkParser,
  markdown: string,
  // Preservation already ran the dialect transforms. Reuse that work without
  // bypassing the checked builder and literal fallback below.
  parsedTree?: Root,
): ProseNode {
  const tree =
    parsedTree ?? (remark.runSync(remark.parse(markdown), markdown) as Root)
  const doc = build(schema, tree as unknown as MarkdownNode)
  if (doc) return doc
  // Micromark's positions exclude an initial byte-order mark.
  const source = withoutLeadingBOM(markdown)
  tree.children = tree.children.map((node): RootContent => {
    const alone = { type: 'root', children: [node] }
    if (build(schema, alone as unknown as MarkdownNode)) return node
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start == null || end == null) return node
    const value = source.slice(start, end)
    return {
      type: 'inkkitLiteral',
      value,
      comments: literalCommentSpans(value),
      position: node.position,
    }
  })
  const kept = build(schema, tree as unknown as MarkdownNode)
  if (kept) return kept
  throw new InkKitError(
    'preservation',
    'The Markdown cannot be shown without losing part of it',
  )
}

/** Replaces Milkdown's parser with `parseMarkdown`, for every caller of `parserCtx`. */
export const checkedParser: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(ParserReady)
  const schema = ctx.get(schemaCtx)
  ctx.set(parserCtx, (markdown) =>
    parseMarkdown(schema, ctx.get(remarkCtx), markdown),
  )
}
