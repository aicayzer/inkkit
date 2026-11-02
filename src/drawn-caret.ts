import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/*
 * WebKit draws the native caret from the bottom of the previous line's text to the bottom of
 * this line's text, so under a loose line height the caret on a wrapped line is a full line tall
 * and starts above the text (https://bugs.webkit.org/show_bug.cgi?id=287429). This plugin keeps
 * the native caret in place but transparent, so accessibility and input methods still read its
 * position, and draws a bar the height of the text instead.
 *
 * The approach, not the code, follows CodeMirror's drawn cursor and its record of which side of
 * a soft line wrap the cursor is on (`assoc`), and prosemirror-virtual-cursor.
 */

/** Set on the editable surface while the drawn bar replaces the native caret. */
const drawnClass = 'inkkit-drawn-caret'
const barClass = 'inkkit-caret'
const hostClass = 'inkkit-overlay-host'

type Side = -1 | 1

/**
 * What the last input asked of the caret, so a position at a soft wrap, which is both the end
 * of one visual line and the start of the next, is drawn on the line the engine chose.
 */
type Intent =
  | { kind: 'line-end' }
  | { kind: 'line-start' }
  | { kind: 'point'; y: number }
  | { kind: 'vertical'; y: number; down: boolean }

interface Rect {
  left: number
  top: number
  bottom: number
}

const lineEndKeys = new Set(['End'])
const lineStartKeys = new Set(['Home'])

function keyIntent(event: KeyboardEvent, caretY: number | null): Intent | null {
  if (event.shiftKey || event.altKey) return null
  const { key, metaKey, ctrlKey } = event
  if (lineEndKeys.has(key) || (metaKey && key === 'ArrowRight'))
    return { kind: 'line-end' }
  if (lineStartKeys.has(key) || (metaKey && key === 'ArrowLeft'))
    return { kind: 'line-start' }
  // Emacs bindings that AppKit maps to the line boundaries.
  if (ctrlKey && !metaKey && key === 'e') return { kind: 'line-end' }
  if (ctrlKey && !metaKey && key === 'a') return { kind: 'line-start' }
  if (
    !metaKey &&
    !ctrlKey &&
    (key === 'ArrowUp' || key === 'ArrowDown') &&
    caretY !== null
  )
    return { kind: 'vertical', y: caretY, down: key === 'ArrowDown' }
  return null
}

const isText = (node: { isText: boolean } | null | undefined) => !!node?.isText

class DrawnCaret {
  private readonly bar: HTMLElement
  private intent: Intent | null = null
  private frame = 0
  private blink = false
  private drawn: Rect | null = null
  private readonly resize: ResizeObserver | undefined
  private readonly doc: Document

  constructor(private readonly view: EditorView) {
    this.doc = view.dom.ownerDocument
    this.bar = this.doc.createElement('div')
    this.bar.className = barClass
    this.bar.setAttribute('aria-hidden', 'true')
    // The surface's wrapper positions the bar, so it scrolls with the text.
    view.dom.parentElement?.classList.add(hostClass)
    view.dom.parentElement?.appendChild(this.bar)
    const win = this.doc.defaultView
    this.resize = win?.ResizeObserver
      ? new win.ResizeObserver(() => this.schedule())
      : undefined
    this.resize?.observe(view.dom)
    this.doc.addEventListener('selectionchange', this.schedule)
    // Capture, so scrolling a table or code block moves the bar with its text.
    this.doc.addEventListener('scroll', this.schedule, true)
    void this.doc.fonts?.ready.then(this.schedule)
    this.update()
  }

