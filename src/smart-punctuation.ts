import { InputRule, undoInputRule } from '@milkdown/kit/prose/inputrules'
import {
  Plugin,
  PluginKey,
  type Command,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { ReplaceStep } from '@milkdown/kit/prose/transform'
import { $ctx, $inputRule, $prose } from '@milkdown/kit/utils'

/**
 * Smart punctuation: the quote or dash being typed becomes a curly quote or a dash.
 *
 * - `"` and `'` open after the start of a block, a line break, whitespace, an opening bracket, a
 *   dash or another opening quote, and close everywhere else. A `'` between letters is an
 *   apostrophe, which is the closing form.
 * - `--` gives an en dash and `---` an em dash: the third hyphen turns the en dash that the second
 *   one made into an em dash. Only a hyphen that text input has just inserted counts as the first
 *   of the two, so a hyphen already in the note, or typed before the caret moved, stays one.
 * - A quote that a dead key made arrives as a composition. When the composition commits exactly
 *   that quote at the caret, it follows the same rules.
 *
 * These are input rules, so only the character being typed changes, Backspace and Undo straight
 * after restore what was typed, and nothing in a note is rewritten. The editor answers
 * `smartPunctuationCtx` with the current option, so turning it on or off needs no new editor.
 */
export const smartPunctuationCtx = $ctx<
  () => boolean,
  'inkkitSmartPunctuation'
>(() => false, 'inkkitSmartPunctuation')

/** Set on the transaction of each rule that this file makes. */
const smartRule = 'inkkitSmartPunctuation'

const enDash = '\u2013'
const emDash = '\u2014'

/** What may come before a quote for it to open. */
const opensAfter = /[\s([{<\u2013\u2014\u2018\u201C]/u

/**
 * Markdown that a person is typing out in a line of text, not words: a code span, a link
 * destination, a web address, a wiki link or footnote label, an HTML tag or comment and a
 * reference definition. Smart punctuation leaves a line alone while one is open, because the
 * curly character would change what the Markdown means.
 */
const typingSyntax = [
  // An odd number of backtick runs: a code span is open.
  (before: string) => (before.match(/`+/g)?.length ?? 0) % 2 === 1,
  // The destination and title of a link.
  (before: string) => /\]\([^)]*$/.test(before),
  (before: string) => /\[\[[^\]]*$/.test(before),
  (before: string) => /\[\^[^\]]*$/.test(before),
  // The word being typed is a web address.
  (before: string) =>
    /(?:^|[^\w])(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)\S*$/i.test(before),
  // A tag opens a word; `a<b` is not one.
  (before: string) => /(?:^|[^\w])<[A-Za-z!/?][^>]*$/.test(before),
  (before: string) => /^\s*\[[^\]]+\]:/.test(before),
]

/**
 * The text of the block before `pos`, with each code span and each non-text node as one
 * placeholder, so that a backtick or `<` inside code is not syntax being typed.
 */
function textBefore(state: EditorState, pos: number): string {
  const $pos = state.doc.resolve(pos)
  let text = ''
  $pos.parent.forEach((child, offset) => {
    if (offset >= $pos.parentOffset) return
    text +=
      child.isText && !child.marks.some((mark) => mark.type.spec.code)
        ? child.text!.slice(0, $pos.parentOffset - offset)
        : '\ufffc'
  })
  return text
}

/**
 * What the editor has seen of the input that leads to the next rule. It is changed as
 * transactions and events arrive, and any transaction other than the one input makes clears it.
 */
interface Input {
  /** Where a `-` that text input is about to insert will go. */
  pending: number | null
  /** The position after a hyphen that text input has just inserted. */
  hyphen: number | null
  /** The caret when a composition started, and the document's size then. */
  composition: { pos: number; size: number } | null
  /** The position after a lone quote that a composition has just committed. */
  composedQuote: number | null
}

const input = new PluginKey<Input>('inkkitSmartPunctuationInput')

/** The text a transaction inserted, when it is one step that inserts text at `at` and nothing else. */
function insertedAt(tr: Transaction, at: number): string | undefined {
  const [step] = tr.steps
  if (tr.steps.length !== 1 || !(step instanceof ReplaceStep)) return undefined
  if (step.from !== at || step.slice.openStart || step.slice.openEnd)
    return undefined
  return step.slice.content.textBetween(0, step.slice.content.size)
}

const inputTracking = $prose(
  () =>
    new Plugin<Input>({
      key: input,
      state: {
        init: () => ({
          pending: null,
          hyphen: null,
          composition: null,
          composedQuote: null,
        }),
        apply(tr, value) {
          const { pending, composition } = value
          value.pending = value.hyphen = value.composedQuote = null
          if (!tr.docChanged) return value
          if (pending !== null && insertedAt(tr, pending) === '-')
            value.hyphen = pending + 1
          if (composition) {
            value.composition = null
            const text = insertedAt(tr, composition.pos)
            if (
              (text === '"' || text === "'") &&
              tr.doc.content.size === composition.size + 1
            )
              value.composedQuote = composition.pos + 1
          }
          return value
        },
      },
      props: {
        handleTextInput(view, from, _to, text) {
          input.getState(view.state)!.pending = text === '-' ? from : null
          return false
        },
        handleDOMEvents: {
          compositionstart(view) {
            const { from, empty } = view.state.selection
            input.getState(view.state)!.composition = empty
              ? { pos: from, size: view.state.doc.content.size }
              : null
            return false
          },
        },
      },
    }),
)

/** States of text that arrived in one piece, whose last hyphen follows one that came with it. */
const hyphenInChunk = new WeakSet<EditorState>()

/** Tells the rules that the hyphen before the caret came in the same piece as the one being typed. */
export function receivedHyphenWithNext(state: EditorState): void {
  hyphenInChunk.add(state)
}

/**
 * Whether a rule may change what `match` found at `pos`: the option is on, the last character of
 * the match is the one being typed, which is not in the document yet, and the text is ordinary,
 * with no Markdown being typed. The input rules plugin also runs every rule when a composition
 * ends, over text that is all in the document; that is not typing, and is left alone.
 */
function applies(
  on: () => boolean,
  state: EditorState,
  match: RegExpMatchArray,
  pos: number,
): boolean {
  if (!on()) return false
  const typed = pos + match[0].length - 1 === state.selection.from
  // A composition that committed a lone quote is in the document by the time its rule runs.
  const composed =
    !typed &&
    match[0].length === 1 &&
    input.getState(state)?.composedQuote === state.selection.from &&
    pos === state.selection.from - 1
  if (!typed && !composed) return false
  const $pos = state.doc.resolve(pos)
  if ($pos.parent.type.spec.code || !$pos.parent.inlineContent) return false
  // The marks the typed character takes: stored ones, such as code switched on at a caret, or
  // those of the text at the caret.
  const marks = state.storedMarks ?? $pos.marks()
  if (marks.some((mark) => mark.type.spec.code)) return false
  const before = textBefore(state, pos)
  return !typingSyntax.some((open) => open(before))
}

function opensHere(state: EditorState, pos: number): boolean {
  const node = state.doc.resolve(pos).nodeBefore
  if (!node) return true
  if (node.isText) {
    const text = node.text ?? ''
    return opensAfter.test(
      String.fromCodePoint(text.codePointAt(text.length - 1)!),
    )
  }
  return node.type.name === 'hardbreak'
}

/** The input rule that ran at the last change, when nothing has happened since. */
function lastRule(
  state: EditorState,
): { transform: Transaction; from: number } | undefined {
  for (const plugin of state.plugins)
    if ((plugin.spec as { isInputRules?: boolean }).isInputRules) {
      const stored = plugin.getState(state) as
        { transform: Transaction; from: number } | null | undefined
      if (stored) return stored
    }
  return undefined
}

const quotes: Record<string, [opening: string, closing: string]> = {
  '"': ['\u201C', '\u201D'],
  "'": ['\u2018', '\u2019'],
}

export const smartPunctuation = [
  smartPunctuationCtx,
  inputTracking,
  $inputRule(
    (ctx) =>
      new InputRule(
        /["']$/,
        (state, match, start, end) => {
          if (!applies(ctx.get(smartPunctuationCtx.key), state, match, start))
            return null
          const [opening, closing] = quotes[match[0]!]!
          return state.tr
            .insertText(opensHere(state, start) ? opening : closing, start, end)
            .setMeta(smartRule, 'quote')
        },
        { inCodeMark: false },
      ),
  ),
  $inputRule(
    (ctx) =>
      new InputRule(
        /--$/,
        (state, match, start, end) => {
          if (!applies(ctx.get(smartPunctuationCtx.key), state, match, start))
            return null
          // The hyphen before the caret must be the one text input just inserted.
          if (
            input.getState(state)?.hyphen !== state.selection.from &&
            !hyphenInChunk.has(state)
          )
            return null
          const before = textBefore(state, start)
          // At the start of a block `--` may become the divider `---`, and a hyphen run is not a
          // dash.
          if (!before.trim() || before.endsWith('-') || /^\s*\|/.test(before))
            return null
          return state.tr
            .insertText(enDash, start, end)
            .setMeta(smartRule, 'en')
        },
        { inCodeMark: false },
      ),
  ),
  $inputRule(
    (ctx) =>
      new InputRule(
        /\u2013-$/,
        (state, match, start, end) => {
          if (!applies(ctx.get(smartPunctuationCtx.key), state, match, start))
            return null
          // Only the en dash that the previous keystroke made.
          if (lastRule(state)?.transform.getMeta(smartRule) !== 'en')
            return null
          return state.tr
            .insertText(emDash, start, end)
            .setMeta(smartRule, 'em')
        },
        { inCodeMark: false },
      ),
  ),
].flat()

/**
 * Undo straight after a smart quote or dash puts back the character that was typed, as Backspace
 * does for any input rule. The replacement joins the typing's history step, so the next Undo
 * removes the typing and not the curly character. Returns whether it applied.
 */
export const undoSmartPunctuation: Command = (state, dispatch) => {
  const rule = lastRule(state)
  if (!rule?.transform.getMeta(smartRule)) return false
  return undoInputRule(
    state,
    dispatch &&
      ((tr) => dispatch(tr.setMeta('appendedTransaction', rule.transform))),
  )
}
