import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { markRun } from './editor-selection'
import { wikiReference } from './linked-syntax'
import type { WikiLinkReference } from './types'

/** Every drawn link: a Markdown link or a wiki link. */
export const linkSelector = 'a[href], .inkkit-wiki-link'

/** A link in the document: its place, and what it points to. */
export type LinkTarget = { from: number; to: number } & (
  { kind: 'web'; href: string } | { kind: 'wiki'; reference: WikiLinkReference }
)

/** The link that a drawn element belongs to, or undefined when the element is not a link of this
 *  editor. A Markdown link is the whole run of text that carries its mark, so a link split by
 *  formatting is still one link. */
export function linkTargetAt(
  view: EditorView,
  element: Element,
): LinkTarget | undefined {
  const drawn = element.closest(linkSelector)
  if (!drawn || !view.dom.contains(drawn)) return undefined
  const { doc } = view.state
  let position: number
  try {
    position = view.posAtDOM(drawn, 0)
  } catch {
    return undefined
  }
  if (drawn.classList.contains('inkkit-wiki-link')) {
    const node = doc.nodeAt(position)
    return node?.type.name === 'inkkit_wiki_link'
      ? {
          kind: 'wiki',
          from: position,
          to: position + node.nodeSize,
          reference: wikiReference(node),
        }
      : undefined
  }
  const $position = doc.resolve(position)
  const node: ProseNode | null = $position.nodeAfter ?? $position.nodeBefore
  const mark = node?.marks.find((candidate) => candidate.type.name === 'link')
  if (!node || !mark) return undefined
  const start = $position.nodeAfter ? position : position - node.nodeSize
  const run = markRun(doc, mark, start, start + node.nodeSize)
  return run && { kind: 'web', href: String(mark.attrs.href ?? ''), ...run }
}
