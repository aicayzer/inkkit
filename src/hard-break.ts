import type { ResolvedPos } from '@milkdown/kit/prose/model'

// Source newlines end ATX headings and table rows. Other textblocks can
// hold ordinary Markdown breaks, including a pending break at their end.
export function htmlBreakAt(position: ResolvedPos): boolean {
  return (
    (position.parent.type.name === 'heading' &&
      position.parent.attrs.form !== 'setext') ||
    (position.depth > 1 &&
      /^table_(cell|header)$/.test(position.node(-1).type.name))
  )
}
