import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/** The stylesheet paints the selection under this name. */
const name = 'selection'

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

function paint(view: EditorView, highlight: Highlight): void {
  highlight.clear()
  for (const span of covered(view.state) ?? [])
    highlight.add(domRange(view, span))
}

// Paint only selected text, without WebKit filling the surrounding margins.
export const selectionPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('selection'),
      view(view) {
        const highlight = new Highlight()
        CSS.highlights.set(name, highlight)
        paint(view, highlight)
        return {
          update: (view) => paint(view, highlight),
          destroy: () => CSS.highlights.delete(name),
        }
      },
    }),
)
