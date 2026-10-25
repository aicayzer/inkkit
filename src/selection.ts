import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** The stylesheet paints the selection under this name. */
const name = 'inkkit-selection'
const windowActivity = new WeakMap<HTMLElement, boolean>()
const presentations = new WeakMap<HTMLElement, { update(): void }>()

export function setSelectionWindowActive(
  root: HTMLElement,
  active: boolean,
): void {
  windowActivity.set(root, active)
  presentations.get(root)?.update()
}
const ranges = new Map<EditorView, Range[]>()

interface Span {
  from: number
  to: number
}

/** The selected text within each block. */
function covered(state: EditorState): Span[] | null {
  const { from, to, empty, visible } = state.selection
  if (empty || !visible) return null
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
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

function paint(view: EditorView): void {
  ranges.set(
    view,
    (covered(view.state) ?? []).map((span) => domRange(view, span)),
  )
  refresh()
}

function refresh(): void {
  if (ranges.size === 0) {
    CSS.highlights.delete(name)
    return
  }
  const highlight = new Highlight()
  for (const selection of ranges.values())
    for (const range of selection) highlight.add(range)
  CSS.highlights.set(name, highlight)
}

function presentation(view: EditorView): () => void {
  const root = view.dom.closest<HTMLElement>('.inkkit-root')!
  const doc = root.ownerDocument
  const win = doc.defaultView!
  let windowFocused = doc.hasFocus()
  const state = {
    update() {
      const surface = doc.activeElement
      const focused =
        surface === view.dom ||
        (surface instanceof HTMLTextAreaElement &&
          surface.classList.contains('inkkit-plain') &&
          root.contains(surface))
      root.classList.toggle(
        'inkkit-selection-active',
        focused && windowFocused && (windowActivity.get(root) ?? true),
      )
    },
  }
  const focus = () => {
    windowFocused = true
    state.update()
  }
  const blur = () => {
    windowFocused = false
    state.update()
  }
  presentations.set(root, state)
  root.addEventListener('focusin', state.update)
  root.addEventListener('focusout', state.update)
  win.addEventListener('focus', focus)
  win.addEventListener('blur', blur)
  state.update()
  return () => {
    presentations.delete(root)
    root.classList.remove('inkkit-selection-active')
    root.removeEventListener('focusin', state.update)
    root.removeEventListener('focusout', state.update)
    win.removeEventListener('focus', focus)
    win.removeEventListener('blur', blur)
  }
}

// Paint only selected text, without WebKit filling the surrounding margins.
// An engine without the Custom Highlight API, or one that cannot style its
// highlights (Firefox before 149), keeps its own selection, so the editor
// still mounts and the selection stays visible.
const paintable = () =>
  typeof Highlight === 'function' &&
  'highlights' in CSS &&
  CSS.supports(`selector(::highlight(${name}))`)

export const selectionPlugin = $prose(() => {
  const custom = paintable()
  return new Plugin({
    key: new PluginKey('selection'),
    props: custom ? { attributes: { class: 'inkkit-painted-selection' } } : {},
    view(view) {
      const dispose = presentation(view)
      if (custom) paint(view)
      return {
        update: (view) => {
          if (custom) paint(view)
        },
        destroy: () => {
          dispose()
          if (custom) {
            ranges.delete(view)
            refresh()
          }
        },
      }
    },
  })
})
