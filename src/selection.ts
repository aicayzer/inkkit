import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** The stylesheet paints the selection under this name. */
const name = 'inkkit-selection'
const activeClass = 'inkkit-selection-active'

interface Span {
  from: number
  to: number
}

/** The selected text within each block. */
function covered(state: EditorState): Span[] {
  const { from, to, empty, visible } = state.selection
  if (empty || !visible) return []
  const text: Span[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const start = Math.max(from, pos + 1)
    const end = Math.min(to, pos + node.nodeSize - 1)
    if (end > start) text.push({ from: start, to: end })
    return false
  })
  return text
}

function domRange(view: EditorView, span: Span): Range {
  const start = view.domAtPos(span.from)
  const end = view.domAtPos(span.to)
  const range = view.dom.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

const rootOf = (view: EditorView) =>
  view.dom.closest<HTMLElement>('.inkkit-root')!

// Paint only selected text, without WebKit filling the surrounding margins.
// An engine without the Custom Highlight API, or one that cannot style its
// highlights (Firefox before 149), keeps its own selection, so the editor
// still mounts and the selection stays visible.
const paintable = () =>
  typeof Highlight === 'function' &&
  'highlights' in CSS &&
  CSS.supports(`selector(::highlight(${name}))`)

/**
 * Whether the view holds the user's input: its formatted surface, or the source or TXT
 * textarea beside it, has focus, or, in a read-only editor that takes no focus, the
 * document selection is inside it.
 */
function focused(view: EditorView): boolean {
  const doc = view.dom.ownerDocument
  const surface = doc.activeElement
  if (
    surface === view.dom ||
    view.dom.contains(surface) ||
    (surface instanceof HTMLTextAreaElement &&
      surface.classList.contains('inkkit-plain') &&
      rootOf(view).contains(surface))
  )
    return true
  const anchor = doc.getSelection()?.anchorNode
  return !view.editable && !!anchor && view.dom.contains(anchor)
}

/** Whether the focused element takes typing, so a selection kept elsewhere is still what the host is working on. */
function takesText(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}

/**
 * One document has one selection, so the editors on it share one painter and one highlight.
 * The owner is the editor that most recently held the selection. Its selection is painted
 * in the active colour while it has focus in a focused window, and in the inactive colour
 * otherwise, so a host that selects a range from its search field, or blurs the editor,
 * still shows what is selected. Anything that takes the selection elsewhere releases it.
 */
class Painter {
  private static readonly all = new WeakMap<Document, Painter>()
  // The root is read once: it is gone from the page by the time the view is destroyed.
  private readonly views = new Map<EditorView, HTMLElement>()
  private readonly win: Window
  private readonly custom = paintable()
  private owner: EditorView | null = null
  private windowFocused: boolean

  static of(doc: Document): Painter {
    let painter = Painter.all.get(doc)
    if (!painter) Painter.all.set(doc, (painter = new Painter(doc)))
    return painter
  }

  private constructor(private readonly doc: Document) {
    this.win = doc.defaultView!
    this.windowFocused = doc.hasFocus()
  }

  add(view: EditorView): void {
    if (!this.views.size) this.listen('add')
    this.views.set(view, rootOf(view))
    this.sync()
  }

  remove(view: EditorView): void {
    this.views.get(view)?.classList.remove(activeClass)
    this.views.delete(view)
    if (this.owner === view) this.owner = null
    this.sync()
    if (!this.views.size) {
      this.listen('remove')
      Painter.all.delete(this.doc)
    }
  }

  /** A transaction gave this view a selection. A focused owner is not taken over by an editor that is not. */
  take(view: EditorView): void {
    if (
      !this.owner ||
      this.owner === view ||
      focused(view) ||
      !focused(this.owner)
    )
      this.owner = view
    this.sync()
  }

  /** The owner's document changed, or its selection moved with it. */
  changed(view: EditorView): void {
    if (this.owner === view) this.sync()
  }

  private readonly onFocusIn = () => {
    for (const view of this.views.keys()) if (focused(view)) this.owner = view
    this.sync()
  }

  private readonly onFocusOut = () => this.sync()

  private readonly onWindow = (event: Event) => {
    this.windowFocused = event.type === 'focus'
    this.sync()
  }

  // The owner keeps its highlight while focus is in another field, or after the host
  // blurs it (the engine then drops its own selection). A selection made anywhere else
  // on the page replaces it, as it would a native selection.
  private readonly onSelectionChange = () => {
    const owner = this.owner
    if (!owner || focused(owner)) return
    const selection = this.doc.getSelection()
    if (!selection?.rangeCount || owner.dom.contains(selection.anchorNode))
      return
    if (selection.isCollapsed && takesText(this.doc.activeElement)) return
    this.owner = null
    this.sync()
  }

  private listen(action: 'add' | 'remove'): void {
    const method = `${action}EventListener` as const
    this.doc[method]('focusin', this.onFocusIn)
    this.doc[method]('focusout', this.onFocusOut)
    this.doc[method]('selectionchange', this.onSelectionChange)
    this.win[method]('focus', this.onWindow)
    this.win[method]('blur', this.onWindow)
  }

  private sync(): void {
    for (const [view, root] of this.views)
      root.classList.toggle(activeClass, this.windowFocused && focused(view))
    if (!this.custom) return
    const { owner } = this
    const spans = owner ? covered(owner.state) : []
    if (!owner || !spans.length) {
      CSS.highlights.delete(name)
      return
    }
    const highlight = new Highlight()
    for (const span of spans) highlight.add(domRange(owner, span))
    CSS.highlights.set(name, highlight)
  }
}

export const selectionPlugin = $prose(() => {
  // Counts the transactions that set a selection, which separates a view that was given
  // one from a view whose document changed.
  const key = new PluginKey<number>('selection')
  return new Plugin<number>({
    key,
    state: {
      init: () => 0,
      apply: (tr, count) => (tr.selectionSet ? count + 1 : count),
    },
    props: paintable()
      ? { attributes: { class: 'inkkit-painted-selection' } }
      : {},
    view(view) {
      const painter = Painter.of(view.dom.ownerDocument)
      painter.add(view)
      return {
        update(view, previous) {
          if (key.getState(view.state) !== key.getState(previous))
            painter.take(view)
          else painter.changed(view)
        },
        destroy: () => painter.remove(view),
      }
    },
  })
})
