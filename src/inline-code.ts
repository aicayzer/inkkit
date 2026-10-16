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
// composition ends the code is put on the composed text and stored again.
// ProseMirror reads the last of the composed text in a microtask after
// `compositionend`, and only if the browser had not reported it already, so no
// transaction is certain to follow. The marks are finished in a microtask
// queued behind that read instead. No key or paste is handled between them.
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
// next. Nothing, where the caret is not at the end of the composed text.
function finish(
  state: EditorState,
  pending: Held,
  code: MarkType,
): Transaction | null {
  const { selection } = state
  if (state.storedMarks || !selection.empty || selection.from !== pending.to)
    return null
  const tr = state.tr
  if (pending.from < pending.to)
    tr.addMark(pending.from, pending.to, code.create())
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
          // Behind the read that ProseMirror queues after this handler.
          void Promise.resolve()
            .then(() => undefined)
            .then(() => {
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
