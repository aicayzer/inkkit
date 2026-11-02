import type { EditorView } from '@milkdown/kit/prose/view'

/*
 * WebKit paints a selection, including a custom highlight, from the bottom of the previous line's
 * text to the bottom of this line's text, so under a loose line height the highlight sits above
 * the text on every wrapped line (https://bugs.webkit.org/show_bug.cgi?id=287429). This layer draws
 * the selection itself instead: one bar per visual line, as tall as that line, centred on its text,
 * behind the text. The approach follows CodeMirror's drawn selection.
 */

const hostClass = 'inkkit-overlay-host'
const layerClass = 'inkkit-selection-layer'

interface Bar {
  left: number
  right: number
  top: number
  bottom: number
}

/** A rectangle, in the viewport, of selected text on one visual line. */
interface Piece extends Bar {
  block: Element
  /** The text's own extent, which groups pieces into lines before they grow to the line box. */
  textTop: number
  textBottom: number
}

/** Every text node a range covers, clipped to the range. */
function* textPieces(range: Range): Generator<Range> {
  const root = range.commonAncestorContainer
  const doc = root.ownerDocument ?? (root as Document)
  if (root.nodeType === Node.TEXT_NODE) {
    yield range
    return
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    if (range.intersectsNode(node)) {
      const piece = doc.createRange()
      piece.setStart(
        node,
        node === range.startContainer ? range.startOffset : 0,
      )
      piece.setEnd(
        node,
        node === range.endContainer ? range.endOffset : node.length,
      )
      if (!piece.collapsed) yield piece
    } else if (
      range.comparePoint(node, 0) > 0 // past the end of the range
    )
      return
    node = walker.nextNode() as Text | null
  }
}

/** Groups pieces by visual line within a block and gives each line one height. */
function bars(pieces: Piece[]): Bar[] {
  const lines: {
    block: Element
    top: number
    bottom: number
    textTop: number
    textBottom: number
    pieces: Bar[]
  }[] = []
  for (const piece of pieces) {
    const line = lines.find(
      (candidate) =>
        candidate.block === piece.block &&
        piece.textTop < candidate.textBottom &&
        piece.textBottom > candidate.textTop,
    )
    if (line) {
      line.top = Math.min(line.top, piece.top)
      line.bottom = Math.max(line.bottom, piece.bottom)
      line.textTop = Math.min(line.textTop, piece.textTop)
      line.textBottom = Math.max(line.textBottom, piece.textBottom)
      line.pieces.push(piece)
    } else
      lines.push({
        block: piece.block,
        top: piece.top,
        bottom: piece.bottom,
        textTop: piece.textTop,
        textBottom: piece.textBottom,
        pieces: [piece],
      })
  }
  const out: Bar[] = []
  for (const line of lines) {
    line.pieces.sort((a, b) => a.left - b.left)
    let current: Bar | undefined
    for (const piece of line.pieces) {
      // Adjacent pieces, such as text either side of a mark, join into one bar.
      if (current && piece.left <= current.right + 1)
        current.right = Math.max(current.right, piece.right)
      else {
        current = {
          left: piece.left,
          right: piece.right,
          top: line.top,
          bottom: line.bottom,
        }
        out.push(current)
      }
    }
  }
  return out
}

/** Draws one view's selection, and redraws it as the view scrolls or resizes. */
export class SelectionLayer {
  private readonly layer: HTMLElement
  private ranges: Range[] = []
  private frame = 0
  private readonly resize: ResizeObserver | undefined
  private readonly doc: Document

  constructor(private readonly view: EditorView) {
    this.doc = view.dom.ownerDocument
    this.layer = this.doc.createElement('div')
    this.layer.className = layerClass
    this.layer.setAttribute('aria-hidden', 'true')
    const host = view.dom.parentElement
    host?.classList.add(hostClass)
    host?.insertBefore(this.layer, host.firstChild)
    const win = this.doc.defaultView
    this.resize = win?.ResizeObserver
      ? new win.ResizeObserver(() => this.schedule())
      : undefined
    this.resize?.observe(view.dom)
    this.doc.addEventListener('scroll', this.schedule, true)
  }

