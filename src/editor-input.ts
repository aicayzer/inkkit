import {
  NodeRange,
  Fragment,
  type Node as ProseNode,
  type ResolvedPos,
} from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Command,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { Mapping, liftTarget } from '@milkdown/kit/prose/transform'
import { splitBlock } from '@milkdown/kit/prose/commands'
import { undoInputRule } from '@milkdown/kit/prose/inputrules'
import { keymap } from '@milkdown/kit/prose/keymap'
import { liftListItem } from '@milkdown/kit/prose/schema-list'
import { $prose } from '@milkdown/kit/utils'
import { textInputPlugin } from './text-input'

const quotes = new Set(['blockquote', 'inkkit_callout'])

// A list item that opens with a quote holds an empty first paragraph, because the schema needs
// one. Once a paragraph has left the quote, the empty one would be written as a `<br />` line, so
// it goes. A `<br />` line an author wrote reads as the same paragraph, and stays while the quote
// does.
export function liftQuote(
  state: EditorState,
  range: NodeRange,
  target: number,
): Transaction {
  const tr = state.tr.lift(range, target)
  const { depth } = range
  const item = range.$from.node(depth - 1)
  const spacer = item.firstChild
  if (
    item.type.name === 'list_item' &&
    range.$from.index(depth - 1) === 1 &&
    spacer?.type.name === 'paragraph' &&
    spacer.content.size === 0
  ) {
    const from = range.$from.start(depth - 1)
    if (tr.doc.nodeAt(from + spacer.nodeSize)?.type === spacer.type)
      tr.delete(from, from + spacer.nodeSize)
  }
  return tr
}

// Backspace right after an input rule, such as a typed code fence, takes it back. The handlers for
// quotes and list items below would otherwise lift or join the block the rule made.
export const undoTypedRule = $prose(() => keymap({ Backspace: undoInputRule }))

// Backspace at the start of a quote's or callout's first block is left alone
// by the preset, or joins the block to the one above; leaving the quote is what
// a Backspace there means. A callout's only block stays while it holds text,
// because lifting it would remove the callout and its title.
export const quoteBackspace = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || $from.parentOffset > 0 || $from.depth < 2) return false
      const quote = $from.node($from.depth - 1)
      if (!quotes.has(quote.type.name) || $from.index($from.depth - 1) > 0)
        return false
      if (
        quote.type.name === 'inkkit_callout' &&
        quote.childCount === 1 &&
        $from.parent.content.size > 0
      )
        return true
      const range = $from.blockRange($from, (node) =>
        quotes.has(node.type.name),
      )
      const target = range && liftTarget(range)
      if (!range || target == null) return false
      dispatch?.(liftQuote(state, range, target).scrollIntoView())
      return true
    },
  }),
)

// The preset's Enter in an empty block lifts it out of its parent, splitting
// the parent when the block is not its last. A callout split that way repeats
// its header, so Enter there adds a paragraph instead, and leaves the callout
// only from its last block.
export const calloutEnter = $prose(() =>
  keymap({
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (
        !empty ||
        $from.depth < 2 ||
        !$from.parent.isTextblock ||
        $from.parent.type.spec.code ||
        $from.parent.content.size > 0
      )
        return false
      const callout = $from.node($from.depth - 1)
      if (
        callout.type.name !== 'inkkit_callout' ||
        $from.index($from.depth - 1) === callout.childCount - 1
      )
        return false
      return splitBlock(state, dispatch)
    },
  }),
)

// The preset lifts only an item's first line, which cannot leave on its own while the item holds
// more, such as a nested list: at the top of a document Backspace did nothing, and below another block
// it merged the line upward and left an empty bullet. The whole item is lifted instead, and a nested
// list it held joins the items that followed, since both now sit at one level.
export const listItemBackspace = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || $from.parentOffset > 0 || $from.depth < 3) return false
      const item = $from.node(-1)
      if (
        item.type.name !== 'list_item' ||
        item.childCount < 2 ||
        $from.index(-1) > 0 ||
        $from.index(-2) > 0
      )
        return false
      const { doc } = state
      const range = new NodeRange(
        doc.resolve($from.start(-1)),
        doc.resolve($from.end(-1)),
        $from.depth - 1,
      )
      const target = liftTarget(range)
      if (target == null) return false
      const tr = state.tr.lift(range, target)
      const $line = tr.doc.resolve(tr.mapping.map($from.pos))
      joinLists(tr, $line.start(-1), $line.index(-1) + item.childCount)
      dispatch?.(tr.scrollIntoView())
      return true
    },
  }),
)

