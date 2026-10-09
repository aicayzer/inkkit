import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitError, type TextRect } from './types'

export interface TextSpan {
  from: number
  to: number
  start: number
  end: number
  kind: 'text' | 'break' | 'embed' | 'separator'
}
export interface TextProjection {
  text: string
  spans: TextSpan[]
}

export function readableProjection(doc: ProseNode): TextProjection {
  const result: TextProjection = { text: '', spans: [] }
  let blocks = 0
  const append = (
    text: string,
    start: number,
    end: number,
    kind: TextSpan['kind'],
  ) => {
    const from = result.text.length
    result.text += text
    result.spans.push({ from, to: result.text.length, start, end, kind })
  }
  const block = (start: number) => {
    if (blocks++)
      append('\n', result.spans.at(-1)?.end ?? start, start, 'separator')
  }
  doc.descendants((node, position) => {
    const name = node.type.name
    if (
      name === 'comment_inline' ||
      name === 'comment_block' ||
      name === 'reference_definition'
    )
      return false
    if (name === 'inkkit_callout') {
      block(position)
      append(
        node.attrs.title ||
          String(node.attrs.kind).replace(/^./, (value) => value.toUpperCase()),
        position,
        position + 1,
        'embed',
      )
      return true
    }
    if (node.isTextblock) {
      block(position + 1)
      if (!node.content.size) append('', position + 1, position + 1, 'text')
      return true
    }
    if (node.isText) {
      append(node.text ?? '', position, position + node.nodeSize, 'text')
      return false
    }
    if (name === 'hardbreak' || name === 'hard_break') {
      append('\n', position, position + node.nodeSize, 'break')
      return false
    }
    if (name === 'image' || name === 'footnote_reference') {
      append(
        name === 'image'
          ? String(node.attrs.alt ?? '').replace(/\|\d{1,5}$/, '') || 'Image'
          : `[${node.attrs.label}]`,
        position,
        position + node.nodeSize,
        'embed',
      )
      return false
    }
    return true
  })
  return result
}

export function projectionPosition(
  projection: TextProjection,
  offset: number,
  side: -1 | 1,
): number {
  const spans = projection.spans
  const span =
    spans.find(
      (span) =>
        (offset > span.from && offset < span.to) ||
        (side > 0 ? offset === span.from : offset === span.to),
    ) ?? (side > 0 ? spans.at(-1) : spans[0])
  if (!span) return 0
  if (span.kind === 'text')
    return (
      span.start +
      Math.max(0, Math.min(offset - span.from, span.to - span.from))
    )
  return offset <= span.from ? span.start : span.end
}

export function projectionOffset(
  projection: TextProjection,
  position: number,
): number {
  for (const span of projection.spans) {
    if (position < span.start) return span.from
    if (position <= span.end)
      return span.kind === 'text'
        ? span.from + Math.max(0, position - span.start)
        : position === span.start
          ? span.from
          : span.to
  }
  return projection.text.length
}

export function validateOffsets(text: string, from: number, to: number): void {
  const split = (offset: number) =>
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[offset]!)
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > text.length ||
    split(from) ||
    split(to)
  )
    throw new InkKitError(
      'invalid-range',
      'Range must use valid UTF-16 boundaries in the text snapshot',
    )
}

export function textRect(
  rect: Pick<TextRect, 'left' | 'top' | 'right' | 'bottom'>,
): TextRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: Math.max(0, rect.right - rect.left),
    height: Math.max(0, rect.bottom - rect.top),
  }
}