  readonly schedule = (): void => {
    if (this.frame || this.view.isDestroyed) return
    const win = this.doc.defaultView
    if (!win) return
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0
      this.update()
    })
  }

  keyDown(event: KeyboardEvent): void {
    this.intent = keyIntent(
      event,
      this.drawn ? (this.drawn.top + this.drawn.bottom) / 2 : null,
    )
  }

  pointerDown(event: MouseEvent): void {
    this.intent = { kind: 'point', y: event.clientY }
  }

  /** Places the bar, or hands the caret back to the engine where the bar can't stand in. */
  update(): void {
    const { view } = this
    if (view.isDestroyed) return
    const rect = this.measure()
    view.dom.classList.toggle(drawnClass, rect !== null)
    if (!rect) {
      this.drawn = null
      this.bar.style.display = 'none'
      return
    }
    const container = this.bar.parentElement
    if (!container) return
    const origin = container.getBoundingClientRect()
    const moved =
      !this.drawn ||
      this.drawn.left !== rect.left ||
      this.drawn.top !== rect.top ||
      this.drawn.bottom !== rect.bottom
    this.drawn = rect
    const style = this.bar.style
    style.display = ''
    style.left = `${rect.left - origin.left + container.scrollLeft}px`
    style.top = `${rect.top - origin.top + container.scrollTop}px`
    style.height = `${rect.bottom - rect.top}px`
    // Two identical animations: switching between them restarts the blink on its visible half
    // whenever the caret moves, as the native caret does, without forcing a layout.
    if (moved) {
      this.blink = !this.blink
      this.bar.dataset.blink = this.blink ? 'a' : 'b'
    }
  }

  /** The caret's text rectangle in the viewport, or null where the native caret applies. */
  private measure(): Rect | null {
    const { view } = this
    const { selection } = view.state
    if (
      !view.editable ||
      view.composing ||
      !view.hasFocus() ||
      !(selection instanceof TextSelection) ||
      !selection.empty ||
      !selection.$head.parent.inlineContent
    )
      return null
    const $head = selection.$head
    const before = isText($head.nodeBefore)
    const after = isText($head.nodeAfter)
    // Beside an image or a break alone, or in an empty block, the native caret already
    // matches its line.
    if (!before && !after) return null
    let rect: Rect
    try {
      rect = this.coords($head.pos, before, after)
    } catch {
      return null
    }
    if (
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.left) ||
      !(rect.bottom > rect.top)
    )
      return null
    return this.visible($head.pos, rect) ? rect : null
  }

  private coords(pos: number, before: boolean, after: boolean): Rect {
    const { view } = this
    if (!before) return view.coordsAtPos(pos, 1)
    if (!after) return view.coordsAtPos(pos, -1)
    const end = view.coordsAtPos(pos, -1)
    const start = view.coordsAtPos(pos, 1)
    // The two sides agree except at a soft wrap, where they lie on different lines.
    if (Math.abs(end.top - start.top) < (start.bottom - start.top) / 2)
      return start
    return this.side(end, start) === -1 ? end : start
  }

  private side(end: Rect, start: Rect): Side {
    const intent = this.intent
    if (!intent) return 1
    switch (intent.kind) {
      case 'line-end':
        return -1
      case 'line-start':
        return 1
      case 'point': {
        // A click lands on the line nearest its height.
        const distance = (rect: Rect) =>
          Math.abs((rect.top + rect.bottom) / 2 - intent.y)
        return distance(end) < distance(start) ? -1 : 1
      }
      case 'vertical': {
        // A move up or down leaves the line it started on. `end` is the upper of the two
        // lines, so moving down picks it only when it is already below the start, and moving
        // up picks `start` only when it is already above.
        const middle = (rect: Rect) => (rect.top + rect.bottom) / 2
        const half = (start.bottom - start.top) / 2
        if (intent.down) return middle(end) > intent.y + half ? -1 : 1
        return middle(start) < intent.y - half ? 1 : -1
      }
    }
  }

  /** Whether a scrolled table or code block shows the caret, as it would clip the native one. */
  private visible(pos: number, rect: Rect): boolean {
    const { view } = this
    let node: Node | null = view.domAtPos(pos).node
    const win = this.doc.defaultView
    if (!win) return true
    while (node && node !== view.dom) {
      if (node instanceof Element) {
        const style = win.getComputedStyle(node)
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
          const box = node.getBoundingClientRect()
          if (
            rect.left < box.left - 1 ||
            rect.left > box.right + 1 ||
            rect.bottom < box.top ||
            rect.top > box.bottom
          )
            return false
        }
      }
      node = node.parentNode
    }
    return true
  }

  destroy(): void {
    if (this.frame) this.doc.defaultView?.cancelAnimationFrame(this.frame)
    this.resize?.disconnect()
    this.doc.removeEventListener('selectionchange', this.schedule)
    this.doc.removeEventListener('scroll', this.schedule, true)
    this.view.dom.classList.remove(drawnClass)
    this.bar.parentElement?.classList.remove(hostClass)
    this.bar.remove()
  }
}

const key = new PluginKey<DrawnCaret>('inkkitDrawnCaret')

/**
 * Draws the caret in formatted mode where a fine pointer is the primary input. On touch devices
 * the system draws the caret and the selection handles, so the native caret stays.
 */
export const drawnCaretPlugin = $prose(() => {
  let caret: DrawnCaret | undefined
  return new Plugin({
    key,
    view(view) {
      caret = new DrawnCaret(view)
      const current = caret
      return {
        update: () => current.update(),
        destroy: () => {
          current.destroy()
          if (caret === current) caret = undefined
        },
      }
    },
    props: {
      handleKeyDown(_view, event) {
        caret?.keyDown(event)
        return false
      },
      handleDOMEvents: {
        mousedown(_view, event) {
          caret?.pointerDown(event)
          return false
        },
        // Moving to the other side of a soft wrap keeps the same position, so the engine may not
        // report a selection change; redraw once the click or key has done its work.
        mouseup() {
          caret?.schedule()
          return false
        },
        keyup() {
          caret?.schedule()
          return false
        },
        focus() {
          caret?.schedule()
          return false
        },
        blur() {
          caret?.schedule()
          return false
        },
        compositionstart() {
          caret?.schedule()
          return false
        },
        compositionend() {
          caret?.schedule()
          return false
        },
      },
    },
  })
})

/** The bar drawn for this surface while it replaces the native caret. */
export function drawnCaretBar(surface: HTMLElement): HTMLElement | null {
  if (!surface.classList.contains(drawnClass)) return null
  return (
    surface.parentElement?.querySelector<HTMLElement>(
      `:scope > .${barClass}`,
    ) ?? null
  )
}

/** Whether the primary pointer is fine, so the page, not the system, draws the caret. */
export function drawsOverlays(win: Window | null | undefined): boolean {
  return !!win?.matchMedia?.('(pointer: fine)').matches
}
