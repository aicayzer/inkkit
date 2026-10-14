import { $prose } from '@milkdown/kit/utils'
import {
  joinBackward,
  joinForward,
  selectNodeBackward,
  selectNodeForward,
} from '@milkdown/kit/prose/commands'
import {
  Fragment,
  type Node as ProseNode,
  type ResolvedPos,
} from '@milkdown/kit/prose/model'
import { Mapping } from '@milkdown/kit/prose/transform'
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { commentsVisible, isComment, isWrittenEdit } from './comments'
import { mac } from './modifier'

// A hidden comment is drawn `display: none`. Browsers delete such an element
// along with the character beside it, often without a `beforeinput` event, so
// deletion beside one is done here instead of natively.

type Direction = -1 | 1
type Unit = 'character' | 'word' | 'lineboundary'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// Any other chord with Backspace or Delete deletes one character, so no
// native deletion runs beside a hidden comment.
function deletion(event: KeyboardEvent): [Direction, Unit] | undefined {
  const { altKey: alt, ctrlKey: ctrl, metaKey: meta, key } = event
  const dir = key === 'Backspace' ? -1 : key === 'Delete' ? 1 : undefined
  if (mac) {
    // Control-H and Control-D are the macOS text system's Backspace and Delete.
    const control = ctrl && !alt && !meta
    if (control && key === 'h') return [-1, 'character']
    if (control && key === 'd') return [1, 'character']
    if (!dir) return undefined
    if (alt && !ctrl && !meta) return [dir, 'word']
    if (meta && !alt && !ctrl) return [dir, 'lineboundary']
    return [dir, 'character']
  }
  if (!dir) return undefined
  // Shift-Delete cuts outside macOS.
  if (dir > 0 && event.shiftKey && !alt && !ctrl && !meta) return undefined
  return [dir, ctrl && !alt && !meta ? 'word' : 'character']
}

const inputDeletions: Record<string, [Direction, Unit]> = {
  deleteContentBackward: [-1, 'character'],
  deleteContentForward: [1, 'character'],
  deleteWordBackward: [-1, 'word'],
  deleteWordForward: [1, 'word'],
  deleteSoftLineBackward: [-1, 'lineboundary'],
  deleteSoftLineForward: [1, 'lineboundary'],
  deleteHardLineBackward: [-1, 'lineboundary'],
  deleteHardLineForward: [1, 'lineboundary'],
}

const inlineComment = (node: ProseNode | null | undefined) =>
  !!node && node.isInline && isComment(node)

/** The position past any hidden comments directly beside `pos` in `dir`. */
function pastComments(doc: ProseNode, pos: number, dir: Direction): number {
  for (;;) {
    const $pos = doc.resolve(pos)
    const node = dir < 0 ? $pos.nodeBefore : $pos.nodeAfter
    if (!inlineComment(node)) return pos
    pos += dir * node!.nodeSize
  }
}

/** The far end of one visible character, or `undefined` at the textblock edge. */
function characterEnd(
  doc: ProseNode,
  pos: number,
  dir: Direction,
): number | undefined {
  const $pos = doc.resolve(pos)
  const node = dir < 0 ? $pos.nodeBefore : $pos.nodeAfter
  if (!node) return undefined
  if (!node.isText) return pos + dir * node.nodeSize
  const segments = [...graphemes.segment(node.text!)]
  const segment = dir < 0 ? segments.at(-1) : segments[0]
  return pos + dir * (segment?.segment.length ?? 1)
}

/** Where the browser would end a word or line deletion, measured on the rendered text. */
function renderedEnd(
  view: EditorView,
  dir: Direction,
  unit: Unit,
): number | undefined {
  const selection =
    (view.root as Document).getSelection?.() ?? document.getSelection()
  if (!selection?.anchorNode || !selection.focusNode) return undefined
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  try {
    selection.collapse(focusNode, focusOffset)
    selection.modify('extend', dir < 0 ? 'backward' : 'forward', unit)
    return selection.focusNode
      ? view.posAtDOM(selection.focusNode, selection.focusOffset)
      : undefined
  } catch {
    return undefined
  } finally {
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
  }
}

