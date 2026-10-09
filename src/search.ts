import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Fragment, Slice } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { SearchQuery, setSearchState, getSearchState } from 'prosemirror-search'
import { InkKitError } from './types'

export interface TextMatch {
  from: number
  to: number
}
export interface LiteralReplacement extends TextMatch {
  text: string
  count: number
}

function escapedPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function literalMatches(text: string, search: string): TextMatch[] {
  if (!search) return []
  const pattern = new RegExp(escapedPattern(search), 'giu')
  return [...text.matchAll(pattern)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }))
}
export function findLiteral(
  text: string,
  search: string,
  from = 0,
): TextMatch | undefined {
  const matches = literalMatches(text, search)
  return matches.find((match) => match.from >= from) ?? matches[0]
}
export function replaceLiteral(
  text: string,
  search: string,
  replacement: string,
  selection: TextMatch,
  all = false,
): LiteralReplacement {
  const matches = literalMatches(text, search)
  const selected =
    matches.find(
      (match) => match.from === selection.from && match.to === selection.to,
    ) ??
    matches.find((match) => match.from >= selection.to) ??
    matches[0]
  const changed = (all ? matches : selected ? [selected] : []).filter(
    (match) => text.slice(match.from, match.to) !== replacement,
  )
  if (!changed.length) return { ...selection, text, count: 0 }
  let output = text
  for (const match of [...changed].reverse())
    output = output.slice(0, match.from) + replacement + output.slice(match.to)
  if (!all)
    return {
      text: output,
      count: 1,
      from: changed[0]!.from,
      to: changed[0]!.from + replacement.length,
    }
  const map = (position: number) => {
    let difference = 0
    for (const match of changed) {
      if (position < match.from) break
      if (position <= match.to)
        return (
          match.from +
          difference +
          (position === match.from ? 0 : replacement.length)
        )
      difference += replacement.length - (match.to - match.from)
    }
    return position + difference
  }
  return {
    text: output,
    count: changed.length,
    from: map(selection.from),
    to: map(selection.to),
  }
}

function formattedQuery(text: string): SearchQuery {
  // Unicode regexp matching retains offsets when lowercasing would expand a character.
  return new SearchQuery({
    search: escapedPattern(text),
    regexp: true,
    literal: true,
    filter: (state, match) => {
      const from = state.doc.resolve(match.from)
      const to = state.doc.resolve(match.to)
      if (from.parent !== to.parent || !from.parent.inlineContent) return false
      const content = state.doc.slice(match.from, match.to).content
      let textOnly = true
      content.forEach((node) => {
        if (!node.isText) textOnly = false
      })
      return textOnly
    },
  })
}
export function findFormatted(view: EditorView, text: string): void {
  const query = formattedQuery(text)
  const previous = getSearchState(view.state)?.query.search
  let tr = setSearchState(view.state.tr, query)
  if (text) {
    const start =
      previous === query.search
        ? view.state.selection.to
        : view.state.selection.from
    const match =
      query.findNext(view.state, start) ?? query.findNext(view.state, 0)
    if (match)
      tr = tr
        .setSelection(TextSelection.create(tr.doc, match.from, match.to))
        .scrollIntoView()
    else tr = tr.setSelection(Selection.near(view.state.selection.$to))
  } else if (previous)
    tr = tr.setSelection(Selection.near(view.state.selection.$to))
  view.dispatch(tr)
}

export function replaceFormatted(
  view: EditorView,
  search: string,
  replacement: string,
  preflight: (doc: ProseNode) => void,
  all = false,
): number {
  if (!search) return 0
  const state = view.state
  const query = formattedQuery(search)
  if (!query.valid) return 0
  const matches: TextMatch[] = []
  if (all) {
    for (let position = 0; ;) {
      const match = query.findNext(state, position)
      if (!match) break
      matches.push(match)
      position = match.to
    }
  } else {
    const selection = state.selection
    const current = query.findNext(state, selection.from, selection.to)
    const match =
      (current?.from === selection.from && current.to === selection.to
        ? current
        : undefined) ??
      query.findNext(state, selection.to) ??
      query.findNext(state, 0)
    if (match) matches.push(match)
  }
  const value = replacement.replace(/\r\n?/g, '\n')
  const changed = matches.filter(
    (match) => state.doc.textBetween(match.from, match.to) !== value,
  )
  if (!changed.length) return 0
  let tr = setSearchState(state.tr, query)
  for (const match of [...changed].reverse()) {
    const from = state.doc.resolve(match.from)
    const to = state.doc.resolve(match.to)
    const marks = from.marksAcross(to) ?? from.marks()
    let content = Fragment.empty
    if (from.parent.type.spec.code) {
      if (value) content = Fragment.from(state.schema.text(value, marks))
    } else {
      const nodes: ProseNode[] = []
      const lines = value.split('\n')
      lines.forEach((line, index) => {
        if (index)
          nodes.push(
            state.schema.nodes.hardbreak!.create(
              { isHTML: index === lines.length - 1 && line === '' },
              null,
              marks,
            ),
          )
        if (line) nodes.push(state.schema.text(line, marks))
      })
      content = Fragment.fromArray(nodes)
    }
    tr.replace(match.from, match.to, new Slice(content, 0, 0))
  }
  if (!all) {
    const match = changed[0]!
    tr = tr.setSelection(
      TextSelection.create(tr.doc, match.from, tr.mapping.map(match.to, 1)),
    )
  }
  try {
    preflight(tr.doc)
  } catch (error) {
    if (error instanceof InkKitError) throw error
    throw new InkKitError(
      'preservation',
      error instanceof Error ? error.message : 'Cannot preserve replacement',
    )
  }
  view.dispatch(closeHistory(tr).scrollIntoView())
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
  return changed.length
}
