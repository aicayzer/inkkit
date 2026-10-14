import {
  dropIndicatorConfig,
  dropIndicatorDOMPlugin,
  dropIndicatorState,
  gapCursorPlugin,
} from '@milkdown/kit/plugin/cursor'
import { Plugin } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { createDropIndicatorPlugin } from 'prosemirror-drop-indicator'

// Milkdown's drop indicator, except that it does not hide once the editor is
// gone. The indicator hides 30 ms after a drop or drag end, and setting its
// state after the editor is destroyed throws.
const dropIndicator = $prose((ctx) => {
  let live = false
  const plugin = createDropIndicatorPlugin({
    onShow: (options) => ctx.set(dropIndicatorState.key, options),
    onHide: () => {
      if (live) ctx.set(dropIndicatorState.key, null)
    },
    onDrag: () => true,
  })
  const view = plugin.spec.view!
  return new Plugin({
    ...plugin.spec,
    view(editorView) {
      live = true
      const inner = view(editorView)
      return {
        ...inner,
        destroy() {
          live = false
          inner.destroy?.()
        },
      }
    },
  })
})

export const cursor = [
  gapCursorPlugin,
  dropIndicatorConfig,
  dropIndicatorState,
  dropIndicatorDOMPlugin,
  dropIndicator,
].flat()
