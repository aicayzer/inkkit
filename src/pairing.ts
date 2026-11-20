import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $ctx, $prose } from '@milkdown/kit/utils'
import { closerOf, pairsBefore, quoteMayPair } from './source-typing'
import {
  curlyCloser,
  curlyCloses,
  smartPunctuationCtx,
  smartQuotePair,
} from './smart-punctuation'

/**
 * Bracket pairing in formatted mode: typing `(`, `[`, `{`, `"` or `'` also inserts its closer.
 *
 * - The character is typed as it would be without pairing, so input rules, smart punctuation and
 *   the `[[` and `/` suggestions see it. The closer follows in the same history step, after the
 *   transaction that typed the opener, and only when the opener is the character that was typed:
 *   a curly quote that smart punctuation made pairs, and a closing curly quote does not.
 * - A closer typed straight before a closer that pairing inserted steps over it, by typing over
 *   it, so that a rule such as the one that turns `[[name]]` into a link still sees the character.
 *   Pairs are tracked strictly: one stays valid only through typing inside it. A load, paste, drop,
 *   undo, redo, replace or other host call, a mode switch and a change of preference forget every
 *   pair, so the brackets that remain are ordinary characters, and a closer the person typed or
 *   loaded is never stepped over.
 * - Backspace between an empty pair that pairing inserted removes both characters, whether it
 *   arrives as a key or as an input event on its own.
 * - A selection on one line is wrapped, and stays selected. Replacing a selection through an input
 *   event that is not typing, such as a replacement from a spelling menu, never pairs or wraps.
 */
export const pairBracketsCtx = $ctx<() => boolean, 'inkkitPairBrackets'>(
  () => false,
  'inkkitPairBrackets',
)

/** A number that changes when every tracked pair is to be forgotten, as on a mode switch. */
export const pairEpochCtx = $ctx<() => number, 'inkkitPairEpoch'>(
  () => 0,
  'inkkitPairEpoch',
)

/** The positions of an opener and the closer that pairing inserted for it. */
interface Pair {
  open: number
  close: number
  epoch: number
}

interface Change {
  add?: Pair
  /** A closer that was stepped over. */
  drop?: number
  /** Forget every pair. */
  clear?: boolean
}

/** The pairs that pairing inserted and still tracks, and the reader of the current epoch. */
interface Tracked {
  list: Pair[]
  epoch(): number
}

const pairs = new PluginKey<Tracked>('inkkitPairing')

/** Marks `tr` as an edit that is not typing, so that pairing forgets the pairs it tracks. */
export function forgetPairs(tr: Transaction): Transaction {
  return tr.setMeta(pairs, { clear: true } satisfies Change)
}

/** A paste, drop or cut is not typing. */
const notTyping = new Set(['paste', 'drop', 'cut'])

/**
 * The pair as it stands after `tr`, or undefined when `tr` did more than type inside it: every
 * change must lie between its opener and its closer, with the closer's own position included.
 */
function followed(tr: Transaction, pair: Pair): Pair | undefined {
  let { open, close } = pair
  for (const step of tr.steps) {
    const map = step.getMap()
    let inside = true
    map.forEach((from, to) => {
      if (from < open + 1 || to > close) inside = false
    })
    if (!inside) return undefined
    const opened = map.mapResult(open, -1)
    const closed = map.mapResult(close, 1)
    if (opened.deleted || closed.deleted) return undefined
    open = opened.pos
    close = closed.pos
  }
  return { ...pair, open, close }
}

interface Typed {
  doc: ProseNode
  from: number
}

/** A closer that was typed over, where the caret should end up when a rule has replaced it. */
interface Stepped {
  doc: ProseNode
  at: number
}

function characterBefore(state: EditorState, pos: number): string | undefined {
  const text = state.doc.resolve(pos).nodeBefore?.text
  return text === undefined ? undefined : Array.from(text).at(-1)
}

/** The character after `pos` on the line, or undefined at its end. Another kind of node is a
 *  character that is not white space. */
function characterAfter(state: EditorState, pos: number): string | undefined {
  const node = state.doc.resolve(pos).nodeAfter
  if (!node) return undefined
  if (node.type.name === 'hardbreak') return undefined
  if (!node.isText) return '\ufffc'
  return String.fromCodePoint(node.text!.codePointAt(0)!)
}

/** The closer for an opener, as a straight or a curly character, or undefined for a character
 *  that does not open a pair. */
