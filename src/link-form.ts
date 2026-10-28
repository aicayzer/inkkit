import { withoutLeadingBOM } from './bom'
import type { Link, Nodes, Root } from 'mdast'

/**
 * How a link was written: `literal` for a bare URL, `www.` address or email
 * address, `angle` for one in angle brackets, and `null` for link syntax,
 * including references. Editing keeps each form.
 */
export type LinkForm = 'literal' | 'angle' | null

interface Located {
  position?: { start: { offset?: number } }
}

export function linkForm(node: Located, source: string): LinkForm {
  const start = node.position?.start.offset
  // GFM finds addresses after punctuation in a later pass that gives them no
  // position; nothing else makes a link without one.
  if (start == null) return 'literal'
  const first = source[start]
  return first === '<' ? 'angle' : first === '[' ? null : 'literal'
}

/** Whether a link's destination is its own text, as GFM reads an address. */
export function followsText(text: string, href: string): boolean {
  return (
    href === text ||
    (href === `http://${text}` && /^www\./i.test(text)) ||
    href === `mailto:${text}`
  )
}

/** Records each link's form in its data, for the link mark to keep. */
export function remarkLinkForms() {
  return (tree: Root, file: { value?: unknown }) => {
    // Positions count from after a byte order mark.
    const source = withoutLeadingBOM(String(file.value ?? ''))
    const visit = (node: Nodes) => {
      if (node.type === 'link')
        (node as Link).data = {
          ...node.data,
          inkkitLinkForm: linkForm(node, source),
        } as Link['data']
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}