/** Deletes `from` to `to` inside one textblock, keeping every comment in the range. */
function deleteAround(tr: Transaction, from: number, to: number): boolean {
  const ranges: [number, number][] = []
  let start = from
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!inlineComment(node)) return true
    if (pos > start) ranges.push([start, pos])
    start = Math.max(start, pos + node.nodeSize)
    return false
  })
  if (to > start) ranges.push([start, to])
  for (const [a, b] of ranges.reverse()) tr.delete(a, b)
  return ranges.length > 0
}

/** The textblock reached by going into `node` from the side facing `dir`'s origin. */
function facingTextblock(node: ProseNode, dir: Direction): ProseNode | null {
  let current: ProseNode | null = node
  while (current && !current.isTextblock)
    current = dir < 0 ? current.lastChild : current.firstChild
  return current
}

interface Boundary {
  /** The hidden comment blocks between this textblock and the next block. */
  from: number
  to: number
  /** Depth of the node that holds those comment blocks. */
  depth: number
  /** The first block past them, if any. */
  beyond: ProseNode | undefined
}

// Mirrors how ProseMirror finds the block a join at the edge of a textblock would reach.
function boundary($edge: ResolvedPos, dir: Direction): Boundary | undefined {
  if ($edge.parent.type.spec.isolating) return undefined
  for (let depth = $edge.depth - 1; depth >= 0; depth--) {
    const parent = $edge.node(depth)
    const index = $edge.index(depth)
    if (dir < 0 ? index > 0 : index < parent.childCount - 1) {
      const edge = dir < 0 ? $edge.before(depth + 1) : $edge.after(depth + 1)
      let next = index + dir
      let size = 0
      while (next >= 0 && next < parent.childCount) {
        const sibling = parent.child(next)
        if (!isComment(sibling)) break
        size += sibling.nodeSize
        next += dir
      }
      return {
        from: dir < 0 ? edge - size : edge,
        to: dir < 0 ? edge : edge + size,
        depth,
        beyond:
          next >= 0 && next < parent.childCount
            ? parent.child(next)
            : undefined,
      }
    }
    if ($edge.node(depth).type.spec.isolating) return undefined
  }
  return undefined
}

/**
 * Joins across hidden comment blocks as though they were absent, then puts
 * them back, in order, after the block that holds the caret.
 */
function joinAcross(
  state: EditorState,
  edge: number,
  dir: Direction,
  { from, to, depth, beyond }: Boundary,
): Transaction | undefined {
  const comments = state.doc.slice(from, to).content
  const removed = state.tr.delete(from, to)
  const scratch = EditorState.create({
    doc: removed.doc,
    selection: TextSelection.create(
      removed.doc,
      removed.mapping.map(edge, dir),
    ),
  })
  const select = dir < 0 ? selectNodeBackward : selectNodeForward
  const join = dir < 0 ? joinBackward : joinForward
  let result: Transaction | undefined
  const commands: Command[] = beyond?.isAtom ? [select] : [join, select]
  for (const command of commands)
    if (command(scratch, (tr) => (result = tr))) break
  if (!result) return undefined
  if (!result.docChanged)
    return state.tr
      .setSelection(result.selection.map(state.doc, removed.mapping.invert()))
      .scrollIntoView()
  for (const step of result.steps) removed.step(step)
  const $head = removed.doc.resolve(result.selection.head)
  if ($head.depth <= depth) return undefined
  const steps = removed.steps.length
  const size = removed.doc.content.size
  removed.insert($head.after(depth + 1), comments)
  // An insert that does not fit adds no step, or drops part of the content.
  if (
    removed.steps.length === steps ||
    removed.doc.content.size !== size + comments.size
  )
    return undefined
  return removed
    .setSelection(
      result.selection.map(removed.doc, removed.mapping.slice(steps)),
    )
    .scrollIntoView()
}

const containsComment = (block: ProseNode) => {
  let found = false
  block.forEach((node) => {
    if (inlineComment(node)) found = true
  })
  return found
}

/** The range a `beforeinput` deletion targets, as document positions. */
function targetRange(
  view: EditorView,
  event: InputEvent,
): { from: number; to: number } | undefined {
  const [range] = event.getTargetRanges?.() ?? []
  if (!range) return undefined
  try {
    const from = view.posAtDOM(range.startContainer, range.startOffset)
    const to = view.posAtDOM(range.endContainer, range.endOffset)
    return from <= to ? { from, to } : { from: to, to: from }
  } catch {
    return undefined
  }
}

