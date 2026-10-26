import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type StateField,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model'
import { StepMap } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { chunkState, insertedHyphen } from './smart-punctuation'

const isInputRules = (plugin: Plugin) =>
  (plugin.spec as { isInputRules?: boolean }).isInputRules === true

// The link whose text every character from `from` to `to` belongs to.
function heldLink(doc: ProseNode, from: number, to: number): Mark | undefined {
  const type = doc.type.schema.marks.link
  if (!type) return undefined
  let link: Mark | undefined
  let whole = true
  doc.nodesBetween(from, to, (node) => {
    if (!node.isInline) return true
    const own = type.isInSet(node.marks)
    if (!own || (link && !own.eq(link))) whole = false
    link ??= own
    return false
  })
  return whole ? link : undefined
}

/**
 * The marks that text put in place of `from` to `to` takes. Links are not
 * inclusive, so text typed at either end of a link stays outside it, but text
 * that replaces part or all of one link's text stays in that link. Marks
 * stored for the selection, such as a link started at the caret, come first.
 */
export function replacementMarks(
  state: EditorState,
  from: number,
  to: number,
): readonly Mark[] {
  const { doc, selection, storedMarks } = state
  if (storedMarks && selection.from === from && selection.to === to)
    return storedMarks
  const $from = doc.resolve(from)
  if (from === to) return $from.marks()
  const $to = doc.resolve(to)
  const marks = $from.marksAcross($to) ?? $from.marks()
  const link = $from.sameParent($to) ? heldLink(doc, from, to) : undefined
  return link && !link.isInSet(marks) ? link.addToSet(marks) : marks
}

/**
 * The link that typing over its end continues, after typing replaced the end
 * or all of its text. Its stored marks keep it for the next keystrokes until
 * the caret moves or another edit clears them.
 */
const typingKey = new PluginKey<Mark | null>('inkkitTextInput')
const typingState: StateField<Mark | null> = {
  init: () => null,
  apply(tr, link, _old, state) {
    const meta = tr.getMeta(typingKey) as Mark | null | undefined
    if (meta !== undefined) return meta
    return link && link.isInSet(state.storedMarks ?? []) ? link : null
  },
}

interface LinkTyping {
  marks: readonly Mark[]
  link: Mark
  // How much of the text belongs to the link.
  linked: number
  // The marks for the text typed next, and whether they continue a link
  // whose text typing replaced. An address's link follows its text, which
  // the autolink plugin reads, so typing does not continue it.
  stored: readonly Mark[] | null
  retyped: boolean
}

// How typed text continues a link that the caret's position alone would
// leave: a link started at the caret, which ends at the first whitespace, or
// a link whose end or whole text the typing replaces or continues replacing.
function linkTyping(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): LinkTyping | undefined {
  const type = state.schema.marks.link
  if (!type) return undefined
  const marks = replacementMarks(state, from, to)
  const link = type.isInSet(marks)
  if (!link) return undefined
  const stored = type.isInSet(state.storedMarks ?? [])
  const continued = typingKey.getState(state)
  const retyped =
    (stored !== undefined && continued?.eq(stored)) ||
    (from < to &&
      !type.isInSet(
        state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? [],
      ))
  if (!retyped && !stored) return undefined
  const space = retyped ? -1 : text.search(/\s/)
  const linked = space < 0 ? text.length : space
  const address = link.attrs.form != null
  return {
    marks,
    link,
    linked,
    stored: address
      ? null
      : linked < text.length
        ? link.removeFromSet(marks)
        : marks,
    retyped: retyped && !address,
  }
}

// Gives the text inserted at `from` the link the typing keeps, and stores
// the marks for the text typed next.
function continueLink(
  tr: Transaction,
  from: number,
  text: string,
  typing: LinkTyping,
): Transaction {
  const linked = Math.min(typing.linked, text.length)
  tr.removeMark(from, from + text.length, typing.link.type)
  if (linked) tr.addMark(from, from + linked, typing.link)
  if (typing.stored) tr.setStoredMarks(typing.stored)
  return tr.setMeta(typingKey, typing.retyped ? typing.link : null)
}

/**
 * Inserts typed text at `from` to `to`, and returns whether it did. It handles
 * text that arrives in one piece, such as buffered native typing, dictation or
 * a text replacement, and typing that continues a link.
 *
 * Input rules are written for one typed character: Milkdown's take their
 * positions from the document before the text goes in, so given more than
 * one character they mark or delete text before the insertion. The text goes
 * in except for its last character, and the input rules see that character
 * typed after the rest, all in one transaction.
 */
