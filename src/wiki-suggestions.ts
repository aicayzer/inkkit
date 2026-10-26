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

interface WikiHost {
  adapter?: WikiLinkAdapter
  context(): DocumentContext
  choose(session: SuggestionSession, name: string): void
  error(error: InkKitError): void
}
function rawName(name: string): string {
  return `[[${name.replace(/[\\[\]|#]/g, '\\$&')}]]`
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
export function wikiSuggestionNode(
  state: EditorState,
  name: string,
): ProseNode {
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
  return closeHistory(
    state.tr.replaceWith(
      session.from,
      state.selection.from,
      wikiSuggestionNode(state, name),
    ),
  ).scrollIntoView()
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
  const baseline = view.state.tr.delete(start, to).doc
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
      current.state.tr
        .delete(start, current.state.selection.from)
        .doc.eq(baseline),
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