export function formattedRects(
  view: EditorView,
  projection: TextProjection,
  from: number,
  to: number,
): TextRect[] {
  if (from === to) {
    const position = projectionPosition(projection, from, 1)
    const dom = view.domAtPos(position)
    const element =
      dom.node.nodeType === 1 ? (dom.node as Element) : dom.node.parentElement
    if (!element?.getClientRects().length) return []
    return [textRect(view.coordsAtPos(position))]
  }
  const rects: TextRect[] = []
  for (const span of projection.spans) {
    if (span.to <= from || span.from >= to || span.kind === 'separator')
      continue
    if (span.kind === 'embed' || span.kind === 'break') {
      const node = view.nodeDOM(span.start)
      if (node instanceof Element) {
        const label = node.matches('.inkkit-callout')
          ? (node.querySelector(
              ':scope > .inkkit-callout-header > .inkkit-callout-title',
            ) ?? node)
          : node
        rects.push(...Array.from(label.getClientRects(), textRect))
      }
      continue
    }
    const start = view.domAtPos(span.start + Math.max(0, from - span.from), 1)
    const end = view.domAtPos(
      span.start + Math.min(span.to - span.from, to - span.from),
      -1,
    )
    const range = view.dom.ownerDocument.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    rects.push(...Array.from(range.getClientRects(), textRect))
  }
  return rects.filter((rect) => rect.height > 0 && rect.width >= 0)
}

function withLiteralLayout<T>(
  plain: HTMLTextAreaElement,
  measure: (text: Text) => T,
): T | undefined {
  if (!plain.clientWidth || !plain.clientHeight) return undefined
  const document = plain.ownerDocument
  const style = document.defaultView!.getComputedStyle(plain)
  const mirror = document.createElement('div')
  for (const property of [
    'font',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'font-stretch',
    'font-variant',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'tab-size',
    'padding',
    'text-indent',
    'text-transform',
    'direction',
    'word-break',
  ])
    mirror.style.setProperty(property, style.getPropertyValue(property))
  const origin = plain.getBoundingClientRect()
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: `${origin.left + plain.clientLeft - plain.scrollLeft}px`,
    top: `${origin.top + plain.clientTop - plain.scrollTop}px`,
    width: `${plain.clientWidth}px`,
    boxSizing: 'border-box',
    whiteSpace: plain.wrap === 'off' ? 'pre' : 'pre-wrap',
    overflowWrap: plain.wrap === 'off' ? 'normal' : 'break-word',
  })
  mirror.setAttribute('aria-hidden', 'true')
  const text = document.createTextNode(plain.value + '\u200b')
  mirror.append(text)
  document.body.append(mirror)
  try {
    return measure(text)
  } finally {
    mirror.remove()
  }
}

export function literalRects(
  plain: HTMLTextAreaElement,
  from: number,
  to: number,
): TextRect[] {
  return (
    withLiteralLayout(plain, (text) => {
      const range = plain.ownerDocument.createRange()
      range.setStart(text, from)
      range.setEnd(text, from === to ? Math.min(to + 1, text.length) : to)
      return Array.from(range.getClientRects(), (rect) =>
        textRect({
          left: rect.left,
          right: from === to ? rect.left : rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }),
      )
    }) ?? []
  )
}

export function intersectsViewport(
  rect: Pick<TextRect, 'top' | 'right' | 'bottom' | 'left'>,
  viewport: TextRect,
): boolean {
  return (
    viewport.width > 0 &&
    viewport.height > 0 &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom &&
    rect.right >= viewport.left &&
    rect.left < viewport.right
  )
}

export function literalVisibleRanges(
  plain: HTMLTextAreaElement,
  viewport: TextRect,
): { from: number; to: number }[] {
  return (
    withLiteralLayout(plain, (text) => {
      const range = plain.ownerDocument.createRange()
      const ranges: { from: number; to: number }[] = []
      const visible = (from: number, to: number) => {
        range.setStart(text, from)
        range.setEnd(text, to)
        return Array.from(range.getClientRects()).some((rect) =>
          intersectsViewport(rect, viewport),
        )
      }
      for (let start = 0; start < plain.value.length;) {
        const newline = plain.value.indexOf('\n', start)
        const end = newline < 0 ? plain.value.length : newline + 1
        if (visible(start, end)) {
          for (let from = start; from < end;) {
            const to = from + (plain.value.codePointAt(from)! > 0xffff ? 2 : 1)
            if (visible(from, to)) {
              const previous = ranges.at(-1)
              if (previous?.to === from) previous.to = to
              else ranges.push({ from, to })
            }
            from = to
          }
        }
        start = end
      }
      return ranges
    }) ?? []
  )
}
