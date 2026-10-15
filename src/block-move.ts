import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  NodeSelection,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { commentsVisible } from './comments'
import type { BlockMoveDirection } from './types'

// The nodes whose children move among themselves. A list item is not one: a
// move inside an item moves the item, with any sublist it holds.
const containers = new Set([
  'doc',
  'blockquote',
  'inkkit_callout',
  'bullet_list',
  'ordered_list',
  'footnote_definition',
])

const tableParts = new Set([
  'table',
  'table_row',
  'table_header_row',
  'table_cell',
  'table_header',
])

interface Move {
  /** The container's depth and the index range of the blocks that move. */
  depth: number
  start: number
  end: number
  /** The index range of the neighbours they move past. */
  past: [number, number]
}

const frontMatter = (node: ProseNode) =>
  node.type.name === 'literal_markdown' &&
  /^(?:---|\+\+\+)[ \t]*\r?\n/.test(node.textContent)

/**
 * The move a selection makes, or `'boundary'` when its blocks are already
 * first or last in their container, or `undefined` when it has no blocks to
 * move, such as in a table, where the table's own row moves apply.
 */
function plan(
  state: EditorState,
  direction: BlockMoveDirection,
): Move | 'boundary' | undefined {
  const { $from, $to } = state.selection
  for (const $pos of [$from, $to])
    for (let depth = $pos.depth; depth > 0; depth--)
      if (tableParts.has($pos.node(depth).type.name)) return undefined
  const range = $from.blockRange($to, (node) => containers.has(node.type.name))
  if (!range) return undefined
  const container = range.parent
  // Front matter is read only at the start of the note, so it stays first.
  const first = range.depth === 0 && frontMatter(container.child(0)) ? 1 : 0
  if (range.startIndex < first) return undefined
  // A comment the person can't see is not a place to move to: the move goes
  // past it and the next block they can see.
  const hidden = (index: number) =>
    !commentsVisible(state) &&
    container.child(index).type.name === 'comment_block'
  const up = direction === 'up'
  let index = up ? range.startIndex - 1 : range.endIndex
  const step = up ? -1 : 1
  const inside = (index: number) =>
    up ? index >= first : index < container.childCount
  while (inside(index) && hidden(index)) index += step
  if (!inside(index)) return 'boundary'
  const past: [number, number] = up
    ? [index, range.startIndex]
    : [range.endIndex, index + 1]
  return {
    depth: range.depth,
    start: range.startIndex,
    end: range.endIndex,
    past,
  }
}

/** Whether `moveBlock` would move the blocks at the selection. */
export function canMoveBlock(
  state: EditorState,
  direction: BlockMoveDirection,
): boolean {
  return typeof plan(state, direction) === 'object'
}

/**
 * `'move'` when `moveBlock` would move the blocks at the selection,
 * `'boundary'` when they are already first or last in their container, and
 * undefined when there are none to move, as in a table.
 */
export function blockMove(
  state: EditorState,
  direction: BlockMoveDirection,
): 'move' | 'boundary' | undefined {
  const move = plan(state, direction)
  return typeof move === 'object' ? 'move' : move
}

/**
 * Moves the blocks at the selection past their neighbour in `direction`, as
 * one step that keeps the moved and the passed nodes as they are, so their
 * authored source travels with them. Returns undefined when nothing moves.
 */
export function moveBlockTransaction(
  state: EditorState,
  direction: BlockMoveDirection,
): Transaction | undefined {
  const move = plan(state, direction)
  if (typeof move !== 'object') return undefined
  const { depth, start, end, past } = move
  const $at = state.selection.$from
  const container = $at.node(depth)
  const offset = (index: number) => $at.posAtIndex(index, depth)
  const children = (from: number, to: number) => {
    const nodes: ProseNode[] = []
    for (let index = from; index < to; index++)
      nodes.push(container.child(index))
    return nodes
  }
  const moved = children(start, end)
  const passed = children(past[0], past[1])
  const up = direction === 'up'
  const from = offset(up ? past[0] : start)
  const to = offset(up ? end : past[1])
  const reordered = up ? [...moved, ...passed] : [...passed, ...moved]
  const tr = state.tr.replaceWith(from, to, Fragment.fromArray(reordered))
  // The selection keeps its place in the moved text.
  const shift = up
    ? -passed.reduce((size, node) => size + node.nodeSize, 0)
    : passed.reduce((size, node) => size + node.nodeSize, 0)
  tr.setSelection(shifted(state.selection, tr.doc, shift))
  return tr.scrollIntoView()
}

function shifted(
  selection: Selection,
  doc: ProseNode,
  shift: number,
): Selection {
  if (selection instanceof NodeSelection)
    return NodeSelection.create(doc, selection.from + shift)
  if (selection instanceof TextSelection)
    return TextSelection.create(
      doc,
      selection.anchor + shift,
      selection.head + shift,
    )
  return Selection.near(doc.resolve(selection.head + shift))
}