// Lifting an item out of a list that no item holds, the preset leaves a nested list the item held
// beside the items that followed. Out of a nested list it joins the two itself.
export const liftItem: Command = (state, dispatch) => {
  const itemType = state.schema.nodes.list_item!
  const { $from, $to } = state.selection
  const range = $from.blockRange(
    $to,
    (node) => node.firstChild?.type === itemType,
  )
  const lift = liftListItem(itemType)
  if (!range || !dispatch || $from.node(range.depth - 1).type === itemType)
    return lift(state, dispatch)
  let lifted: Transaction | undefined
  if (!lift(state, (tr) => (lifted = tr)) || !lifted) return false
  let count = 0
  for (let index = range.startIndex; index < range.endIndex; index++)
    count += range.parent.child(index).childCount
  const start = range.$from.start(range.depth - 1)
  const first =
    range.$from.index(range.depth - 1) + (range.startIndex > 0 ? 1 : 0)
  joinLists(lifted, start, first + count)
  joinLists(lifted, start, first)
  dispatch(lifted)
  return true
}

// Backspace in the empty line left by ending a list in the middle removes it and joins the two
// lists again, as they were before. In the empty item left by ending a nested list in the middle,
// it moves the item back into the nested list before it, with the items it took along.
export const rejoinLists = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (
        !empty ||
        $from.parent.type.name !== 'paragraph' ||
        $from.parent.content.size > 0
      )
        return false
      const index = $from.index(-1)
      const container = $from.node(-1)
      if (container.type.name === 'list_item') {
        const list = $from.node(-2)
        const sublist = container.maybeChild(1)
        const previous = list.maybeChild($from.index(-2) - 1)?.lastChild
        if (
          index !== 0 ||
          container.childCount !== 2 ||
          !sublist ||
          !isList(sublist) ||
          previous?.type !== sublist.type
        )
          return false
        if (dispatch) {
          const at = $from.before(-1)
          // The end of the content of the list the item before ends with.
          const end = at - 2
          const tr = state.tr
            .delete(at, at + container.nodeSize)
            .insert(
              end,
              Fragment.from(
                container.copy(Fragment.from(container.firstChild!)),
              ).append(sublist.content),
            )
          tr.setSelection(TextSelection.create(tr.doc, end + 2))
          dispatch(tr.scrollIntoView())
        }
        return true
      }
      const before = container.maybeChild(index - 1)
      const after = container.maybeChild(index + 1)
      if (!before || !after || !isList(before) || after.type !== before.type)
        return false
      if (dispatch) {
        const at = $from.before()
        const tr = state.tr.delete(at, $from.after())
        joinLists(tr, $from.start(-1), index)
        tr.setSelection(Selection.near(tr.doc.resolve(at), -1))
        dispatch(tr.scrollIntoView())
      }
      return true
    },
  }),
)

// Enter in an empty item in the middle of a nested list split that list around a line left in the
// item holding it, which Markdown cannot write, so the edit was refused. The item moves out a level
// instead, as the last item of a nested list does, and the items after it become its own.
export const nestedItemEnter = $prose(() =>
  keymap({
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection
      const itemType = state.schema.nodes.list_item!
      if (
        !empty ||
        $from.depth < 5 ||
        $from.parent.content.size > 0 ||
        $from.node(-1).type !== itemType ||
        $from.node(-1).childCount !== 1 ||
        $from.node(-3).type !== itemType ||
        $from.indexAfter(-2) === $from.node(-2).childCount
      )
        return false
      return liftListItem(itemType)(state, dispatch)
    },
  }),
)

