import type { EditorView } from '@milkdown/kit/prose/view'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditingMode } from './editor'
import {
  InkKitError,
  type DocumentVersion,
  type DocumentFormat,
  type ReadableTextSnapshot,
  type TextRange,
} from './types'
import {
  readableProjection,
  projectionPosition,
  projectionOffset,
  validateOffsets,
  type TextProjection,
} from './text-ranges'

interface TextRuntime {
  view(): EditorView
  literal(): boolean
  element(): HTMLTextAreaElement
  capture(): { key: string }
  version(): DocumentVersion
  format(): DocumentFormat
  mode(): EditingMode
}

interface TextScope {
  key: string
  id: string
  projection: TextProjection
}

let editorSequence = 0

/** Readable text identity, projection and selection within one editor. */
export class EditorText {
  private readonly textIdentity = ++editorSequence
  private textScope?: TextScope

  constructor(private readonly runtime: TextRuntime) {}

  capture(): TextScope | undefined {
    return this.textScope
  }
  restore(scope: TextScope | undefined): void {
    this.textScope = scope
  }

  scope(): TextScope {
    const { key } = this.runtime.capture()
    if (this.textScope?.key !== key)
      this.textScope = {
        key,
        id: `${this.textIdentity}:${key}`,
        projection: this.runtime.literal()
          ? { text: this.runtime.element().value, spans: [] }
          : readableProjection(this.runtime.view().state.doc),
      }
    return this.textScope
  }

  snapshot(): ReadableTextSnapshot {
    const scope = this.scope()
    const selection = this.runtime.view().state.selection
    return Object.freeze({
      snapshotId: scope.id,
      ...this.runtime.version(),
      format: this.runtime.format(),
      mode: this.runtime.mode(),
      text: scope.projection.text,
      selection: Object.freeze({
        snapshotId: scope.id,
        from: this.runtime.literal()
          ? this.runtime.element().selectionStart
          : projectionOffset(scope.projection, selection.from),
        to: this.runtime.literal()
          ? this.runtime.element().selectionEnd
          : projectionOffset(scope.projection, selection.to),
      }),
    })
  }

  selection(): { range: TextRange; projection: TextProjection } {
    const view = this.runtime.view()
    const projection = this.scope().projection
    const from = projectionOffset(projection, view.state.selection.from)
    const to = projectionOffset(projection, view.state.selection.to)
    return { range: { snapshotId: this.scope().id, from, to }, projection }
  }

  validate(range: TextRange): TextProjection {
    const scope = this.scope()
    if (range.snapshotId !== scope.id)
      throw new InkKitError(
        'stale-document',
        'The readable text snapshot changed',
      )
    validateOffsets(scope.projection.text, range.from, range.to)
    return scope.projection
  }

  select(range: TextRange, projection: TextProjection): void {
    if (this.runtime.literal())
      this.runtime.element().setSelectionRange(range.from, range.to)
    else {
      for (const span of projection.spans)
        if (
          span.kind === 'embed' &&
          ((range.from > span.from && range.from < span.to) ||
            (range.to > span.from && range.to < span.to))
        )
          throw new InkKitError(
            'invalid-range',
            'Embedded labels must be selected as complete ranges',
          )
      const view = this.runtime.view()
      const from = projectionPosition(projection, range.from, 1)
      const to = projectionPosition(
        projection,
        range.to,
        range.from === range.to ? 1 : -1,
      )
      const embed = projection.spans.find(
        (span) =>
          span.kind === 'embed' &&
          span.from === range.from &&
          span.to === range.to,
      )
      view.dispatch(
        view.state.tr.setSelection(
          embed && view.state.doc.nodeAt(embed.start)
            ? NodeSelection.create(view.state.doc, embed.start)
            : TextSelection.between(
                view.state.doc.resolve(from),
                view.state.doc.resolve(to),
              ),
        ),
      )
    }
  }
}
