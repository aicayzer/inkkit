import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** The stylesheet paints the selection under this name. */
const name = 'inkkit-selection'
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

// Paint only selected text, without WebKit filling the surrounding margins.
export const selectionPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('selection'),
      view(view) {
        paint(view)
        return {
          update: (view) => paint(view),
          destroy: () => {
            ranges.delete(view)
            refresh()
          },
        }
      },
    }),
)
