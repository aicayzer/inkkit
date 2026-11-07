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
  WikiLinkPresentation,
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

interface DrawnIcon {
  url: string
  color?: string
}

interface Drawn {
  icon?: DrawnIcon
  tint?: string
}

/** Whether the style engine reads the text as one color, so a value cannot carry a second
 *  declaration into the property it is written to. */
function checkedColor(value: unknown, what: string): string {
  const probe = document.createElement('span')
  if (typeof value === 'string') probe.style.color = value
  if (probe.style.color === '')
    throw new TypeError(`Wiki link ${what} must be a color`)
  return value as string
}

/** What a link draws beyond its text: an icon, which is decoration drawn as a CSS mask, so a URL
 *  that fetches from the network or runs script is refused, and a tint, a color for a host's look
 *  to fill the link with. Either one that cannot be drawn refuses both. */
function drawn(presentation: WikiLinkPresentation): Drawn {
  const { icon, iconColor, tint } = presentation
  const result: Drawn = {}
  if (tint !== undefined) result.tint = checkedColor(tint, 'tint')
  if (icon === undefined) return result
  if (typeof icon !== 'string' || !icon.trim())
    throw new TypeError('Wiki link icon needs a URL')
  // The address that is checked is the address that is fetched: a relative one would otherwise
  // resolve against the stylesheet that reads the variable, not against the page.
  const url = new URL(icon, document.baseURI)
  if (['http:', 'https:', 'javascript:', 'vbscript:'].includes(url.protocol))
    throw new TypeError('Wiki link icons must load offline')
  if (url.protocol === 'data:' && !/^image\//i.test(url.pathname))
    throw new TypeError('Wiki link icon data URL must be an image')
  result.icon =
    iconColor === undefined
      ? { url: url.href }
      : { url: url.href, color: checkedColor(iconColor, 'icon color') }
  return result
}

/** A quoted CSS url() whose text cannot end the string or the declaration early. */
const cssUrl = (url: string) =>
  `url("${url.replace(/[\\"\n\r\f]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `)}")`

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The first character a reader sees, so a combining mark stays with its base. */
const firstGrapheme = (label: string) =>
  graphemes.segment(label)[Symbol.iterator]().next().value?.segment ?? ''

export function wikiLinkView(adapter: WikiLinkAdapter, runtime: WikiRuntime) {
  return $view(wikiLinkSchema, () => (node, view: EditorView) => {
    let current = node
    const dom = document.createElement('span')
    dom.className = 'inkkit-wiki-link'
    dom.setAttribute('role', 'link')
    dom.tabIndex = 0
    // The rest of the label. With an icon, its first character is in `lead`, which draws the icon
    // before it as generated content: no node of its own, so no text, no caret step and nothing in
    // the clipboard. The icon and that character cannot be split across lines, and the character
    // is the only text held that way, so a long first word still wraps.
    const text = document.createTextNode('')
    dom.append(text)
    let lead: { box: HTMLElement; text: Text } | undefined
    const showLabel = (label: string, icon: DrawnIcon | undefined) => {
      if (!icon) {
        lead?.box.remove()
        lead = undefined
        if (text.data !== label) text.data = label
        return
      }
      if (!lead) {
        const box = document.createElement('span')
        box.className = 'inkkit-wiki-link-lead'
        const leadText = document.createTextNode('')
        box.append(leadText)
        dom.insertBefore(box, text)
        lead = { box, text: leadText }
      }
      const first = firstGrapheme(label)
      if (lead.text.data !== first) lead.text.data = first
      const rest = label.slice(first.length)
      if (text.data !== rest) text.data = rest
      lead.box.style.setProperty('--_inkkit-wiki-icon', cssUrl(icon.url))
      if (icon.color)
        lead.box.style.setProperty('--_inkkit-wiki-icon-color', icon.color)
      else lead.box.style.removeProperty('--_inkkit-wiki-icon-color')
    }
    const reference = (): WikiLinkReference => wikiReference(current)
    const report = (error: unknown) =>
      runtime.error?.(coded(error, 'file-unavailable'))
    const render = () => {
      const { label } = reference()
      let missing = false
      let look: Drawn = {}
      if (runtime.active()) {
        const captured = runtime.capture()
        try {
          const result = adapter.resolve?.(reference(), captured.context)
          missing = captured.isCurrent() && Boolean(result?.missing)
          // A missing target has no kind of item to show.
          if (result && captured.isCurrent() && !missing) look = drawn(result)
        } catch (error) {
          report(error)
        }
      }
      showLabel(label, look.icon)
      if (look.tint)
        dom.style.setProperty('--_inkkit-wiki-link-tint', look.tint)
      else dom.style.removeProperty('--_inkkit-wiki-link-tint')
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