  private readonly schedule = (): void => {
    if (this.frame || !this.ranges.length) return
    const win = this.doc.defaultView
    if (!win) return
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  /**
   * Draws the ranges. Text inside an element with an opaque background would hide a bar
   * drawn behind it, so those pieces are returned for the caller to paint another way.
   */
  draw(ranges: Range[]): Range[] {
    this.ranges = ranges
    return this.render()
  }

  clear(): void {
    this.ranges = []
    this.layer.replaceChildren()
  }

  private render(): Range[] {
    const host = this.layer.parentElement
    const win = this.doc.defaultView
    if (!host || !win || this.view.isDestroyed) return []
    const origin = host.getBoundingClientRect()
    // Only the part of the page that shows, with a margin, so a long selection stays cheap.
    const margin = win.innerHeight
    const visibleTop = -margin
    const visibleBottom = win.innerHeight + margin
    const styles = new Map<Element, CSSStyleDeclaration>()
    const style = (element: Element) => {
      let found = styles.get(element)
      if (!found) styles.set(element, (found = win.getComputedStyle(element)))
      return found
    }
    const opaque = new Map<Element, boolean>()
    const behindOpaque = (element: Element): boolean => {
      const known = opaque.get(element)
      if (known !== undefined) return known
      let result = false
      if (element !== this.view.dom && element.parentElement) {
        const alpha = backgroundAlpha(style(element).backgroundColor)
        result = alpha >= 0.99 || behindOpaque(element.parentElement)
      }
      opaque.set(element, result)
      return result
    }
    const blockRects = new Map<Element, DOMRect>()
    const pieces: Piece[] = []
    const fallback: Range[] = []
    for (const range of this.ranges)
      for (const piece of textPieces(range)) {
        const parent = piece.startContainer.parentElement
        if (!parent) continue
        // Controls and other decorations are not document text. A node view can nest editable
        // content inside an uneditable wrapper, so the nearest setting decides.
        if (parent.closest('.ProseMirror-widget')) continue
        if (
          parent
            .closest('[contenteditable]')
            ?.getAttribute('contenteditable') === 'false'
        )
          continue
        const block =
          parent.closest('p,h1,h2,h3,h4,h5,h6,pre,li,td,th') ?? this.view.dom
        let blockRect = blockRects.get(block)
        if (!blockRect)
          blockRects.set(block, (blockRect = block.getBoundingClientRect()))
        if (blockRect.bottom < visibleTop || blockRect.top > visibleBottom)
          continue
        if (behindOpaque(parent)) {
          fallback.push(piece)
          continue
        }
        const lineHeight = Number.parseFloat(style(parent).lineHeight)
        for (const rect of piece.getClientRects()) {
          if (!rect.width) continue
          // Centre the bar on the text across the whole line box, as tall as the line.
          const spare =
            Number.isFinite(lineHeight) && lineHeight > rect.height
              ? (lineHeight - rect.height) / 2
              : 0
          pieces.push({
            block,
            left: rect.left,
            right: rect.right,
            top: rect.top - spare,
            bottom: rect.bottom + spare,
            textTop: rect.top,
            textBottom: rect.bottom,
          })
        }
      }
    const drawn = bars(pieces)
    const children = this.layer.children
    for (let i = 0; i < drawn.length; i++) {
      const bar = drawn[i]!
      let element = children[i] as HTMLElement | undefined
      if (!element) {
        element = this.doc.createElement('div')
        this.layer.append(element)
      }
      element.style.left = `${bar.left - origin.left}px`
      element.style.top = `${bar.top - origin.top}px`
      element.style.width = `${bar.right - bar.left}px`
      element.style.height = `${bar.bottom - bar.top}px`
    }
    while (children.length > drawn.length)
      children[children.length - 1]!.remove()
    return fallback
  }

  destroy(): void {
    if (this.frame) this.doc.defaultView?.cancelAnimationFrame(this.frame)
    this.resize?.disconnect()
    this.doc.removeEventListener('scroll', this.schedule, true)
    this.layer.remove()
  }
}

function backgroundAlpha(color: string): number {
  if (!color || color === 'transparent') return 0
  const match = /rgba?\(([^)]+)\)/.exec(color)
  if (!match) return 1
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 4) return 1
  const alpha = parts[3]!
  return alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number(alpha)
}
