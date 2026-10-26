import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'
import { wikiLinkSchema, wikiReference } from './linked-syntax'
import { mediaPolicyEvent, refreshOf, refreshes } from './files'
import { modHeld } from './modifier'
import type {
  DocumentContext,
  InkKitError,
  WikiLinkAdapter,
  WikiLinkReference,
} from './types'
import { coded } from './errors'
import type { EditorLabels } from './types'

interface WikiRuntime {
  capture(): { context: DocumentContext; isCurrent(): boolean }
  active(): boolean
  labels: Readonly<EditorLabels>
  error?(error: InkKitError): void
}

export function wikiLinkView(adapter: WikiLinkAdapter, runtime: WikiRuntime) {
  return $view(wikiLinkSchema, () => (node, view: EditorView) => {
    let current = node
    const dom = document.createElement('span')
    dom.className = 'inkkit-wiki-link'
    dom.setAttribute('role', 'link')
    dom.tabIndex = 0
    const reference = (): WikiLinkReference => wikiReference(current)
    const report = (error: unknown) =>
      runtime.error?.(coded(error, 'file-unavailable'))
    const render = () => {
      const { label } = reference()
      if (dom.textContent !== label) dom.textContent = label
      let missing = false
      if (runtime.active()) {
        const captured = runtime.capture()
        try {
          const result = adapter.resolve?.(reference(), captured.context)
          missing = captured.isCurrent() && Boolean(result?.missing)
        } catch (error) {
          report(error)
        }
      }
      // The link is still activatable, so it is described rather than disabled.
      if (missing) {
        dom.dataset.missing = 'true'
        dom.title = runtime.labels.wikiMissing
        dom.setAttribute('aria-description', runtime.labels.wikiMissing)
      } else {
        dom.removeAttribute('data-missing')
        dom.removeAttribute('title')
        dom.removeAttribute('aria-description')
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
      if (event.button === 0 && modHeld(event)) open(event)
    })
    dom.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') open(event)
    })
    const policy = (event: Event) => {
      const refresh = refreshOf(event)
      if (!refresh || refreshes(refresh, String(current.attrs.target))) render()
    }
    view.dom.addEventListener(mediaPolicyEvent, policy)
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
        view.dom.removeEventListener(mediaPolicyEvent, policy)
      },
    } satisfies NodeView
  })
}
