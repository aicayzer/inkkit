import { expect, it, vi } from 'vitest'
import { createDropIndicatorPlugin } from 'prosemirror-drop-indicator'
import type { EditorView } from '@milkdown/kit/prose/view'

it('cancels a pending hide when the drop indicator view is destroyed', () => {
  vi.useFakeTimers()
  try {
    const dom = document.createElement('div')
    const onHide = vi.fn()
    const plugin = createDropIndicatorPlugin({ onHide })
    const view = { dom } as unknown as EditorView
    const pluginView = plugin.spec.view!(view)
    dom.dispatchEvent(new Event('dragleave'))
    pluginView.destroy!()
    vi.runAllTimers()
    expect(onHide).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})
