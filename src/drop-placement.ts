import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import type { Node, ResolvedPos } from '@milkdown/kit/prose/model'
import {
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { isComment } from './comments'

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
 * a rule or table. After a block that shows no text, such as a rule, an image
 * or a comment, it goes to the next text first. It never selects a node, so
 * typing never replaces one, and never goes inside a comment or a folded
 * callout, where typing would change text the reader can't see or didn't
 * choose.
 */
export function caretAfter(doc: Node, pos: number): Selection {
  const $pos = doc.resolve(pos)
  const before = $pos.nodeBefore
  if (before?.isTextblock && !concealed(doc.resolve(pos - 1)))
    return TextSelection.create(doc, pos - 1)
  // `valid` is public at run time but missing from the type declarations.
  const gap = GapCursor as unknown as { valid($pos: ResolvedPos): boolean }
  if (gap.valid($pos)) return new GapCursor($pos)
  const [first, second] = before && !showsText(before) ? [1, -1] : [-1, 1]
  return (
    shownText(doc, pos, first) ??
    shownText(doc, pos, second) ??
    Selection.near($pos)
  )
}

// A comment, shown or not, or the body of a callout that opens folded.
function hides(node: Node): boolean {
  return (
    isComment(node) ||
    (node.type.name === 'inkkit_callout' && node.attrs.fold === '-')
  )
}

// The depth of the outermost node around `$pos` that hides it, or -1.
function concealedDepth($pos: ResolvedPos): number {
  for (let depth = 1; depth <= $pos.depth; depth++)
    if (hides($pos.node(depth))) return depth
  return -1
}

function concealed($pos: ResolvedPos): boolean {
  return concealedDepth($pos) >= 0
}

function showsText(node: Node): boolean {
  if (hides(node)) return false
  if (node.isTextblock) return true
  let found = false
  node.descendants((child) => {
    if (found || hides(child)) return false
    if (child.isTextblock) found = true
    return !found
  })
  return found
}

// The nearest text position from `pos` in direction `dir` that isn't hidden.
function shownText(doc: Node, pos: number, dir: number): Selection | null {
  let $from = doc.resolve(pos)
  for (;;) {
    const found = TextSelection.findFrom($from, dir, true)
    if (!found) return null
    const depth = concealedDepth(found.$head)
    if (depth < 0) return found
    $from = doc.resolve(
      dir > 0 ? found.$head.after(depth) : found.$head.before(depth),
    )
  }
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