// Items an edit moves between lists, such as ending a list in the middle or lifting an item out a
// level, keep the attributes ProseMirror copies with them, which then disagree with their new list.
// An item takes its list's kind, which the reopened Markdown would give it. A list split from an
// ordered list, which ProseMirror starts from the first list's number, continues from the items
// left before it, as Markdown written so numbers it. Items are followed by position, since
// relabelling replaces their nodes.
export const movedListItems = $prose(
  () =>
    new Plugin({
      key: new PluginKey('movedListItems'),
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const {
          bullet_list: bullet,
          ordered_list: ordered,
          list_item: itemType,
        } = newState.schema.nodes
        const maps = transactions.flatMap((tr) => tr.mapping.maps)
        const mapping = new Mapping(maps)
        const inverse = mapping.invert()
        // The ordered list and index of the item whose content starts at a position.
        const itemAt = (doc: ProseNode, pos: number) => {
          const $pos = doc.resolve(pos)
          return $pos.depth > 1 &&
            $pos.parent.type === itemType &&
            $pos.node(-1).type === ordered
            ? {
                list: $pos.node(-1),
                at: $pos.before(-1),
                index: $pos.index(-1),
              }
            : undefined
        }
        let ranges: Array<[number, number]> = []
        for (const map of maps) {
          ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to)])
          map.forEach((_from, _to, from, to) => ranges.push([from, to]))
        }
        const tr = newState.tr
        const seen = new Set<number>()
        const { doc } = newState
        const continued = (list: ProseNode, pos: number) => {
          const back = inverse.mapResult(pos + 2, 1)
          const origin = back.deleted
            ? undefined
            : itemAt(oldState.doc, back.pos)
          // The original list itself, which lost the items before this one.
          if (!origin?.index || mapping.map(origin.at, 1) === pos) return
          const $list = doc.resolve(pos)
          let before = 0
          for (
            let index = 0, at = origin.at + 1;
            index < origin.index;
            at += origin.list.child(index++).nodeSize
          ) {
            const forward = mapping.mapResult(at + 1, 1)
            const now = forward.deleted ? undefined : itemAt(doc, forward.pos)
            if (
              now &&
              now.at < pos &&
              doc.resolve(now.at).start() === $list.start()
            )
              before++
          }
          // A part split at its own level continues the numbering. A list
          // that comes to follow the first line of an item starts from 1,
          // since Markdown reads a list after a line only when it does.
          const order = before
            ? Number(origin.list.attrs.order) + before
            : $list.parent.type === itemType
              ? 1
              : undefined
          if (order !== undefined && list.attrs.order !== order)
            tr.setNodeMarkup(pos, undefined, { ...list.attrs, order })
        }
        for (const [from, to] of ranges)
          doc.nodesBetween(
            Math.max(0, from - 1),
            Math.min(doc.content.size, to + 1),
            (node, pos, parent) => {
              if (seen.has(pos)) return
              seen.add(pos)
              if (node.type === ordered) continued(node, pos)
              const listType =
                parent?.type === ordered
                  ? 'ordered'
                  : parent?.type === bullet
                    ? 'bullet'
                    : undefined
              if (
                node.type === itemType &&
                listType &&
                node.attrs.listType !== listType
              )
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  listType,
                  label: listType === 'ordered' ? node.attrs.label : '•',
                })
            },
          )
        return tr.docChanged ? tr : null
      },
    }),
)

export const textInputPolicy = $prose(() => textInputPlugin())

export function outermostListDepth($pos: ResolvedPos): number | null {
  for (let depth = 1; depth <= $pos.depth; depth++) {
    if (isList($pos.node(depth))) return depth
  }
  return null
}

export function innermostListDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth >= 1; depth--) {
    if (isList($pos.node(depth))) return depth
  }
  return null
}

function isList(node: ProseNode): boolean {
  return node.type.name === 'bullet_list' || node.type.name === 'ordered_list'
}

// Two lists of one kind side by side are written with a changed marker to keep them apart, and the
// document shows a gap between them, so an edit that leaves them so joins them.
function joinLists(tr: Transaction, start: number, index: number): void {
  const $start = tr.doc.resolve(start)
  const before = $start.parent.maybeChild(index - 1)
  const after = $start.parent.maybeChild(index)
  if (before && after && isList(before) && after.type === before.type)
    tr.join($start.posAtIndex(index))
}
