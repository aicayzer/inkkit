import { inlineCodeSchema } from '@milkdown/kit/preset/commonmark'
import type { Mark, MarkType } from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
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
// composition ends the code is put on all the composed text and stored again.
interface Held {
  marks: readonly Mark[]
  // Where the composition started.
  from: number
}
const held = new PluginKey<Held | null>('storedInlineCode')

// Puts the code on everything composed, up to the caret, and stores the marks
// for what is typed next. Nothing, where the caret has moved on.
function finish(
  state: EditorState,
  pending: Held,
  code: MarkType,
): Transaction | null {
  const { selection } = state
  if (
    state.storedMarks ||
    !selection.empty ||
    !state.doc.resolve(pending.from).sameParent(selection.$from)
  )
    return null
  const tr = state.tr
  if (pending.from < selection.from)
    tr.addMark(pending.from, selection.from, code.create())
  return tr.setStoredMarks(pending.marks)
}

export const storedInlineCode = $prose((ctx) => {
  const type = () => inlineCodeSchema.type(ctx)
  let composing: EditorView | undefined
  return new Plugin<Held | null>({
    key: held,
    state: {
      init: () => null,
      apply(tr, value, old) {
        const composed = Boolean(tr.getMeta('composition'))
        if (tr.storedMarksSet || (tr.selectionSet && !composed)) return null
        if (value) return { ...value, from: tr.mapping.map(value.from, -1) }
        return composed && old.storedMarks && type().isInSet(old.storedMarks)
          ? { marks: old.storedMarks, from: old.selection.from }
          : null
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
      // composition then finishes it, so the typed text takes the code too.
      const pending = held.getState(oldState)
      if (
        pending &&
        !composing?.composing &&
        !transactions.some((tr) => tr.getMeta('composition')) &&
        transactions.some((tr) => tr.docChanged)
      ) {
        const tr = finish(
          newState,
          {
            ...pending,
            from: transactions.reduce(
              (pos, step) => step.mapping.map(pos, -1),
              pending.from,
            ),
          },
          code,
        )
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
