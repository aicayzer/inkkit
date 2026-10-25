import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { wrapInBulletListCommand } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

// The marker is a pseudo-element, so its events target the list item. Keep
// clicks in the item's padding or nested-list margins out of the control.
function onTaskMarker(event: MouseEvent): boolean {
  const target = event.target
  if (
    !(target instanceof HTMLElement) ||
    !target.matches('li[data-item-type="task"]')
  )
    return false
  const marker = getComputedStyle(target, '::before')
  const rect = target.getBoundingClientRect()
  const left = rect.left + parseFloat(marker.left)
  const top = rect.top + parseFloat(marker.top)
  return (
    event.clientX >= left &&
    event.clientX <= left + parseFloat(marker.width) &&
    event.clientY >= top &&
    event.clientY <= top + parseFloat(marker.height)
  )
}
export const taskListPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('taskToggle'),
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            if (!view.editable || event.button !== 0 || !onTaskMarker(event))
              return false
            // Toggling a control must not first move the native text selection.
            event.preventDefault()
            return true
          },

          click(view, event) {
            if (!view.editable || event.button !== 0 || !onTaskMarker(event))
              return false
            const nodePos = view.posAtDOM(event.target as HTMLElement, 0) - 1
            const node = view.state.doc.nodeAt(nodePos)
            if (node?.type.name !== 'list_item' || node.attrs.checked == null)
              return false
            event.preventDefault()
            view.dispatch(
              view.state.tr.setNodeMarkup(nodePos, undefined, {
                ...node.attrs,
                checked: !node.attrs.checked,
              }),
            )
            return true
          },
        },
      },
    }),
)

function listItemsInSelection(
  view: EditorView,
): Array<{ pos: number; node: ProseNode }> {
  const { from, to } = view.state.selection
  const items: Array<{ pos: number; node: ProseNode }> = []
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'list_item') items.push({ pos, node })
  })
  return items
}

export function toggleTaskList(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx)
  let items = listItemsInSelection(view)
  if (items.length === 0) {
    ctx.get(commandsCtx).call(wrapInBulletListCommand.key)
    items = listItemsInSelection(view)
  }
  const allTasks = items.every(({ node }) => node.attrs.checked != null)
  let tr = view.state.tr
  for (const { pos, node } of items) {
    tr = tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: allTasks ? null : (node.attrs.checked ?? false),
    })
  }
  view.dispatch(tr)
}
