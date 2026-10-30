import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { InkKitError, type TextRange } from './types'
import type { SessionCapture } from './session'
import { rawOffset, normalizedOffset } from './source'
import { projectionPosition, type TextProjection } from './text-ranges'
import {
  findLiteral,
  literalMatches,
  formattedMatches,
  findFormatted,
  replaceLiteral,
  replaceFormatted,
  replaceFormattedRange,
} from './search'

interface SearchRuntime {
  view(): EditorView
  literal(): boolean
  element(): HTMLTextAreaElement
  currentText(): string
  capture(): SessionCapture
  applySource(
    text: string,
    isolated: boolean,
    from?: number,
    to?: number,
  ): boolean
  assertPreserved(before: ProseNode, after: ProseNode): void
  revealLiteral(): void
  revealCurrent(): void
}

interface LiteralMatch {
  query: string
  from: number
  to: number
  displayedFrom: number
  displayedTo: number
  version: SessionCapture
}

/** Search state retains raw matches when textarea offsets normalize CRLF. */
export class EditorSearch {
  private plainSearch = ''
  private literalMatch?: LiteralMatch

  constructor(private readonly runtime: SearchRuntime) {}

  reset(): void {
    this.plainSearch = ''
    this.literalMatch = undefined
  }

  invalidate(): void {
    this.literalMatch = undefined
  }
  capture(): LiteralMatch | undefined {
    return this.literalMatch
  }
  restore(match: LiteralMatch | undefined): void {
    this.literalMatch = match
  }

  matches(
    text: string,
    snapshotId: string,
    projection: TextProjection,
  ): readonly TextRange[] {
    const raw = this.runtime.literal() ? this.runtime.currentText() : undefined
    const matches =
      raw === undefined
        ? formattedMatches(this.runtime.view().state, text)
        : literalMatches(raw, text)
    // Match endpoints are ordered, so each source character or projection span is visited once.
    let rawPosition = 0,
      normalizedPosition = 0,
      spanIndex = 0
    const offset = (position: number): number => {
      if (raw !== undefined) {
        while (rawPosition < position) {
          if (raw[rawPosition] !== '\n' || raw[rawPosition - 1] !== '\r')
            normalizedPosition++
          rawPosition++
        }
        return normalizedPosition
      }
      while (
        spanIndex < projection.spans.length &&
        projection.spans[spanIndex]!.end < position
      )
        spanIndex++
      const span = projection.spans[spanIndex]
      if (!span) return projection.text.length
      if (position < span.start) return span.from
      return span.kind === 'text'
        ? span.from + Math.max(0, position - span.start)
        : position === span.start
          ? span.from
          : span.to
    }
    return Object.freeze(
      matches.map((match) => {
        // A match of the LF half of CRLF selects the displayed line break, as find does.
        const start =
          raw !== undefined &&
          raw[match.from] === '\n' &&
          raw[match.from - 1] === '\r'
            ? match.from - 1
            : match.from
        return Object.freeze({
          snapshotId,
          from: offset(start),
          to: offset(match.to),
        })
      }),
    )
  }

  find(text: string): boolean {
    if (this.runtime.literal()) {
      const from =
        this.plainSearch === text
          ? this.runtime.element().selectionEnd
          : this.runtime.element().selectionStart
      const raw = this.runtime.currentText()
      const match = findLiteral(raw, text, rawOffset(raw, from))
      this.literalMatch = undefined
      if (match) {
        // A textarea displays CRLF as one character; retain a match of either raw half for replacement.
        const start =
          raw[match.from] === '\n' && raw[match.from - 1] === '\r'
            ? match.from - 1
            : match.from
        const displayedFrom = normalizedOffset(raw, start),
          displayedTo = normalizedOffset(raw, match.to)
        this.runtime.element().setSelectionRange(displayedFrom, displayedTo)
        this.literalMatch = {
          ...match,
          query: text,
          displayedFrom,
          displayedTo,
          version: this.runtime.capture(),
        }
      } else if (this.plainSearch)
        this.runtime
          .element()
          .setSelectionRange(
            this.runtime.element().selectionEnd,
            this.runtime.element().selectionEnd,
          )
      this.plainSearch = text
      this.runtime.revealLiteral()
      return !!match
    }
    const found = findFormatted(this.runtime.view(), text)
    if (found) this.runtime.revealCurrent()
    return found
  }

  replace(search: string, replacement: string, all: boolean): number {
    if (this.runtime.literal()) {
      const raw = this.runtime.currentText()
      const remembered = this.literalMatch
      const selection =
        remembered &&
        remembered.query === search &&
        remembered.version.isCurrent() &&
        remembered.displayedFrom === this.runtime.element().selectionStart &&
        remembered.displayedTo === this.runtime.element().selectionEnd
          ? { from: remembered.from, to: remembered.to }
          : {
              from: rawOffset(raw, this.runtime.element().selectionStart),
              to: rawOffset(raw, this.runtime.element().selectionEnd),
            }
      if (remembered?.query !== search) this.literalMatch = undefined
      const result = replaceLiteral(raw, search, replacement, selection, all)
      if (result.count)
        this.runtime.applySource(
          result.text,
          true,
          normalizedOffset(result.text, result.from),
          normalizedOffset(result.text, result.to),
        )
      this.plainSearch = search
      return result.count
    }
    const view = this.runtime.view()
    return replaceFormatted(
      view,
      search,
      replacement,
      (tr) =>
        this.runtime.assertPreserved(view.state.doc, view.state.apply(tr).doc),
      all,
    )
  }

  replaceRange(
    range: TextRange,
    text: string,
    projection: TextProjection,
  ): boolean {
    if (this.runtime.literal()) {
      const raw = this.runtime.currentText()
      const from = rawOffset(raw, range.from),
        to = rawOffset(raw, range.to)
      const ending = /\r\n|\r|\n/.exec(raw)?.[0] ?? '\n'
      const value = text.replace(/\r\n?/g, '\n')
      const replaced =
        raw.slice(0, from) + value.replaceAll('\n', ending) + raw.slice(to)
      return this.runtime.applySource(
        replaced,
        true,
        range.from,
        range.from + value.length,
      )
    }
    if (
      projection.spans.some(
        (span) =>
          (span.kind === 'embed' &&
            range.from > span.from &&
            range.from < span.to) ||
          (span.kind === 'embed' &&
            range.to > span.from &&
            range.to < span.to) ||
          (span.to > range.from &&
            span.from < range.to &&
            span.kind !== 'text'),
      )
    )
      throw new InkKitError(
        'invalid-range',
        'Replacement cannot remove embedded content or structural separators',
      )
    const from = projectionPosition(projection, range.from, 1)
    const to = projectionPosition(
      projection,
      range.to,
      range.from === range.to ? 1 : -1,
    )
    const view = this.runtime.view()
    return replaceFormattedRange(view, from, to, text, (tr) =>
      this.runtime.assertPreserved(view.state.doc, view.state.apply(tr).doc),
    )
  }
}
