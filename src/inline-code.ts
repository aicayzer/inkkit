import { inlineCodeSchema } from '@milkdown/kit/preset/commonmark'
import type { Mark, MarkType, Node } from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { AddMarkStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

// Inline code does not continue past the end of its span, so that text typed
// after a span stays outside it. A code mark that was asked for at a caret
// would then apply to one character only, since ProseMirror clears stored
// marks when text goes in. This keeps the stored mark while the person types,
// corrects with Backspace or Delete, or composes text, as bold does, until the
// command is toggled, the caret moves, or Enter starts a new block, since a
// code span never crosses blocks.
//
// While an input method composes text, the marks are held aside, since
// storing them then would stop the composition and draw the text twice.
// Text the method adds to the composition takes no mark either, so when the
// composition ends the code is put on the composed text and stored again.
interface Held {
  marks: readonly Mark[]
  // The composition, which is the one that ProseMirror numbered `id`, and the
  // text it composed, from where it started to where it ended.
  id: unknown
  from: number
  to: number
}
const held = new PluginKey<Held | null>('storedInlineCode')

// Puts the code on the composed text and stores the marks for what is typed
// next, with the caret at `caret`. Nothing, where the caret is elsewhere.
function finish(
  state: EditorState,
  pending: Held,
  code: MarkType,
  end = pending.to,
  caret = pending.to,
): Transaction | null {
  const { selection } = state
  if (state.storedMarks || !selection.empty || selection.from !== caret)
    return null
  const tr = state.tr
  if (pending.from < end) tr.addMark(pending.from, end, code.create())
  return tr.setStoredMarks(pending.marks)
}

// Where the composed text ends and the caret is after the first edit that
// follows a composition, when that edit is typing or deleting at the caret.
// Paste, drop, Undo and Redo, a replaced selection and anything that touches
// other text are not, and leave the composed text as it is.
function ordinary(
  oldDoc: Node,
  transactions: readonly Transaction[],
  pending: Held,
): { end: number; caret: number } | null {
  const [edit, ...rest] = transactions
  if (
    !edit ||
    edit.steps.length !== 1 ||
    ['composition', 'paste', 'history$'].some(
      (key) => edit.getMeta(key) !== undefined,
    ) ||
    ['paste', 'drop', 'cut'].includes(edit.getMeta('uiEvent') as string) ||
    // What a plugin added to the edit, such as a link, is not another edit.
    rest.some((tr) => tr.steps.some((step) => !(step instanceof AddMarkStep)))
  )
    return null
  const step = edit.steps[0]
  if (!(step instanceof ReplaceStep)) return null
  const { from, to, slice } = step
  // One character typed at the end of what was composed. The browser may
  // report the composed text before it again, so that the edit replaces it
  // with itself and the character, which has no marks of its own. Anything
  // longer is a paste or another input, not a key.
  const typed = slice.content.firstChild
  if (
    slice.size &&
    to === pending.to &&
    from >= pending.from &&
    slice.openStart === 0 &&
    slice.openEnd === 0 &&
    slice.content.childCount === 1 &&
    typed?.isText &&
    !typed.marks.length
  ) {
    const kept = oldDoc.textBetween(from, to)
    const added = typed.text!.slice(kept.length)
    if (typed.text!.startsWith(kept) && [...added].length === 1)
      return { end: from + slice.size, caret: from + slice.size }
    return null
  }
  if (slice.size) return null
  // Backspace removes text before the end, and Delete text after it.
  if (to === pending.to && from >= pending.from)
    return { end: from, caret: from }
  if (from === pending.to) return { end: pending.to, caret: pending.to }
  return null
}

export const storedInlineCode = $prose((ctx) => {
  const type = () => inlineCodeSchema.type(ctx)
  let composing: EditorView | undefined
  return new Plugin<Held | null>({
    key: held,
    state: {
      init: () => null,
      apply(tr, value, old) {
        const id: unknown = tr.getMeta('composition')
        if (id === undefined) {
          // Any edit, caret move or change of marks ends the hold, after the
          // appended transaction below has had its look at the edit.
          const changed = tr.docChanged || tr.selectionSet || tr.storedMarksSet
          return changed ? null : value
        }
        // The first transaction of a composition starts the hold, and the
        // later ones follow the text it composes.
        const marks = old.storedMarks
        const start =
          value?.id === id
            ? value
            : marks && type().isInSet(marks)
              ? { marks, id, from: old.selection.from, to: 0 }
              : null
        if (!start) return null
        // Where the composed text ends: past what this transaction added.
        let to = value?.id === id ? tr.mapping.map(start.to, 1) : start.from
        tr.mapping.maps.forEach((map, index) =>
          map.forEach((_from, _to, _start, end) => {
            to = Math.max(to, tr.mapping.slice(index + 1).map(end, 1))
          }),
        )
        return { ...start, to }
      },
    },
    view: (view) => {
      composing = view
      return {
        destroy() {
          composing = undefined
        },
      }
    },
    props: {
      handleDOMEvents: {
        compositionend(view) {
          // After the editor has read what was composed.
          setTimeout(() => {
            if (view.isDestroyed || view.composing) return
            const pending = held.getState(view.state)
            const tr = pending && finish(view.state, pending, type())
            // Part of the composition's undo step, so one Undo removes both.
            if (tr) view.dispatch(tr.setMeta('appendedTransaction', tr))
          })
          return false
        },
      },
    },
    appendTransaction(transactions, oldState, newState) {
      const code = type()
      // A key can arrive before the timer above runs; the first edit after the
      // composition then finishes it, so the text typed takes the code too.
      const pending = held.getState(oldState)
      if (pending && !composing?.composing) {
        const edit = ordinary(oldState.doc, transactions, pending)
        const tr = edit && finish(newState, pending, code, edit.end, edit.caret)
        if (tr) return tr
      }
      const stored = oldState.storedMarks
      if (
        !stored ||
        !code.isInSet(stored) ||
        composing?.composing ||
        transactions.some((tr) => tr.getMeta('composition'))
      )
        return null
      const { $from } = newState.selection
      // A code span never crosses blocks, so Enter ends the pending code.
      if ($from.start() !== oldState.selection.$from.start())
        return newState.storedMarks && code.isInSet(newState.storedMarks)
          ? newState.tr.setStoredMarks(code.removeFromSet(newState.storedMarks))
          : null
      // What is left before the caret after typing or a correction.
      const before = $from.nodeBefore
      if (
        newState.storedMarks ||
        !transactions.some((tr) => tr.docChanged) ||
        !newState.selection.empty ||
        !before?.isText ||
        !code.isInSet(before.marks)
      )
        return null
      return newState.tr.setStoredMarks(stored)
    },
  })
})
