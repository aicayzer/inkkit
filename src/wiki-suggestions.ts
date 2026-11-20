import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { closeHistory } from '@milkdown/kit/prose/history'
import {
  InkKitError,
  type DocumentContext,
  type WikiLinkAdapter,
} from './types'
import { invalidArgument } from './errors'
import { parseLinkedSyntax, wikiMarkdown } from './linked-syntax'
import type { SuggestionSession } from './suggestions'
import { pairedClosers } from './pairing'

interface WikiHost {
  adapter?: WikiLinkAdapter
  context(): DocumentContext
  choose(session: SuggestionSession, name: string): void
  error(error: InkKitError): void
}
function rawName(name: string): string {
  return `[[${name}]]`
}
function validName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = parseLinkedSyntax(rawName(value))
  return (
    !!parsed &&
    parsed.target === value &&
    parsed.label === value &&
    !parsed.fragment
  )
}
function wikiSuggestionNode(state: EditorState, name: string): ProseNode {
  if (!validName(name))
    throw invalidArgument('A note suggestion must be a supported note name')
  const { $from } = state.selection
  let inTable = false
  for (let depth = $from.depth; depth > 0; depth--)
    if (['table_cell', 'table_header'].includes($from.node(depth).type.name))
      inTable = true
  const node = state.schema.nodes.inkkit_wiki_link!.create(
    {
      raw: rawName(name),
      target: name,
      label: name,
      fragment: null,
      inTable: false,
    },
    undefined,
    $from.marks(),
  )
  if (!inTable) return node
  return node.type.create(
    { ...node.attrs, raw: wikiMarkdown(node, true), inTable },
    undefined,
    node.marks,
  )
}
export function wikiSuggestionTransaction(
  view: EditorView,
  session: SuggestionSession,
  name: string,
): Transaction {
  const { state } = view
  // Closing brackets that pairing inserted with the opening ones are part of what is replaced.
  const closers = pairedClosers(state, state.selection.from, ']')
  return closeHistory(
    state.tr.replaceWith(
      session.from,
      state.selection.from + closers,
      wikiSuggestionNode(state, name),
    ),
  ).scrollIntoView()
}

/**
 * The document after `tr` without the closing brackets at `at`, which pairing may have inserted
 * since the session started, so that they are not an edit outside the query.
 */
function withoutClosers(tr: Transaction, at: number): ProseNode {
  const end = tr.doc.resolve(at).end()
  let stop = at
  while (stop < end && tr.doc.textBetween(stop, stop + 1) === ']') stop++
  return stop > at ? tr.delete(at, stop).doc : tr.doc
}

export function wikiSession(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  host: WikiHost,
): SuggestionSession | undefined {
  if (
    !host.adapter?.suggest ||
    !view.state.selection.$from.sameParent(view.state.selection.$to)
  )
    return
  const { $from } = view.state.selection
  if (
    !['paragraph', 'heading'].includes($from.parent.type.name) ||
    (view.state.storedMarks ?? $from.marks()).some(
      (mark) => mark.type.name === 'inlineCode',
    )
  )
    return
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const prefixAlreadyTyped = text.startsWith('[') && before.endsWith('[')
  if (!text.startsWith('[[') && !prefixAlreadyTyped) return
  const start = prefixAlreadyTyped ? from - 1 : from
  const preceding = view.state.doc.textBetween(
    Math.max($from.start(), start - 1),
    start,
  )
  if (preceding === '!' || preceding === '\\' || preceding === '[') return
  const baseline = withoutClosers(view.state.tr.delete(start, to), start)
  let controller: AbortController | undefined
  let disposed = false
  const session: SuggestionSession = {
    from: start,
    prefix: '[[',
    base: view.state,
    query: '',
    valid: (current) =>
      !current.state.doc
        .textBetween(start, current.state.selection.from, '\n', '\ufffc')
        .includes(']]') &&
      withoutClosers(
        current.state.tr.delete(start, current.state.selection.from),
        start,
      ).eq(baseline),
    cancel: () => {
      disposed = true
      controller?.abort()
    },
    update(query, show) {
      controller?.abort()
      const request = new AbortController()
      controller = request
      const current = () =>
        !disposed && !request.signal.aborted && controller === request
      Promise.resolve()
        .then(() => {
          if (!current()) return undefined
          return host.adapter!.suggest!(query, {
            ...host.context(),
            signal: request.signal,
          })
        })
        .then((names) => {
          if (!current()) return
          if (!Array.isArray(names) || !names.every(validName))
            throw invalidArgument(
              'WikiLinkAdapter.suggest must return supported note names',
            )
          show(
            names.map((name) => ({
              name,
              glyph: '▤',
              choose: () => host.choose(session, name),
            })),
          )
        })
        .catch((error) => {
          if (!current()) return
          host.error(
            new InkKitError(
              'file-unavailable',
              'Note suggestions could not be loaded',
              { cause: error },
            ),
          )
        })
    },
  }
  return session
}