function insertTypedText(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  deflt: () => Transaction,
): boolean {
  const characters = Array.from(text)
  if (!characters.length || view.composing || /[\r\n]/.test(text)) return false
  const { state } = view
  const typing = linkTyping(state, from, to, text)
  if (characters.length < 2 && !typing) return false
  const fallback = () => {
    const plain = deflt()
    return typing ? continueLink(plain, from, text, typing) : plain
  }
  const marks = typing?.marks ?? replacementMarks(state, from, to)
  const last = characters.at(-1)!
  const rest = text.slice(0, -last.length)
  // The rest of the text goes in without input rules, joining blocks
  // where the range spans them, and the last character goes after it.
  const tr = rest
    ? state.tr.setStoredMarks(marks).insertText(rest, from, to)
    : state.tr.delete(from, to)
  if (typing) continueLink(tr, from, rest, typing)
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
    view.dispatch(fallback().scrollIntoView())
    return true
  }
  const rules = state.plugins.filter(isInputRules)
  const prepared = chunkState(
    state,
    {
      schema: state.schema,
      doc: tr.doc,
      selection: TextSelection.create(tr.doc, at),
      // The marks the rest of the text took, which the last character would
      // take too, unless a link ended before it.
      storedMarks:
        typing && typing.linked < text.length
          ? typing.link.removeFromSet(marks)
          : marks,
    },
    rest,
  )
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
    const plain = fallback().scrollIntoView()
    // A hyphen that ends the text counts as the one just typed.
    view.dispatch(last === '-' ? insertedHyphen(plain) : plain)
    return true
  }
  if (ruled) {
    for (const step of ruled.steps) tr.step(step)
    tr.setSelection(ruled.selection.map(tr.doc, StepMap.empty))
    if (ruled.storedMarksSet) tr.setStoredMarks(ruled.storedMarks)
    else if (typing?.stored) tr.setStoredMarks(typing.stored)
    // What lets Backspace undo the rule, as after a typed character.
    for (const rule of rules) {
      const meta: unknown = ruled.getMeta(rule)
      if (meta !== undefined) tr.setMeta(rule, meta)
    }
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

// A composition the link rule applies to: where it started, mapped through
// the edits since, and the link its text takes.
interface Composing {
  link: Mark
  retyped: boolean
  start: number
  doc: ProseNode
  composition?: unknown
}

// ProseMirror wraps text composed at a caret in the stored marks, but text
// composed over a selection, or after the first update, takes the marks of
// the text it replaces, which a link at its end does not give. Changing the
// marks while composing would end the composition, so the link is given to
// the composed text once it ends, in the same undo step.
function finishComposition(view: EditorView, composing: Composing): void {
  const { state } = view
  const { start, link, retyped } = composing
  const end = state.selection.head
  if (
    view.isDestroyed ||
    view.composing ||
    state.doc !== composing.doc ||
    !state.selection.empty ||
    end <= start ||
    !state.doc.resolve(start).sameParent(state.selection.$head)
  )
    return
  const text = state.doc.textBetween(start, end)
  if (text.length !== end - start) return
  const space = retyped ? -1 : text.search(/\s/)
  const linked = start + (space < 0 ? text.length : space)
  const tr = state.tr
  if (linked > start) tr.addMark(start, linked, link)
  const marks = link.type.removeFromSet(tr.doc.resolve(end).marks())
  tr.setStoredMarks(linked === end ? link.addToSet(marks) : marks)
    .setMeta(typingKey, retyped && linked === end ? link : null)
    .setMeta('composition', composing.composition)
  view.dispatch(tr)
}

// A control chord that nothing handles reaches the page as its ASCII control
// character (Control-N as U+000E), which the web view would insert as text.
const controlCharacters = /^[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+$/

/** Typed text: chunks, control characters, and the link rule for typing and composition. */
export function textInputPlugin(): Plugin {
  let composing: Composing | undefined
  return new Plugin({
    key: typingKey,
    state: typingState,
    props: {
      handleTextInput: (view, from, to, text, deflt) =>
        controlCharacters.test(text) ||
        insertTypedText(view, from, to, text, deflt),
      handleDOMEvents: {
        compositionstart(view) {
          if (view.composing) return false
          const { state } = view
          const { from, to } = state.selection
          const typing = linkTyping(state, from, to, '')
          composing =
            typing?.stored && !view.isDestroyed
              ? {
                  link: typing.link,
                  retyped: typing.retyped,
                  start: from,
                  doc: state.doc,
                }
              : undefined
          return false
        },
        compositionend(view) {
          const ended = composing
          // After ProseMirror has read the composed text.
          if (ended)
            setTimeout(() => {
              if (composing !== ended) return
              composing = undefined
              finishComposition(view, ended)
            })
          return false
        },
      },
    },
    appendTransaction(transactions, _old, state) {
      if (composing && transactions.some((tr) => tr.docChanged)) {
        for (const tr of transactions) {
          composing.start = tr.mapping.map(composing.start, -1)
          composing.composition ??= tr.getMeta('composition')
        }
      }
      if (composing) composing.doc = state.doc
      return null
    },
  })
}
