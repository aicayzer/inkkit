import type { ResolvedPos } from '@milkdown/kit/prose/model'

// Source newlines end ATX headings and table rows and can promote inline
// HTML comments to blocks. Use HTML breaks where a newline changes structure.
export function htmlBreakAt(position: ResolvedPos): boolean {
  return (
    (position.parent.type.name === 'heading' &&
      position.parent.attrs.form !== 'setext') ||
    (position.nodeAfter?.type.name === 'comment_inline' &&
      position.nodeAfter.attrs.syntax === 'html') ||
    (position.depth > 1 &&
      /^table_(cell|header)$/.test(position.node(-1).type.name))
  )
}
