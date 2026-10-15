import {
  EditorState,
  Selection,
  TextSelection,
  type Plugin,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { StepMap } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { receivedHyphenWithNext } from './smart-punctuation'

const isInputRules = (plugin: Plugin) =>
  (plugin.spec as { isInputRules?: boolean }).isInputRules === true

/**
 * Inserts text that arrives in one piece, such as buffered native typing,
 * dictation or a text replacement, at `from` to `to`, and returns whether it
 * did.
 *
 * Input rules are written for one typed character: Milkdown's take their
 * positions from the document before the text goes in, so given more than
 * one character they mark or delete text before the insertion. The text goes
 * in except for its last character, and the input rules see that character
 * typed after the rest, all in one transaction.
 */
export function insertTextChunk(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  deflt: () => Transaction,
): boolean {
  const characters = Array.from(text)
  if (characters.length < 2 || view.composing || /[\r\n]/.test(text))
    return false
  const { state } = view
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  const last = characters.at(-1)!
  const rest = text.slice(0, -last.length)
  // The rest of the text goes in without input rules, joining blocks
  // where the range spans them, and the last character goes after it.
  const tr = state.tr.insertText(rest, from, to)
  const $at = Selection.near(tr.doc.resolve(tr.mapping.map(to)), -1).$head
  const at = $at.pos
  if (
    !$at.parent.inlineContent ||
    $at.parent.type.spec.code ||
    $at.parentOffset < rest.length ||
    $at.parent.textBetween($at.parentOffset - rest.length, $at.parentOffset) !==
      rest
  ) {
    // Where the rest did not land as text before a caret, as in code, no
    // input rule runs.
    view.dispatch(deflt().scrollIntoView())
    return true
  }
  const rules = state.plugins.filter(isInputRules)
  const prepared = EditorState.create({
    schema: state.schema,
    doc: tr.doc,
    selection: TextSelection.create(tr.doc, at),
    // The marks the rest of the text took, which the last character would
    // take too.
    storedMarks:
      state.storedMarks ??
      (from === to ? $from.marks() : $from.marksAcross($to)),
  })
  // The hyphen that ends the rest is received with the last character, as one input.
  if (rest.endsWith('-')) receivedHyphenWithNext(prepared)
  let ruled: Transaction | undefined
  // Input rules read the state from the view they are given and dispatch to
  // it, so they are given the state with the rest of the text in place.
  const preparedView = Object.create(view, {
    state: { value: prepared },
    dispatch: {
      value: (transaction: Transaction) => {
        ruled = transaction
      },
    },
  }) as EditorView
  const handled = rules.some((rule) =>
    rule.props.handleTextInput?.call(rule, preparedView, at, at, last, () =>
      prepared.tr.insertText(last, at),
    ),
  )
  if (!handled) {
    view.dispatch(deflt().scrollIntoView())
    return true
  }
  if (ruled) {
    for (const step of ruled.steps) tr.step(step)
    tr.setSelection(ruled.selection.map(tr.doc, StepMap.empty))
    if (ruled.storedMarksSet) tr.setStoredMarks(ruled.storedMarks)
    // What lets Backspace undo the rule, as after a typed character.
    for (const rule of rules) {
      const meta: unknown = ruled.getMeta(rule)
      if (meta !== undefined) tr.setMeta(rule, meta)
    }
  }
  view.dispatch(tr.scrollIntoView())
  return true
}