function closerFor(opener: string): string | undefined {
  return closerOf(opener) ?? curlyCloser(opener)
}

/** Whether `closer` is the character that a closer `typed` stands for. */
function closes(typed: string, closer: string): boolean {
  return typed === closer || curlyCloses(typed, closer)
}

function textAt(state: EditorState, from: number, to: number): string {
  return state.doc.textBetween(from, to, '\n', '\ufffc')
}

/** The pair whose closer is the character at `close`, when both its characters are still there. */
function pairAt(state: EditorState, close: number): Pair | undefined {
  const tracked = pairs.getState(state)
  return tracked?.list.find(
    (pair) =>
      pair.epoch === tracked.epoch() &&
      pair.close === close &&
      textAt(state, pair.close, pair.close + 1) !== '' &&
      closerFor(textAt(state, pair.open, pair.open + 1)) ===
        textAt(state, pair.close, pair.close + 1),
  )
}

/**
 * How many closers that pairing inserted for the openers at `openers`, which are given from the
 * innermost out, follow `caret` directly. A closer that belongs to an outer bracket is not one.
 */
export function pairedClosers(
  state: EditorState,
  caret: number,
  openers: readonly number[],
): number {
  let count = 0
  for (const open of openers) {
    const pair = pairAt(state, caret + count)
    if (
      pair?.open === open &&
      textAt(state, caret + count, caret + count + 1) === ']'
    )
      count++
  }
  return count
}

/** An input event that arrived before its change to the document, and the document it found. */
interface Input {
  type: string
  doc: ProseNode
}

