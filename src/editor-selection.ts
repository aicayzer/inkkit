import {
  AllSelection,
  TextSelection,
  Selection,
  type EditorState,
} from '@milkdown/kit/prose/state'
import {
  type Mark as ProseMark,
  type Node as ProseNode,
  type ResolvedPos,
} from '@milkdown/kit/prose/model'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import { isImageBlock } from './image-blocks'
import { InkKitError } from './types'
import type { Mark, Block, CaretState } from './editor'

const markNames: Record<string, Mark> = {
  strong: 'bold',
  emphasis: 'italic',
  strike_through: 'strikethrough',
  highlight: 'highlight',
  underline: 'underline',
  superscript: 'superscript',
  subscript: 'subscript',
  inlineCode: 'code',
  link: 'link',
}

// Select All resolves at the document level, where no block can be read.
export function textBounds(state: EditorState): {
  $from: ResolvedPos
  $to: ResolvedPos
} {
  const { selection, doc } = state
  if (selection instanceof AllSelection)
    return TextSelection.between(doc.resolve(0), doc.resolve(doc.content.size))
  return selection
}

/** The extent of `mark` that covers `from` to `to` inside one textblock: the adjacent inline nodes
 *  that carry it. Undefined when the range leaves it. */
export function markRun(
  doc: ProseNode,
  mark: ProseMark,
  from: number,
  to: number,
): { from: number; to: number } | undefined {
  const $from = doc.resolve(from)
  if (!$from.parent.inlineContent || to > $from.end()) return undefined
  const start = $from.start()
  let run: { from: number; to: number } | undefined
  let found: { from: number; to: number } | undefined
  $from.parent.forEach((child, offset) => {
    const childFrom = start + offset
    if (!mark.isInSet(child.marks)) {
      run = undefined
      return
    }
    if (run) run.to = childFrom + child.nodeSize
    else run = { from: childFrom, to: childFrom + child.nodeSize }
    if (run.from <= from && to <= run.to) found = run
  })
  return found
}

export function caretState(state: EditorState): CaretState {
  const { empty } = state.selection
  const { $from, $to } = textBounds(state)
  const active = new Set<Mark>()
  const marks = empty ? (state.storedMarks ?? $from.marks()) : []
  for (const mark of marks) {
    const name = markNames[mark.type.name]
    if (name) active.add(name)
  }
  if (!empty) {
    for (const [name, mark] of Object.entries(markNames)) {
      const type = state.schema.marks[name]
      if (type && state.doc.rangeHasMark($from.pos, $to.pos, type))
        active.add(mark)
    }
  }
  const href = active.has('link') ? linkAddress(state, marks) : undefined
  return {
    marks: [...active],
    block: blockAt($from.parent, $from),
    quoted: quoted($from, $to),
    ...(href != null ? { href } : {}),
  }
}

/** The address of the first link at the caret, or in the selection, in document order. */
function linkAddress(
  state: EditorState,
  caretMarks: readonly ProseMark[],
): string | undefined {
  const type = state.schema.marks.link
  if (!type) return undefined
  const { empty } = state.selection
  if (empty) return type.isInSet(caretMarks)?.attrs.href as string | undefined
  const { $from, $to } = textBounds(state)
  let href: string | undefined
  state.doc.nodesBetween($from.pos, $to.pos, (node) => {
    if (href != null) return false
    href = type.isInSet(node.marks)?.attrs.href as string | undefined
    return true
  })
  return href
}

// Prefer the last writing position without selecting a terminal atom that typing could replace.
export function terminalSelection(doc: ProseNode): Selection {
  const $end = doc.resolve(doc.content.size)
  const gap = GapCursor as unknown as { valid($pos: ResolvedPos): boolean }
  if (isImageBlock(doc.lastChild) && gap.valid($end)) return new GapCursor($end)
  const text = Selection.findFrom($end, -1, true)
  if (text) return text
  if (gap.valid($end)) return new GapCursor($end)
  throw new InkKitError('preservation', 'Document has no safe writing position')
}

// True only when one quote holds the whole selection, so the state matches what the command can lift.
export function quoted($from: ResolvedPos, $to: ResolvedPos): boolean {
  return (
    $from.blockRange($to, (node) => node.type.name === 'blockquote') != null
  )
}

function blockAt(
  parent: ProseNode,
  $from: EditorState['selection']['$from'],
): Block {
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    switch (node.type.name) {
      case 'heading':
        return { type: 'heading', level: node.attrs.level }
      case 'code_block':
        return { type: 'codeBlock' }
      case 'list_item':
        return node.attrs.checked == null
          ? {
              type:
                $from.node(depth - 1).type.name === 'ordered_list'
                  ? 'orderedList'
                  : 'bulletList',
            }
          : { type: 'taskList' }
    }
  }
  if (parent.type.name === 'heading')
    return { type: 'heading', level: parent.attrs.level }
  return { type: 'paragraph' }
}