/** Applies a command's result, made on a copy of `base`'s document, to `base`. */
function replay(base: Transaction, result: Transaction): Transaction {
  for (const step of result.steps) base.step(step)
  return base
    .setSelection(result.selection.map(base.doc, new Mapping()))
    .scrollIntoView()
}

/** Deletion from the edge of a textblock, past any hidden inline comments. */
function deleteAtEdge(
  view: EditorView,
  caret: number,
  edge: number,
  dir: Direction,
  native: boolean,
): boolean {
  const { state } = view
  const $edge = state.doc.resolve(edge)
  const across = boundary($edge, dir)
  const target = across?.beyond && facingTextblock(across.beyond, dir)
  // Joining would move visible text into a hidden comment.
  if (target && isComment(target)) return true
  if (across && across.from !== across.to) {
    const tr = across.beyond && joinAcross(state, edge, dir, across)
    if (tr) view.dispatch(tr)
    return true
  }
  const atEdge = TextSelection.create(state.doc, edge)
  if (!native) {
    // The editor's own handlers for a key at a textblock edge run next.
    if (caret !== edge) view.dispatch(state.tr.setSelection(atEdge))
    return false
  }
  if (
    caret === edge &&
    !containsComment($edge.parent) &&
    !(target && containsComment(target))
  )
    return false
  // Input that no key handler took: join here rather than natively.
  const scratch = EditorState.create({ doc: state.doc, selection: atEdge })
  const commands =
    dir < 0
      ? [joinBackward, selectNodeBackward]
      : [joinForward, selectNodeForward]
  commands.some((command) =>
    command(scratch, (tr) => view.dispatch(replay(state.tr, tr))),
  )
  return true
}

/**
 * Deletes from a caret beside hidden comments. Returns `true` when the
 * deletion was handled or must not happen, and `false` to leave it to the
 * editor's other handlers.
 */
function deleteBeside(
  view: EditorView,
  dir: Direction,
  unit: Unit,
  native: boolean,
  target?: { from: number; to: number },
): boolean {
  const { state } = view
  const { selection } = state
  if (
    commentsVisible(state) ||
    !(selection instanceof TextSelection) ||
    !selection.empty
  )
    return false
  const $caret = selection.$head
  // Only a note with no visible textblock leaves the caret in a hidden comment.
  if (commentDepth($caret)) return true
  if (!$caret.parent.isTextblock) return false
  const inBlock =
    target &&
    target.from < target.to &&
    target.from >= $caret.start() &&
    target.to <= $caret.end()
  if (inBlock && containsComment($caret.parent)) {
    // The range the browser reported, such as Control-K to the end of the line.
    const tr = state.tr
    if (deleteAround(tr, target.from, target.to)) {
      view.dispatch(
        tr
          .setSelection(
            TextSelection.create(tr.doc, tr.mapping.map(target.from, -1)),
          )
          .scrollIntoView(),
      )
      return true
    }
  }
  const past = pastComments(state.doc, $caret.pos, dir)
  if (past === (dir < 0 ? $caret.start() : $caret.end()))
    return deleteAtEdge(view, $caret.pos, past, dir, native)
  if (!containsComment($caret.parent)) return false
  let end =
    unit === 'character'
      ? characterEnd(state.doc, past, dir)
      : renderedEnd(view, dir, unit)
  if (end === undefined) return true
  end = Math.min(Math.max(end, $caret.start()), $caret.end())
  end = outsideComment(state.doc, end, dir) ?? end
  const from = Math.min($caret.pos, end)
  const to = Math.max($caret.pos, end)
  const tr = state.tr
  if (!deleteAround(tr, from, to)) return true
  const caret = tr.mapping.map(dir < 0 ? from : $caret.pos, -1)
  view.dispatch(
    tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView(),
  )
  return true
}

/** The nearest caret position in a visible textblock, starting `dir` from `pos`. */
function visibleTextblock(
  doc: ProseNode,
  pos: number,
  dir: Direction,
): number | undefined {
  for (const side of [dir, -dir as Direction]) {
    let $pos = doc.resolve(pos)
    for (;;) {
      const found = Selection.findFrom($pos, side, true)
      if (!found) break
      if (!isComment(found.$head.parent)) return found.head
      $pos = doc.resolve(side > 0 ? found.$head.after() : found.$head.before())
    }
  }
  return undefined
}