export const pairing = [
  pairBracketsCtx,
  pairEpochCtx,
  $prose((ctx) => {
    const on = () => ctx.get(pairBracketsCtx.key)()
    const epoch = () => ctx.get(pairEpochCtx.key)()
    const smart = () => ctx.get(smartPunctuationCtx.key)()
    let typed: Typed | undefined
    let stepped: Stepped | undefined
    let input: Input | undefined
    // Whether the person can type here, with no composition and pairing on.
    const active = (view: EditorView) =>
      on() && view.editable && !view.composing

    function stepOver(
      view: EditorView,
      pos: number,
      character: string,
      handler: unknown,
    ): boolean {
      const { state } = view
      const pair = pairAt(state, pos)
      if (!pair || !closes(character, textAt(state, pos, pos + 1))) return false
      const dispatch = (tr: Transaction) => view.dispatch(tr.scrollIntoView())
      stepped = { doc: state.doc, at: pos }
      // Typed over the closer, so rules that read the character before the caret still run.
      const handled = view.someProp(
        'handleTextInput',
        (other) =>
          other !== handler &&
          other(view, pos, pos + 1, character, () =>
            state.tr.insertText(character, pos, pos + 1),
          ),
      )
      if (handled) return true
      stepped = undefined
      const tr = state.tr
        .setSelection(TextSelection.create(state.doc, pos + 1))
        .setMeta(pairs, { drop: pos } satisfies Change)
      // The marks stored for the next character stay, as they do when a character is typed.
      if (state.storedMarks) tr.setStoredMarks(state.storedMarks)
      dispatch(tr)
      return true
    }

    function wrap(
      view: EditorView,
      from: number,
      to: number,
      character: string,
      closer: string,
    ): boolean {
      const { state } = view
      const $from = state.doc.resolve(from)
      if (
        !$from.sameParent(state.doc.resolve(to)) ||
        !$from.parent.inlineContent
      )
        return false
      // A line break, or a line end in the text of a code block, makes the selection more than one line.
      let oneLine = !/[\r\n]/.test(textAt(state, from, to))
      state.doc.nodesBetween(from, to, (node) => {
        if (node.type.name === 'hardbreak') oneLine = false
      })
      if (!oneLine) return false
      const curly = smartQuotePair(smart, state, from, character)
      const [opening, closing] = curly ?? [character, closer]
      const tr = state.tr.insertText(closing, to).insertText(opening, from)
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          from + opening.length,
          to + opening.length,
        ),
      )
      view.dispatch(tr.scrollIntoView())
      return true
    }

    /** Removes both characters of an empty pair that pairing inserted, when the caret is between them. */
    function removePair(view: EditorView): boolean {
      if (!active(view)) return false
      const { state } = view
      if (!state.selection.empty) return false
      const caret = state.selection.from
      const pair = pairAt(state, caret)
      if (!pair || pair.open !== caret - 1) return false
      view.dispatch(state.tr.delete(pair.open, pair.close + 1).scrollIntoView())
      return true
    }

    const plugin: Plugin<Tracked> = new Plugin<Tracked>({
      key: pairs,
      state: {
        init: () => ({ list: [], epoch }),
        apply(tr, value) {
          const change = tr.getMeta(pairs) as Change | undefined
          let list = value.list
          if (tr.docChanged && list.length) {
            // Only typing inside a pair keeps it. A paste, a drop, a cut and an undo or redo do not.
            const typing =
              !change?.clear &&
              !notTyping.has(tr.getMeta('uiEvent') as string) &&
              tr.getMeta('addToHistory') !== false
            list = typing
              ? list.flatMap((pair) => followed(tr, pair) ?? [])
              : []
          }
          if (change?.clear) list = []
          if (change?.drop !== undefined)
            list = list.filter((pair) => pair.close !== change.drop)
          if (change?.add) list = [...list, change.add]
          return list === value.list ? value : { ...value, list }
        },
      },
      props: {
        handleTextInput(view, from, to, text) {
          typed = undefined
          // Typing arrives as `insertText`. A replacement from a spelling menu, or any other input
          // that is not typing, puts its text in as it is.
          if (
            input &&
            input.type !== 'insertText' &&
            input.doc === view.state.doc
          )
            return false
          if (!active(view) || Array.from(text).length !== 1) return false
          if (
            from === to &&
            stepOver(view, from, text, plugin.props.handleTextInput)
          )
            return true
          const closer = closerOf(text)
          if (closer === undefined) return false
          if (from !== to) return wrap(view, from, to, text, closer)
          const { state } = view
          const quote = text === '"' || text === "'"
          if (
            pairsBefore(characterAfter(state, from)) &&
            (!quote || quoteMayPair(characterBefore(state, from)))
          )
            typed = { doc: state.doc, from }
          return false
        },
        handleKeyDown(view, event) {
          input = undefined
          if (
            event.key !== 'Backspace' ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey
          )
            return false
          return removePair(view)
        },
        handleDOMEvents: {
          // Input that arrives without a key, as on iOS and with some input methods.
          beforeinput(view, event) {
            const { inputType } = event as InputEvent
            input = { type: inputType, doc: view.state.doc }
            if (inputType === 'deleteContentBackward' && removePair(view)) {
              event.preventDefault()
              return true
            }
            return false
          },
        },
      },
      appendTransaction(transactions, oldState, newState) {
        const pending = typed
        const over = stepped
        typed = undefined
        stepped = undefined
        // A rule that replaced the closer leaves the caret before the character it wrote, where
        // typing a character that no rule changes leaves it after.
        if (
          over &&
          oldState.doc === over.doc &&
          newState.selection.empty &&
          newState.selection.from === over.at &&
          transactions.some((tr) => tr.docChanged)
        ) {
          const tr = newState.tr.setSelection(
            TextSelection.create(newState.doc, over.at + 1),
          )
          // The marks stored for the next character stay, as they do for typed text.
          return newState.storedMarks
            ? tr.setStoredMarks(newState.storedMarks)
            : tr
        }
        if (
          !pending ||
          oldState.doc !== pending.doc ||
          !transactions.some((tr) => tr.docChanged) ||
          transactions.some((tr) => tr.getMeta('composition') !== undefined)
        )
          return null
        const { selection } = newState
        const caret = pending.from + 1
        if (!selection.empty || selection.from !== caret) return null
        const opener = textAt(newState, pending.from, caret)
        const closer = closerFor(opener)
        if (closer === undefined) return null
        // The closer takes the marks the opener was typed with, which a link, being not inclusive,
        // would not give it from the text around, and the marks stored for the next character stay
        // stored, so that a link or style continues across the pair.
        const marks = newState.doc.resolve(caret).nodeBefore?.marks
        const stored = newState.storedMarks
        const tr = newState.tr.replaceWith(
          caret,
          caret,
          newState.schema.text(closer, marks),
        )
        tr.setSelection(TextSelection.create(tr.doc, caret))
        if (stored) tr.setStoredMarks(stored)
        return tr.setMeta(pairs, {
          add: { open: pending.from, close: caret, epoch: epoch() },
        } satisfies Change)
      },
    })
    return plugin
  }),
].flat()
