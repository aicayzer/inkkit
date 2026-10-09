import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'
import { wikiLinkSchema } from './linked-syntax'
import type {
  DocumentContext,
  WikiLinkAdapter,
  WikiLinkReference,
} from './types'
import type { EditorLabels } from './labels'

interface WikiRuntime {
  capture(): { context: DocumentContext; isCurrent(): boolean }
  active(): boolean
  labels: Readonly<EditorLabels>
  error?(error: Error): void
}

export function wikiLinkView(adapter: WikiLinkAdapter, runtime: WikiRuntime) {
  return $view(wikiLinkSchema, () => (node, view: EditorView) => {
    let current = node
    const dom = document.createElement('span')
    dom.className = 'inkkit-wiki-link'
    dom.setAttribute('role', 'link')
    dom.tabIndex = 0
    const reference = (): WikiLinkReference => ({
      target: String(current.attrs.target),
      ...(current.attrs.fragment
        ? { fragment: String(current.attrs.fragment) }
        : {}),
      label: String(current.attrs.label),
    })
    const report = (error: unknown) =>
      runtime.error?.(error instanceof Error ? error : new Error(String(error)))
    const render = () => {
      dom.textContent = reference().label
      dom.removeAttribute('title')
      dom.removeAttribute('data-missing')
      if (!runtime.active()) return
      const captured = runtime.capture()
      try {
        const result = adapter.resolve?.(reference(), captured.context)
        if (captured.isCurrent() && result?.missing) {
          dom.dataset.missing = 'true'
          dom.title = runtime.labels.wikiMissing
        }
      } catch (error) {
        report(error)
      }
    }
    const open = (event: Event) => {
      event.preventDefault()
      if (!runtime.active()) return
      const captured = runtime.capture()
      try {
        if (captured.isCurrent()) adapter.open(reference(), captured.context)
      } catch (error) {
        report(error)
      }
    }
    dom.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey) open(event)
    })
    dom.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') open(event)
    })
    view.dom.addEventListener('inkkit-media-policy', render)
    render()
    return {
      dom,
      update(next: ProseNode) {
        if (next.type !== current.type) return false
        current = next
        render()
        return true
      },
      stopEvent(event: Event) {
        return (
          event.type === 'keydown' &&
          ['Enter', ' '].includes((event as KeyboardEvent).key)
        )
      },
      ignoreMutation: () => true,
      destroy() {
        view.dom.removeEventListener('inkkit-media-policy', render)
      },
    } satisfies NodeView
  })
}
