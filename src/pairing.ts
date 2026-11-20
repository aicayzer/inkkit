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
 *   Closers are followed through every edit, so one the person typed or loaded is never stepped over.
 * - Backspace between an empty pair that pairing inserted removes both characters.
 * - A selection on one line is wrapped, and stays selected.
 */
export const pairBracketsCtx = $ctx<() => boolean, 'inkkitPairBrackets'>(
  () => false,
  'inkkitPairBrackets',
)

/** The positions of an opener and the closer that pairing inserted for it. */
interface Pair {
  open: number
  close: number
}

interface Change {
  add?: Pair
  /** A closer that was stepped over. */
  drop?: number
}

const pairs = new PluginKey<Pair[]>('inkkitPairing')

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
  return pairs
    .getState(state)
    ?.find(
      (pair) =>
        pair.close === close &&
        textAt(state, pair.close, pair.close + 1) !== '' &&
        closerFor(textAt(state, pair.open, pair.open + 1)) ===
          textAt(state, pair.close, pair.close + 1),
    )
}

/**
 * How many closers of `character` that pairing inserted follow `pos` directly, so that the
 * suggestion for `[[` takes the `]]` that went with its brackets.
 */
export function pairedClosers(
  state: EditorState,
  pos: number,
  character: string,
): number {
  let count = 0
  while (
    pairAt(state, pos + count) &&
    textAt(state, pos + count, pos + count + 1) === character
  )
    count++
  return count
}

export const pairing = [
  pairBracketsCtx,
  $prose((ctx) => {
    const on = () => ctx.get(pairBracketsCtx.key)()
    const smart = () => ctx.get(smartPunctuationCtx.key)()
    let typed: Typed | undefined
    let stepped: Stepped | undefined
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
      dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, pos + 1))
          .setMeta(pairs, { drop: pos } satisfies Change),
      )
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
      let oneLine = true
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

    const plugin: Plugin<Pair[]> = new Plugin<Pair[]>({
      key: pairs,
      state: {
        init: () => [],
        apply(tr, value) {
          const change = tr.getMeta(pairs) as Change | undefined
          let next = value
          if (tr.docChanged && next.length)
            next = next.flatMap(({ open, close }) => {
              const from = tr.mapping.mapResult(open, 1)
              const to = tr.mapping.mapResult(close, 1)
              return from.deleted || to.deleted
                ? []
                : [{ open: from.pos, close: to.pos }]
            })
          if (change?.drop !== undefined)
            next = next.filter((pair) => pair.close !== change.drop)
          if (change?.add) next = [...next, change.add]
          return next
        },
      },
      props: {
        handleTextInput(view, from, to, text) {
          typed = undefined
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
          if (
            event.key !== 'Backspace' ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            !active(view)
          )
            return false
          const { state } = view
          if (!state.selection.empty) return false
          const caret = state.selection.from
          const pair = pairAt(state, caret)
          if (!pair || pair.open !== caret - 1) return false
          view.dispatch(
            state.tr.delete(pair.open, pair.close + 1).scrollIntoView(),
          )
          return true
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
        )
          return newState.tr.setSelection(
            TextSelection.create(newState.doc, over.at + 1),
          )
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
        const tr = newState.tr.insertText(closer, caret)
        tr.setSelection(TextSelection.create(tr.doc, caret))
        return tr.setMeta(pairs, {
          add: { open: pending.from, close: caret },
        } satisfies Change)
      },
    })
    return plugin
  }),
].flat()