/** The comment that holds `pos`, as its depth, or 0. */
function commentDepth($pos: ResolvedPos): number {
  for (let depth = 1; depth <= $pos.depth; depth++)
    if (isComment($pos.node(depth))) return depth
  return 0
}

function outsideComment(
  doc: ProseNode,
  pos: number,
  dir: Direction,
): number | undefined {
  const $pos = doc.resolve(pos)
  const depth = commentDepth($pos)
  if (!depth) return pos
  const beside = dir > 0 ? $pos.after(depth) : $pos.before(depth)
  return $pos.node(depth).isInline ? beside : visibleTextblock(doc, beside, dir)
}

/**
 * Keeps a caret out of hidden comments. An end of a selection inside one moves
 * toward the other end, leaving the comment beside the selected text. A
 * selection wholly inside one comment, such as a search match, is left as it is.
 */
function selectionOutsideComments(
  before: EditorState,
  state: EditorState,
): Transaction | null {
  const { selection, doc } = state
  if (commentsVisible(state) || !(selection instanceof TextSelection))
    return null
  const { anchor, head, $anchor, $head } = selection
  const anchorDepth = commentDepth($anchor)
  const headDepth = commentDepth($head)
  if (!anchorDepth && !headDepth) return null
  if (selection.empty) {
    const dir = head >= before.selection.head ? 1 : -1
    const caret = outsideComment(doc, head, dir)
    return caret === undefined
      ? null
      : state.tr.setSelection(TextSelection.create(doc, caret))
  }
  if (
    anchorDepth === headDepth &&
    $anchor.before(anchorDepth) === $head.before(headDepth)
  )
    return null
  const forward = head > anchor
  const start = outsideComment(doc, forward ? anchor : head, 1)
  const end = outsideComment(doc, forward ? head : anchor, -1)
  if (start === undefined || end === undefined) return null
  const [from, to] = start < end ? [start, end] : [end, end]
  return state.tr.setSelection(
    forward
      ? TextSelection.create(doc, from, to)
      : TextSelection.create(doc, to, from),
  )
}

/** The position after the hidden comment that holds an empty selection, if any. */
export function hiddenCommentExit(state: EditorState): number | undefined {
  const { selection } = state
  if (commentsVisible(state) || !selection.empty) return undefined
  const depth = commentDepth(selection.$head)
  return depth ? selection.$head.after(depth) : undefined
}

/**
 * Puts `content` after the hidden comment that holds the caret instead of
 * inside it: inline content in a new paragraph after a block comment, with the
 * caret after it. `undefined` when the caret is not in a hidden comment or the
 * content cannot go there.
 */
export function insertAfterHiddenComment(
  state: EditorState,
  content: Fragment,
): Transaction | undefined {
  const pos = hiddenCommentExit(state)
  if (pos === undefined) return undefined
  const $pos = state.doc.resolve(pos)
  const { paragraph } = state.schema.nodes
  const blocks =
    $pos.parent.inlineContent || content.firstChild?.isBlock
      ? content
      : paragraph && Fragment.from(paragraph.create(null, content))
  if (!blocks || !$pos.parent.canReplace($pos.index(), $pos.index(), blocks))
    return undefined
  const tr = state.tr.insert(pos, blocks)
  const end = pos + blocks.size
  return tr
    .setSelection(Selection.near(tr.doc.resolve(end), -1))
    .scrollIntoView()
}

/** Marks a command that removes structure the person chose, such as a table row, with any hidden comments in it. */
export const removesStructure = 'inkkit:removesStructure'

function commentCount(doc: ProseNode): number {
  let count = 0
  doc.descendants((node) => {
    if (!isComment(node)) return true
    count++
    return false
  })
  return count
}

/**
 * Refuses a written edit made from a caret that removes a hidden comment,
 * whatever produced it: a key, input the browser applied itself, a
 * composition or a command. The person cannot see what such an edit removes.
 * A selection deleted or replaced on purpose, undo, redo and source
 * replacement are exempt.
 */
export function assertHiddenCommentsKept(
  state: EditorState,
  tr: Transaction,
  after: ProseNode,
): void {
  if (
    commentsVisible(state) ||
    !state.selection.empty ||
    !isWrittenEdit(tr) ||
    tr.getMeta(removesStructure) ||
    !touchesComment(tr)
  )
    return
  // Fewer comments loses one; more means one was written twice.
  if (commentCount(after) !== commentCount(state.doc))
    throw new Error('A hidden comment cannot be removed from beside it')
}

