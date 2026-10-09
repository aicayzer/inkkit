import { $node, $remark } from '@milkdown/kit/utils'
import type { Root, RootContent, Literal, Nodes } from 'mdast'
import {
  commentSource,
  literalCommentSpans,
  type CommentSpan,
} from './comments'

interface InkKitLiteral extends Literal {
  type: 'inkkitLiteral'
  comments?: CommentSpan[]
}
declare module 'mdast' {
  interface BlockContentMap {
    inkkitLiteral: InkKitLiteral
  }
  interface RootContentMap {
    inkkitLiteral: InkKitLiteral
  }
}

const unsupported = new Set(['html', 'image', 'imageReference'])

export function sourceFrontmatter(source: string): string | undefined {
  return /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/.exec(source)?.[0]
}

function restoreInlineBreaks(node: Nodes): void {
  if (
    (node.type === 'paragraph' || node.type === 'heading') &&
    node.children.length > 1
  ) {
    node.children = node.children.map((child) =>
      child.type === 'html' &&
      ['<br />', '<br>', '<br >', '<br/>'].includes(child.value.trim())
        ? {
            type: 'break',
            data: { inkkitHTMLBreak: true },
            position: child.position,
          }
        : child,
    )
  }
  if ('children' in node) node.children.forEach(restoreInlineBreaks)
}
function containsUnsupported(
  node: Nodes,
  images: boolean,
  inline = false,
): boolean {
  // Only a standalone break represents a spacer; inline HTML must remain literal.
  if (
    !inline &&
    node.type === 'html' &&
    ['<br />', '<br>', '<br >', '<br/>'].includes(node.value.trim())
  )
    return false
  if (node.type === 'paragraph' && node.children.length === 1) {
    const child = node.children[0]
    if (
      child?.type === 'html' &&
      ['<br />', '<br>', '<br >', '<br/>'].includes(child.value.trim())
    )
      return false
  }
  return (
    (unsupported.has(node.type) && !(images && node.type === 'image')) ||
    ('children' in node &&
      node.children.some((child) =>
        containsUnsupported(
          child,
          images,
          inline || node.type === 'paragraph' || node.type === 'heading',
        ),
      ))
  )
}

function containsUnresolved(node: Nodes, source: string): boolean {
  if (node.type === 'text') {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start == null || end == null) return false
    const raw = source.slice(start, end)
    return /(?<!\\)\[\^[^\]\n]+\]|(?<!\\)\[[^\]\n]+\](?:\[[^\]\n]*\])?/.test(
      raw,
    )
  }
  return (
    'children' in node &&
    node.children.some((child) => containsUnresolved(child, source))
  )
}

// Keep syntax we cannot faithfully edit as literal text, without making the rest
// of the document a source editor or allowing HTML and image network requests.
export function createLiteralPreservation(images: boolean) {
  return $remark(
    'preserveLiterals',
    () => () => (tree: Root, file: { value: unknown }) => {
      restoreInlineBreaks(tree)
      // Micromark's positions exclude an initial byte-order mark.
      const source = String(file.value).replace(/^\uFEFF/, '')
      const frontmatter = sourceFrontmatter(source)
      const frontmatterEnd = frontmatter?.length ?? 0
      const preserveBlock = <T extends RootContent>(
        node: T,
        depth = 0,
      ): T | InkKitLiteral => {
        if (node.type === 'footnoteDefinition') {
          node.children = node.children.map((child) =>
            preserveBlock(child, depth + 1),
          )
          return node
        }
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (
          start == null ||
          end == null ||
          (!containsUnsupported(node, images) &&
            !containsUnresolved(node, source))
        )
          return node
        let raw = source.slice(start, end)
        // Definition indentation is restored by the footnote serializer.
        for (let index = 0; index < depth; index++)
          raw = raw.replace(/\r?\n(?: {4}|\t)/g, '\n')
        return {
          type: 'inkkitLiteral',
          value: raw,
          comments: literalCommentSpans(raw),
          position: node.position,
        }
      }
      const blocks: RootContent[] = []
      if (frontmatter)
        blocks.push({
          type: 'inkkitLiteral',
          value: frontmatter.trimEnd(),
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: {
              line: 1,
              column: 1,
              offset: frontmatter.trimEnd().length,
            },
          },
        })
      for (const node of tree.children) {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start == null || end == null) {
          blocks.push(node)
          continue
        }
        if (start < frontmatterEnd) {
          // TOML delimiters are ordinary paragraph text to CommonMark, so a
          // paragraph may also contain body text immediately after the header.
          if (end > frontmatterEnd)
            blocks.push({
              type: 'inkkitLiteral',
              value: source.slice(frontmatterEnd, end),
              position: {
                start: { line: 1, column: 1, offset: frontmatterEnd },
                end: node.position!.end,
              },
            })
          continue
        }
        if (node.type === 'inkkitLiteral')
          node.comments = literalCommentSpans(node.value)
        blocks.push(preserveBlock(node))
      }
      tree.children = blocks
    },
  )
}

export const preserveLiterals = createLiteralPreservation(false)

export const literalBlock = $node('literal_markdown', () => ({
  group: 'block',
  content: '(text | comment_inline)*',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [
    { tag: 'pre.literal-markdown', preserveWhitespace: 'full', priority: 100 },
  ],
  toDOM: () => [
    'pre',
    { class: 'literal-markdown', 'aria-label': 'Preserved Markdown' },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'inkkitLiteral',
    runner: (state, node, type) => {
      state.openNode(type)
      const value = String(node.value ?? '')
      let cursor = 0
      for (const span of (node.comments as CommentSpan[] | undefined) ?? []) {
        if (span.start > cursor) state.addText(value.slice(cursor, span.start))
        state.openNode(state.schema.nodes.comment_inline!, {
          syntax: span.syntax,
          block: Boolean(span.block),
        })
        if (span.value) state.addText(span.value)
        state.closeNode()
        cursor = span.end
      }
      if (cursor < value.length) state.addText(value.slice(cursor))
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'literal_markdown',
    runner: (state, node) => {
      let source = ''
      node.forEach((child) => {
        source += child.isText ? child.text : commentSource(child)
      })
      state.addNode('html', undefined, source)
    },
  },
}))
