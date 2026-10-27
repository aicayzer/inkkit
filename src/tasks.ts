import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { wrapInBulletListCommand } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { editorLabels } from './labels'

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
export function taskListPlugin(run: (operation: () => boolean) => boolean) {
  return $prose((ctx) => {
    const controls = new Set<() => void>()
    function decorations(
      doc: ProseNode,
      from = 0,
      to = doc.content.size,
      items = new Set<number>(),
    ): Decoration[] {
      const widgets: Decoration[] = []
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock) return false
        if (node.type.name !== 'list_item') return
        items.add(pos + 1)
        if (node.attrs.checked == null) return
        widgets.push(
          Decoration.widget(
            pos + 1,
            (view, getPos) => {
              const checkbox = document.createElement('span')
              checkbox.className = 'inkkit-task-checkbox'
              checkbox.contentEditable = 'false'
              checkbox.tabIndex = 0
              checkbox.setAttribute('role', 'checkbox')
              const current = () => {
                const at = getPos()
                return at == null ? undefined : view.state.doc.nodeAt(at - 1)
              }
              const update = () => {
                const task = current()
                checkbox.setAttribute(
                  'aria-checked',
                  String(!!task?.attrs.checked),
                )
                checkbox.setAttribute('aria-readonly', String(!view.editable))
                checkbox.setAttribute(
                  'aria-label',
                  task?.firstChild?.textContent ||
                    editorLabels(ctx).taskCheckbox,
                )
              }
              controls.add(update)
              update()
              const toggle = () => {
                const at = getPos()
                const focused = document.activeElement === checkbox
                run(() => at != null && toggleTaskAt(view, at - 1))
                // Changing list-item attributes may replace its DOM. Restore a
                // keyboard-focused control, but never steal pointer focus.
                if (focused && at != null)
                  (view.nodeDOM(at - 1) as HTMLElement | null)
                    ?.querySelector<HTMLElement>(
                      ':scope > .inkkit-task-checkbox',
                    )
                    ?.focus({ preventScroll: true })
              }
              checkbox.addEventListener('mousedown', (event) =>
                event.preventDefault(),
              )
              checkbox.addEventListener('click', (event) => {
                event.preventDefault()
                toggle()
              })
              checkbox.addEventListener('keydown', (event) => {
                if (event.key !== ' ' && event.key !== 'Enter') return
                event.preventDefault()
                event.stopPropagation()
                toggle()
              })
              ;(checkbox as HTMLElement & { cleanup: () => void }).cleanup =
                () => controls.delete(update)
              return checkbox
            },
            {
              side: -1,
              key: 'task-checkbox',
              ignoreSelection: true,
              stopEvent: () => true,
              destroy: (node) =>
                (node as HTMLElement & { cleanup: () => void }).cleanup(),
            },
          ),
        )
      })
      return widgets
    }
    function update(previous: DecorationSet, tr: Transaction): DecorationSet {
      let mapped = previous.map(tr.mapping, tr.doc)
      const ranges: [number, number][] = []
      tr.mapping.maps.forEach((map, index) => {
        const rest = tr.mapping.slice(index + 1)
        map.forEach((_, __, from, to) =>
          ranges.push([rest.map(from, -1), rest.map(to, 1)]),
        )
      })
      // Attribute-only steps can have no mapped range. Ordinary typing never
      // scans unchanged blocks, including in a document with no tasks.
      if (ranges.length === 0) {
        const start = tr.before.content.findDiffStart(tr.doc.content)
        const end = tr.before.content.findDiffEnd(tr.doc.content)
        if (start != null && end) ranges.push([start, Math.max(start, end.b)])
      }
      for (const [from, to] of ranges) {
        const items = new Set<number>()
        const widgets = decorations(tr.doc, from, to, items)
        const stale = new Set(mapped.find(from, to))
        // Ancestor list items can start before the changed text range.
        for (const pos of items)
          for (const widget of mapped.find(pos, pos)) stale.add(widget)
        mapped = mapped.remove([...stale]).add(tr.doc, widgets)
      }
      return mapped
    }
    return new Plugin<DecorationSet>({
      key: new PluginKey('taskToggle'),
      state: {
        init: (_, state) =>
          DecorationSet.create(state.doc, decorations(state.doc)),
        apply: (tr, previous) =>
          tr.docChanged ? update(previous, tr) : previous,
      },
      props: {
        decorations(state) {
          return this.getState(state)
        },
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
            event.preventDefault()
            run(() => toggleTaskAt(view, nodePos))
            return true
          },
        },
      },
      view: (view) => {
        let editable = view.editable
        return {
          update(view, previousState) {
            if (
              previousState.doc === view.state.doc &&
              editable === view.editable
            )
              return
            editable = view.editable
            controls.forEach((update) => update())
          },
        }
      },
    })
  })
}

function toggleTaskAt(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos)
  if (node?.type.name !== 'list_item' || node.attrs.checked == null)
    return false
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: !node.attrs.checked,
    }),
  )
  return true
}

export function taskAtCaret(state: EditorState): number | undefined {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'list_item')
      return node.attrs.checked == null ? undefined : $from.before(depth)
  }
  return undefined
}

export function toggleTask(ctx: Ctx): boolean {
  const view = ctx.get(editorViewCtx)
  const pos = taskAtCaret(view.state)
  return pos != null && toggleTaskAt(view, pos)
}

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
