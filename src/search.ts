import { literalTextNodes } from './literal-text'
import { htmlBreakAt } from './hard-break'
import { replacementMarks } from './text-input'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Fragment, Slice } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import {
  Selection,
  TextSelection,
  Plugin,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  SearchQuery,
  setSearchState,
  getSearchState,
  search as baseSearch,
} from 'prosemirror-search'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { InkKitError } from './types'
import { coded } from './errors'

interface TextMatch {
  from: number
  to: number
}
interface LiteralReplacement extends TextMatch {
  text: string
  count: number
}

interface HighlightState {
  query: SearchQuery
  range: TextMatch | null
  deco: DecorationSet
}

// Keep the library's query/command state and match semantics, but do not
// rebuild every match when only the selection or one block changed.
export function search(): Plugin {
  const original = baseSearch()
  return new Plugin<HighlightState>({
    ...original.spec,
    state: {
      init: original.spec.state!.init,
      apply(tr, current, oldState, state) {
        if (tr.getMeta(original) || current.range)
          return original.spec.state!.apply.call(
            this,
            tr,
            current,
            oldState,
            state,
          )
        if (!current.query.valid || (!tr.docChanged && !tr.selectionSet))
          return current
        let deco = tr.docChanged
          ? current.deco.map(tr.mapping, tr.doc)
          : current.deco
        let from = tr.doc.content.size,
          to = 0
        if (tr.docChanged) {
          tr.mapping.maps.forEach((map, index) =>
            map.forEach((_a, _b, start, end) => {
              const rest = tr.mapping.slice(index + 1)
              from = Math.min(from, rest.map(start, -1))
              to = Math.max(to, rest.map(end, 1))
            }),
          )
          if (from <= to) {
            const left = tr.doc.resolve(Math.max(0, from - 1))
            const right = tr.doc.resolve(Math.min(tr.doc.content.size, to + 1))
            from = left.depth ? left.before(1) : left.pos
            to = right.depth ? right.after(1) : right.pos
            deco = deco.remove(deco.find(from, to))
            const added: Decoration[] = []
            for (let position = from; position < to;) {
              const match = current.query.findNext(state, position, to)
              if (!match) break
              added.push(
                Decoration.inline(match.from, match.to, {
                  class: 'ProseMirror-search-match',
                }),
              )
              position = Math.max(match.to, position + 1)
            }
            deco = deco.add(state.doc, added)
          }
        }
        const previous = {
          from: tr.mapping.map(oldState.selection.from),
          to: tr.mapping.map(oldState.selection.to),
        }
        for (const [selection, active] of [
          [previous, false],
          [state.selection, true],
        ] as const) {
          const matches = deco
            .find(selection.from, selection.to)
            .filter(
              (item) =>
                item.from === selection.from && item.to === selection.to,
            )
          const replacements = matches.map((item) =>
            Decoration.inline(item.from, item.to, {
              class: active
                ? 'ProseMirror-active-search-match'
                : 'ProseMirror-search-match',
            }),
          )
          deco = deco.remove(matches).add(state.doc, replacements)
        }
        return { ...current, deco }
      },
    },
  })
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
export function findFormatted(view: EditorView, text: string): boolean {
  const query = formattedQuery(text)
  const previous = getSearchState(view.state)?.query.search
  let tr = setSearchState(view.state.tr, query)
  let found = false
  if (text) {
    const start =
      previous === query.search
        ? view.state.selection.to
        : view.state.selection.from
    const match =
      query.findNext(view.state, start) ?? query.findNext(view.state, 0)
    if (match) {
      found = true
      tr = tr
        .setSelection(TextSelection.create(tr.doc, match.from, match.to))
        .scrollIntoView()
    } else tr = tr.setSelection(Selection.near(view.state.selection.$to))
  } else if (previous)
    tr = tr.setSelection(Selection.near(view.state.selection.$to))
  view.dispatch(tr)
  return found
}

function replacementSlice(
  state: EditorState,
  from: number,
  to: number,
  value: string,
): Slice {
  const start = state.doc.resolve(from)
  const marks = replacementMarks(state, from, to)
  const nodes: ProseNode[] = []
  if (start.parent.type.spec.code) {
    if (value) nodes.push(state.schema.text(value, marks))
  } else {
    nodes.push(
      ...literalTextNodes(state.schema, value, marks, htmlBreakAt(start)),
    )
  }
  return new Slice(Fragment.fromArray(nodes), 0, 0)
}

export function replaceFormatted(
  view: EditorView,
  search: string,
  replacement: string,
  preflight: (tr: Transaction) => void,
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
    tr.replace(
      match.from,
      match.to,
      replacementSlice(state, match.from, match.to, value),
    )
  }
  if (!all) {
    const match = changed[0]!
    tr = tr.setSelection(
      TextSelection.create(tr.doc, match.from, tr.mapping.map(match.to, 1)),
    )
  }
  try {
    preflight(tr)
  } catch (error) {
    throw coded(error, 'preservation')
  }
  view.dispatch(closeHistory(tr).scrollIntoView())
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
  return changed.length
}

export function replaceFormattedRange(
  view: EditorView,
  from: number,
  to: number,
  replacement: string,
  preflight: (tr: Transaction) => void,
): boolean {
  const start = view.state.doc.resolve(from)
  const end = view.state.doc.resolve(to)
  let textOnly = start.parent === end.parent && start.parent.inlineContent
  // Visit only the block's own content. Walking the document would also
  // visit the list, quote or table around the block and refuse the range.
  if (textOnly)
    start.parent.nodesBetween(start.parentOffset, end.parentOffset, (node) => {
      if (!node.isText) textOnly = false
    })
  if (!textOnly)
    throw new InkKitError(
      'invalid-range',
      'Replacement requires literal text within one block',
    )
  const value = replacement.replace(/\r\n?/g, '\n')
  if (view.state.doc.textBetween(from, to) === value) return false
  const tr = closeHistory(
    view.state.tr.replace(
      from,
      to,
      replacementSlice(view.state, from, to, value),
    ),
  )
  tr.setSelection(TextSelection.create(tr.doc, from, tr.mapping.map(to, 1)))
  try {
    preflight(tr)
  } catch (error) {
    throw coded(error, 'preservation')
  }
  view.dispatch(tr)
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
  return true
}
