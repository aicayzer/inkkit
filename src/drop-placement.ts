import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import type { Node, ResolvedPos } from '@milkdown/kit/prose/model'
import {
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
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

/**
 * A caret just after inserted blocks that end at `pos`: at the end of the
 * last text block, or a gap cursor after a block that holds no text, such as
 * a rule or table. It never selects a node, so typing never replaces one.
 */
export function caretAfter(doc: Node, pos: number): Selection {
  const $pos = doc.resolve(pos)
  if ($pos.nodeBefore?.isTextblock) return TextSelection.create(doc, pos - 1)
  // `valid` is public at run time but missing from the type declarations.
  const gap = GapCursor as unknown as { valid($pos: ResolvedPos): boolean }
  if (gap.valid($pos)) return new GapCursor($pos)
  return (
    TextSelection.findFrom($pos, -1, true) ??
    TextSelection.findFrom($pos, 1, true) ??
    Selection.near($pos)
  )
}

/**
 * Puts the caret just after what the transaction's last step inserted, so
 * typing continues after pasted or dropped content instead of replacing it.
 */
export function caretAfterInsertion(tr: Transaction): Transaction {
  const map = tr.mapping.maps[tr.mapping.maps.length - 1]
  let end: number | undefined
  map?.forEach((_from, _to, _newFrom, newTo) => {
    end ??= newTo
  })
  if (end == null) return tr
  const $end = tr.doc.resolve(end)
  return tr.setSelection(
    $end.parent.inlineContent
      ? TextSelection.create(tr.doc, end)
      : caretAfter(tr.doc, end),
  )
}