function touchesComment(tr: Transaction): boolean {
  let touched = false
  tr.steps.forEach((step, index) => {
    const doc = tr.docs[index]!
    step.getMap().forEach((from, to) => {
      if (touched || to <= from) return
      doc.nodesBetween(from, to, (node) => {
        if (isComment(node)) touched = true
        return !touched
      })
    })
  })
  return touched
}

/**
 * Puts back inline comments that ending or cancelling a composition removed.
 * The browser takes a hidden comment beside composed text with it, and
 * refusing the edit would instead keep text the person cancelled.
 */
function restoreComposedOver(
  transactions: readonly Transaction[],
  before: EditorState,
  state: EditorState,
): Transaction | null {
  if (
    commentsVisible(state) ||
    !before.selection.empty ||
    !transactions.some(
      (tr) =>
        tr.getMeta('composition') && isWrittenEdit(tr) && touchesComment(tr),
    )
  )
    return null
  let missing = commentCount(before.doc) - commentCount(state.doc)
  if (missing <= 0) return null
  const mapping = new Mapping()
  for (const tr of transactions) mapping.appendMapping(tr.mapping)
  // A replaced range can write a comment back; only one that did not come back is restored.
  const present = new Map<string, number>()
  const key = (node: ProseNode) =>
    `${node.type.name}:${node.attrs.syntax}:${node.textContent}`
  state.doc.descendants((node) => {
    if (!isComment(node)) return true
    present.set(key(node), (present.get(key(node)) ?? 0) + 1)
    return false
  })
  const removed: [number, ProseNode][] = []
  before.doc.descendants((node, pos) => {
    if (!isComment(node)) return true
    if (!node.isInline || !mapping.mapResult(pos + 1).deleted) return false
    const kept = present.get(key(node)) ?? 0
    if (kept) present.set(key(node), kept - 1)
    else if (missing > 0) {
      missing--
      // A comment after the caret stays after the composed text.
      removed.push([
        pos >= before.selection.head
          ? mapping.map(pos + node.nodeSize, 1)
          : mapping.map(pos, -1),
        node,
      ])
    }
    return false
  })
  if (!removed.length) return null
  const tr = state.tr
  for (const [pos, node] of removed.reverse()) {
    const $pos = tr.doc.resolve(pos)
    if ($pos.parent.inlineContent) tr.insert(pos, node)
  }
  return tr.docChanged ? tr : null
}

export const hiddenCommentEditing = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitHiddenComments'),
      props: {
        handleKeyDown(view, event) {
          if (view.composing || event.isComposing || !view.editable)
            return false
          // Enter would split the hidden comment.
          if (
            event.key === 'Enter' &&
            hiddenCommentExit(view.state) !== undefined
          )
            return true
          const kind = deletion(event)
          return !!kind && deleteBeside(view, kind[0], kind[1], false)
        },
        handleTextInput(view, _from, _to, text) {
          if (!text) return false
          const tr = insertAfterHiddenComment(
            view.state,
            Fragment.from(view.state.schema.text(text)),
          )
          if (!tr) return false
          view.dispatch(tr)
          return true
        },
        handleDOMEvents: {
          beforeinput(view, event) {
            if (!view.editable) return false
            // Composed text needs a paragraph to land in before the browser writes it.
            if (event.inputType === 'insertCompositionText') {
              const tr = insertAfterHiddenComment(view.state, Fragment.empty)
              if (tr) view.dispatch(tr)
              return false
            }
            if (view.composing) return false
            if (event.inputType === 'insertText' && event.data) {
              const tr = insertAfterHiddenComment(
                view.state,
                Fragment.from(view.state.schema.text(event.data)),
              )
              if (!tr) return false
              view.dispatch(tr)
              event.preventDefault()
              return true
            }
            const kind = inputDeletions[event.inputType]
            if (!kind) return false
            if (
              !deleteBeside(
                view,
                kind[0],
                kind[1],
                true,
                targetRange(view, event),
              )
            )
              return false
            event.preventDefault()
            return true
          },
        },
      },
      appendTransaction: (transactions, before, state) =>
        restoreComposedOver(transactions, before, state) ??
        selectionOutsideComments(before, state),
    }),
)
