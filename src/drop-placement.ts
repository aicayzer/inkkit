import type { Node } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

/**
 * Where blocks dropped at a point go: in place of an empty top-level
 * paragraph at or beside the point, otherwise after the top-level block under the
 * point, or beside a top-level leaf such as an image rather than inside it. The result is a range
 * to replace; an insertion point has `from` equal to `to`.
 */
export function blockDropRange(
  view: EditorView,
  x: number,
  y: number,
): { from: number; to: number } {
  const { doc, selection } = view.state
  const hit = view.posAtCoords({ left: x, top: y })
  const $pos = doc.resolve(hit?.pos ?? selection.from)
  // Only an empty paragraph is a placeholder; an empty heading or code block
  // was written.
  const empty = (node: Node | null | undefined) =>
    node?.type.name === 'paragraph' && node.content.size === 0
  if ($pos.depth === 1 && empty($pos.parent))
    return { from: $pos.before(1), to: $pos.after(1) }
  if ($pos.depth > 0) return { from: $pos.after(1), to: $pos.after(1) }
  // A point in the margin beside an empty paragraph, as in an empty note.
  if (empty($pos.nodeAfter))
    return { from: $pos.pos, to: $pos.pos + $pos.nodeAfter!.nodeSize }
  if (empty($pos.nodeBefore))
    return { from: $pos.pos - $pos.nodeBefore!.nodeSize, to: $pos.pos }
  const leaf =
    hit && hit.inside >= 0 && doc.resolve(hit.inside).depth === 0
      ? doc.nodeAt(hit.inside)
      : null
  const at = leaf ? hit!.inside + leaf.nodeSize : $pos.pos
  return { from: at, to: at }
}
