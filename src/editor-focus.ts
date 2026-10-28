import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'

export function releaseFocus(
  root: HTMLElement,
  view: EditorView,
  source: HTMLTextAreaElement,
): void {
  const document = root.ownerDocument
  const surface = view.dom
  const active = document.activeElement
  if (active === source) {
    source.blur()
    return
  }
  if (active === surface) surface.blur()
  else if (active && active !== document.body) return
  // WebKit keeps typing into a contenteditable that has lost focus while the document
  // selection is still in it, including after the host blurred it itself.
  const selection = document.getSelection()
  if (selection?.anchorNode && surface.contains(selection.anchorNode))
    selection.removeAllRanges()
}

interface ReloadSurface {
  literal: boolean
  selectedNode: ProseNode | undefined
  at: number
  end: number
  direction: HTMLTextAreaElement['selectionDirection']
  container: HTMLElement
  top: number
  left: number
  focused: boolean
  plainTop: number
  plainLeft: number
}

export function captureReloadSurface(
  view: EditorView,
  source: HTMLTextAreaElement,
  container: HTMLElement,
  literal: boolean,
): ReloadSurface {
  const selectedNode =
    !literal && view.state.selection instanceof NodeSelection
      ? view.state.selection.node
      : undefined
  const at = literal ? source.selectionStart : view.state.selection.anchor
  const end = literal ? source.selectionEnd : view.state.selection.head
  const direction = source.selectionDirection
  const top = container.scrollTop,
    left = container.scrollLeft
  const focused = literal ? document.activeElement === source : view.hasFocus()
  const plainTop = source.scrollTop,
    plainLeft = source.scrollLeft
  return {
    literal,
    selectedNode,
    at,
    end,
    direction,
    container,
    top,
    left,
    focused,
    plainTop,
    plainLeft,
  }
}

export function restoreReloadSurface(
  view: EditorView,
  source: HTMLTextAreaElement,
  literal: () => boolean,
  saved: ReloadSurface,
): void {
  const {
    selectedNode,
    at,
    end,
    direction,
    container,
    top,
    left,
    focused,
    plainTop,
    plainLeft,
  } = saved
  if (literal())
    source.setSelectionRange(
      Math.min(at, source.value.length),
      Math.min(end, source.value.length),
      direction,
    )
  else {
    const anchor = Math.min(at, view.state.doc.content.size)
    const node = view.state.doc.nodeAt(anchor)
    view.dispatch(
      view.state.tr.setSelection(
        selectedNode &&
          node?.type === selectedNode.type &&
          NodeSelection.isSelectable(node)
          ? NodeSelection.create(view.state.doc, anchor)
          : TextSelection.between(
              view.state.doc.resolve(anchor),
              view.state.doc.resolve(
                Math.min(end, view.state.doc.content.size),
              ),
            ),
      ),
    )
  }
  if (focused) {
    if (literal()) source.focus({ preventScroll: true })
    else view.focus()
  }
  container.scrollTop = top
  container.scrollLeft = left
  if (saved.literal && literal()) {
    source.scrollTop = plainTop
    source.scrollLeft = plainLeft
  }
}
