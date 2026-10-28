import type { EditorView } from '@milkdown/kit/prose/view'
import type {
  ReadableTextSnapshot,
  TextRange,
  TextRect,
  ViewportInsets,
  ViewportSnapshot,
} from './types'
import {
  formattedRects,
  projectionPosition,
  literalRangesRects,
  literalVisibleRanges,
  intersectsViewport,
  textRect,
  type TextProjection,
} from './text-ranges'
import { scrollOutward, scrollWholePixels } from './scroll'
import { revealCalloutAncestors } from './callouts'

interface ViewportRuntime {
  root(): HTMLElement
  view(): EditorView
  literal(): boolean
  element(): HTMLTextAreaElement
}

/** Measures the current surface and scrolls through its containing viewports. */
export class EditorViewport {
  private viewportContainer?: HTMLElement
  private viewportInsets: ViewportInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }

  constructor(private readonly runtime: ViewportRuntime) {}

  get container(): HTMLElement {
    return this.viewportContainer ?? this.runtime.root()
  }

  configure(container: HTMLElement, insets: ViewportInsets): void {
    this.viewportContainer = container
    this.viewportInsets = insets
  }

  snapshot(): ViewportSnapshot {
    const container = this.container
    const bounds = container.getBoundingClientRect()
    const root = this.runtime.root().getBoundingClientRect()
    const insets = this.viewportInsets
    const window = this.runtime.root().ownerDocument.defaultView!
    const left = Math.max(bounds.left + container.clientLeft, root.left, 0)
    const top = Math.max(bounds.top + container.clientTop, root.top, 0)
    const right = Math.max(
      left,
      Math.min(
        bounds.left + container.clientLeft + container.clientWidth,
        root.right,
        window.innerWidth,
      ),
    )
    const bottom = Math.max(
      top,
      Math.min(
        bounds.top + container.clientTop + container.clientHeight,
        root.bottom,
        window.innerHeight,
      ),
    )
    let rect = textRect({ left, top, right, bottom })
    if (this.runtime.literal()) {
      const plain = this.runtime.element().getBoundingClientRect()
      const literalLeft = Math.max(
        rect.left,
        plain.left + this.runtime.element().clientLeft,
      )
      const literalTop = Math.max(
        rect.top,
        plain.top + this.runtime.element().clientTop,
      )
      rect = textRect({
        left: literalLeft,
        top: literalTop,
        right: Math.max(
          literalLeft,
          Math.min(
            rect.right,
            plain.left +
              this.runtime.element().clientLeft +
              this.runtime.element().clientWidth,
          ),
        ),
        bottom: Math.max(
          literalTop,
          Math.min(
            rect.bottom,
            plain.top +
              this.runtime.element().clientTop +
              this.runtime.element().clientHeight,
          ),
        ),
      })
    }
    const insetLeft = Math.min(rect.right, rect.left + insets.left)
    const insetTop = Math.min(rect.bottom, rect.top + insets.top)
    rect = textRect({
      left: insetLeft,
      top: insetTop,
      right: Math.max(insetLeft, rect.right - insets.right),
      bottom: Math.max(insetTop, rect.bottom - insets.bottom),
    })
    return Object.freeze({
      rect: Object.freeze(rect),
      insets: Object.freeze({ ...insets }),
      scrollTop:
        container.scrollTop +
        (this.runtime.literal() ? this.runtime.element().scrollTop : 0),
      scrollLeft:
        container.scrollLeft +
        (this.runtime.literal() ? this.runtime.element().scrollLeft : 0),
    })
  }

  rangesRects(
    ranges: readonly TextRange[],
    projections: readonly TextProjection[],
  ): readonly (readonly TextRect[])[] {
    if (!ranges.length) return Object.freeze([])
    const results = this.runtime.literal()
      ? literalRangesRects(this.runtime.element(), ranges)
      : ranges.map((range, index) =>
          formattedRects(
            this.runtime.view(),
            projections[index]!,
            range.from,
            range.to,
          ),
        )
    return Object.freeze(
      results.map((rects) =>
        Object.freeze(rects.map((rect) => Object.freeze(rect))),
      ),
    )
  }

  visibleRanges(
    snapshotId: string,
    snapshot: ReadableTextSnapshot,
    projection: TextProjection,
  ): readonly TextRange[] {
    const viewport = this.snapshot().rect
    if (this.runtime.literal())
      return Object.freeze(
        literalVisibleRanges(this.runtime.element(), viewport).map((range) =>
          Object.freeze({ snapshotId, ...range }),
        ),
      )
    const visible = (rect: TextRect) => intersectsViewport(rect, viewport)
    const ranges: TextRange[] = []
    const view = this.runtime.view()
    for (const span of projection.spans) {
      const current = { text: projection.text, spans: [span] }
      if (
        span.kind === 'separator' ||
        !formattedRects(view, current, span.from, span.to).some(visible)
      )
        continue
      for (let from = span.from; from < span.to;) {
        const to = from + (snapshot.text.codePointAt(from)! > 0xffff ? 2 : 1)
        if (formattedRects(view, current, from, to).some(visible)) {
          const previous = ranges.at(-1)
          if (previous?.to === from) previous.to = to
          else ranges.push({ snapshotId, from, to })
        }
        from = to
      }
    }
    return Object.freeze(ranges.map((range) => Object.freeze(range)))
  }

  revealCallouts(range: TextRange, projection: TextProjection): void {
    revealCalloutAncestors(
      this.runtime.view(),
      projectionPosition(projection, range.from, 1),
    )
  }

  revealFormattedSelection(range: TextRange, projection: TextProjection): void {
    this.revealRects(
      formattedRects(this.runtime.view(), projection, range.from, range.to),
    )
  }

  revealRects(rects: readonly TextRect[]): void {
    if (!rects.length) return
    const viewport = this.snapshot().rect
    const leading = rects[0]!
    const envelope = {
      top: leading.top,
      bottom: leading.bottom,
      left: leading.left,
      right: leading.right,
    }
    for (const rect of rects) {
      envelope.top = Math.min(envelope.top, rect.top)
      envelope.bottom = Math.max(envelope.bottom, rect.bottom)
      envelope.left = Math.min(envelope.left, rect.left)
      envelope.right = Math.max(envelope.right, rect.right)
    }
    const fitsHeight = envelope.bottom - envelope.top <= viewport.height
    const fitsWidth = envelope.right - envelope.left <= viewport.width
    const rect = {
      top: fitsHeight ? envelope.top : leading.top,
      bottom: fitsHeight
        ? envelope.bottom
        : Math.min(leading.bottom, leading.top + viewport.height),
      left: fitsWidth ? envelope.left : leading.left,
      right: fitsWidth
        ? envelope.right
        : Math.min(leading.right, leading.left + viewport.width),
    }
    const vertical =
      viewport.height <= 0
        ? 0
        : rect.top < viewport.top
          ? rect.top - viewport.top
          : rect.bottom > viewport.bottom
            ? rect.bottom - viewport.bottom
            : 0
    const horizontal =
      viewport.width <= 0
        ? 0
        : rect.left < viewport.left
          ? rect.left - viewport.left
          : rect.right > viewport.right
            ? rect.right - viewport.right
            : 0
    let remainingTop = vertical,
      remainingLeft = horizontal
    if (this.runtime.literal()) {
      const style = this.runtime
        .root()
        .ownerDocument.defaultView!.getComputedStyle(this.runtime.element())
      // The first or last line sits within the padding plus its own leading,
      // under half the height of its first rect, so a reveal that ends there
      // shows the edge. A range of many lines does not count as one line.
      const halfCaret = (leading.bottom - leading.top) / 2
      const remaining = scrollWholePixels(
        this.runtime.element(),
        vertical,
        horizontal,
        {
          top: (Number.parseFloat(style.paddingTop) || 0) + halfCaret,
          bottom: (Number.parseFloat(style.paddingBottom) || 0) + halfCaret,
        },
      )
      remainingTop = remaining.vertical
      remainingLeft = remaining.horizontal
    }
    let container: HTMLElement | null = this.container
    const document = this.runtime.root().ownerDocument
    while (
      container &&
      container !== document.body &&
      container !== document.documentElement
    ) {
      ;({ vertical: remainingTop, horizontal: remainingLeft } =
        scrollWholePixels(container, remainingTop, remainingLeft))
      container = container.parentElement
    }
    if (remainingTop || remainingLeft)
      document.defaultView!.scrollBy(
        scrollOutward(remainingLeft),
        scrollOutward(remainingTop),
      )
  }

  revealLiteralSelection(): void {
    this.revealRects(
      literalRangesRects(this.runtime.element(), [
        {
          from: this.runtime.element().selectionStart,
          to: this.runtime.element().selectionEnd,
        },
      ])[0]!,
    )
  }
}
