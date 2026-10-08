import { $node, $remark } from '@milkdown/kit/utils'
import type { Root, RootContent, Literal, Nodes } from 'mdast'

interface InkKitLiteral extends Literal {
  type: 'inkkitLiteral'
}
declare module 'mdast' {
  interface RootContentMap {
    inkkitLiteral: InkKitLiteral
  }
}

const unsupported = new Set([
  'html',
  'image',
  'imageReference',
  'definition',
  'linkReference',
])

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

// Keep syntax we cannot faithfully edit as literal text, without making the rest
// of the document a source editor or allowing HTML and image network requests.
export function createLiteralPreservation(images: boolean) {
  return $remark(
    'preserveLiterals',
    () => () => (tree: Root, file: { value: unknown }) => {
      restoreInlineBreaks(tree)
      // Micromark's positions exclude an initial byte-order mark.
      const source = String(file.value).replace(/^\uFEFF/, '')
      const frontmatter = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/.exec(
        source,
      )
      const frontmatterEnd = frontmatter?.[0].length ?? 0
      const blocks: RootContent[] = []
      if (frontmatter)
        blocks.push({
          type: 'inkkitLiteral',
          value: frontmatter[0].trimEnd(),
          position: {
            start: { line: 1, column: 1, offset: 0 },
            end: {
              line: 1,
              column: 1,
              offset: frontmatter[0].trimEnd().length,
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
        const raw = source.slice(start, end)
        const footnote = node.type !== 'code' && /\[\^[^\]]+\]/.test(raw)
        if (containsUnsupported(node, images) || footnote)
          blocks.push({
            type: 'inkkitLiteral',
            value: raw,
            position: node.position,
          })
        else blocks.push(node)
      }
      tree.children = blocks
    },
  )
}

export const preserveLiterals = createLiteralPreservation(false)

export const literalBlock = $node('literal_markdown', () => ({
  group: 'block',
  content: 'text*',
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
      state.addText(String(node.value ?? ''))
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'literal_markdown',
    runner: (state, node) => {
      state.addNode('html', undefined, node.textContent)
    },
  },
}))
