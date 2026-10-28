import {
  Plugin,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorLabels } from './types'

export interface SuggestionRow {
  name: string
  glyph: string
  choose(): void
}
export interface SuggestionSession {
  from: number
  prefix: string
  base: EditorState
  query: string
  valid?(view: EditorView): boolean
  cancel?(): void
  update(query: string, show: (rows: SuggestionRow[]) => void): void
}
interface SuggestionHost {
  root: HTMLElement
  labels: Readonly<EditorLabels>
  active(): boolean
  start(
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ): SuggestionSession | undefined
}
let sequence = 0

/** One focused text surface owns one suggestions list; providers own only matching and edits. */
export class Suggestions {
  private session?: SuggestionSession
  private view?: EditorView
  private rows: SuggestionRow[] = []
  private selected = 0
  private request = 0
  private emptyTimer?: ReturnType<typeof setTimeout>
  private popup: HTMLDivElement
  private status: HTMLDivElement
  private id = `inkkit-suggestions-${++sequence}`
  private attributes = new Map<string, string | null>()
  private lastDoc?: EditorState['doc']
  constructor(private host: SuggestionHost) {
    this.popup = document.createElement('div')
    this.popup.className = 'inkkit-suggestions'
    this.popup.id = this.id
    this.popup.setAttribute('role', 'listbox')
    this.popup.setAttribute('aria-label', host.labels.suggestions)
    this.status = document.createElement('div')
    this.status.className = 'inkkit-suggestions-status'
    this.status.setAttribute('aria-live', 'polite')
    this.status.setAttribute('aria-atomic', 'true')
  }
  close = (): void => {
    this.request++
    clearTimeout(this.emptyTimer)
    this.session?.cancel?.()
    this.session = undefined
    this.popup.remove()
    this.status.remove()
    this.rows = []
    const surface = this.view?.dom
    if (surface)
      for (const [key, value] of this.attributes) {
        if (value === null) surface.removeAttribute(key)
        else surface.setAttribute(key, value)
      }
    this.attributes.clear()
  }
  beforeTransaction(tr: Transaction): void {
    if (
      this.session &&
      !tr.docChanged &&
      (!tr.isGeneric ||
        tr.storedMarksSet ||
        (tr.selectionSet && !tr.selection.eq(this.view!.state.selection)))
    )
      this.close()
  }
  private outside = (event: Event) => {
    if (!this.popup.contains(event.target as Node)) this.close()
  }
  private viewportBounds() {
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft ?? 0
    const top = viewport?.offsetTop ?? 0
    return {
      left,
      top,
      right: left + (viewport?.width ?? window.innerWidth),
      bottom: top + (viewport?.height ?? window.innerHeight),
    }
  }
  private scroll = (event: Event) => {
    if (
      !this.session ||
      (event.target instanceof Node && this.popup.contains(event.target))
    )
      return
    const caret = this.view!.coordsAtPos(this.view!.state.selection.from)
    const root = this.host.root.getBoundingClientRect()
    const viewport = this.viewportBounds()
    if (
      caret.bottom < Math.max(viewport.top, root.top) ||
      caret.top > Math.min(viewport.bottom, root.bottom) ||
      caret.right < Math.max(viewport.left, root.left) ||
      caret.left > Math.min(viewport.right, root.right)
    )
      this.close()
    else this.position()
  }
  private activate() {
    const surface = this.view!.dom
    for (const [key, value] of Object.entries({
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'true',
      'aria-controls': this.id,
      'aria-activedescendant': '',
    })) {
      this.attributes.set(key, surface.getAttribute(key))
      surface.setAttribute(key, value)
    }
    this.attributes.set(
      'aria-multiline',
      surface.getAttribute('aria-multiline'),
    )
    surface.removeAttribute('aria-multiline')
    this.host.root.append(this.popup, this.status)
  }
  show = (rows: SuggestionRow[]) => {
    if (!this.session) return
    clearTimeout(this.emptyTimer)
    this.popup.removeAttribute('aria-busy')
    this.rows = rows
    this.selected = 0
    this.popup.replaceChildren()
    if (!rows.length) {
      const empty = document.createElement('div')
      empty.setAttribute('role', 'option')
      empty.setAttribute('aria-disabled', 'true')
      empty.textContent = this.host.labels.suggestionsEmpty
      this.popup.append(empty)
      this.status.textContent = this.host.labels.suggestionsEmpty
      this.view!.dom.removeAttribute('aria-activedescendant')
      this.emptyTimer = setTimeout(this.close, 650)
    }
    rows.forEach((row, index) => {
      const element = document.createElement('div')
      element.id = `${this.id}-${index}`
      element.setAttribute('role', 'option')
      const glyph = document.createElement('span')
      glyph.className = 'inkkit-suggestion-glyph'
      glyph.setAttribute('aria-hidden', 'true')
      // Generated content keeps the row's readable text equal to its name.
      glyph.dataset.glyph = row.glyph
      element.append(glyph, document.createTextNode(row.name))
      element.addEventListener('mousedown', (event) => event.preventDefault())
      element.addEventListener('click', () => row.choose())
      this.popup.append(element)
    })
    this.highlight()
    this.position()
  }
  private highlight() {
    for (const [index, element] of [...this.popup.children].entries())
      element.setAttribute(
        'aria-selected',
        String(this.rows.length > 0 && index === this.selected),
      )
    if (!this.rows.length) return
    const element = this.popup.children[this.selected] as HTMLElement
    this.view!.dom.setAttribute('aria-activedescendant', element.id)
    this.status.textContent = this.rows[this.selected]!.name
    const top = element.offsetTop,
      bottom = top + element.offsetHeight
    if (top < this.popup.scrollTop) this.popup.scrollTop = top
    else if (bottom > this.popup.scrollTop + this.popup.clientHeight)
      this.popup.scrollTop = bottom - this.popup.clientHeight
  }
  private position() {
    const view = this.view!
    const caret = view.coordsAtPos(view.state.selection.from)
    const viewport = this.viewportBounds()
    const left = viewport.left + 4
    const top = viewport.top + 4
    const right = viewport.right - 4
    const bottom = viewport.bottom - 4
    this.popup.style.maxWidth = `${Math.max(0, right - left)}px`
    // Measure the CSS row limit again when a keyboard or pinch zoom changes
    // the visible viewport, so a previously shortened list can grow back.
    this.popup.style.maxHeight = ''
    const naturalHeight = this.popup.getBoundingClientRect().height
    const below = Math.max(0, bottom - caret.bottom - 4)
    const above = Math.max(0, caret.top - top - 4)
    const opensAbove = below < naturalHeight && above > below
    this.popup.style.maxHeight = `${Math.min(naturalHeight, opensAbove ? above : below)}px`
    const rect = this.popup.getBoundingClientRect()
    const popupTop = opensAbove ? caret.top - rect.height - 4 : caret.bottom + 4
    this.popup.style.left = `${Math.max(left, Math.min(caret.left, right - rect.width))}px`
    this.popup.style.top = `${Math.max(top, Math.min(popupTop, bottom - rect.height))}px`
  }
  refresh = () => {
    const session = this.session,
      view = this.view
    if (!session || !view) return
    if (!this.host.active() || view.composing || !view.state.selection.empty)
      return this.close()
    const { from, $from } = view.state.selection
    if (
      from < session.from + session.prefix.length ||
      $from.start() > session.from
    )
      return this.close()
    const typed = view.state.doc.textBetween(session.from, from, '\n', '\ufffc')
    if (!typed.startsWith(session.prefix) || /[\n\r\ufffc]/.test(typed))
      return this.close()
    if (session.valid && !session.valid(view)) return this.close()
    const query = typed.slice(session.prefix.length)
    if (this.lastDoc === view.state.doc && query !== session.query)
      return this.close()
    this.lastDoc = view.state.doc
    if (query === session.query && this.popup.isConnected) return
    session.query = query
    if (!this.popup.isConnected) this.activate()
    const request = ++this.request
    clearTimeout(this.emptyTimer)
    this.rows = []
    this.popup.textContent = this.host.labels.suggestionsLoading
    this.popup.setAttribute('aria-busy', 'true')
    this.view!.dom.removeAttribute('aria-activedescendant')
    this.status.textContent = ''
    this.position()
    session.update(query, (rows) => {
      if (
        request === this.request &&
        this.session === session &&
        this.host.active()
      )
        this.show(rows)
    })
  }
  plugin() {
    return new Plugin({
      props: {
        handleTextInput: (view, from, to, text) => {
          if (!this.session && this.host.active() && !view.composing) {
            this.session = this.host.start(view, from, to, text)
            if (this.session) {
              this.session.query = '\0'
              this.lastDoc = undefined
            }
          }
          return false
        },
        handleKeyDown: (_view, event) => {
          if (!this.session || event.isComposing) return false
          if (event.key === 'Escape') {
            this.close()
            return true
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (this.rows.length)
              this.selected =
                (this.selected +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  this.rows.length) %
                this.rows.length
            this.highlight()
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            this.rows[this.selected]?.choose()
            return this.rows.length > 0 || !this.session
          }
          if (
            ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
            event.metaKey ||
            event.ctrlKey
          )
            this.close()
          return false
        },
        handleDOMEvents: {
          compositionstart: () => {
            this.close()
            return false
          },
          blur: () => {
            this.close()
            return false
          },
        },
      },
      view: (view) => {
        this.view = view
        document.addEventListener('pointerdown', this.outside, true)
        document.addEventListener('scroll', this.scroll, true)
        window.addEventListener('resize', this.close)
        const viewport = window.visualViewport
        viewport?.addEventListener('resize', this.scroll)
        viewport?.addEventListener('scroll', this.scroll)
        return {
          update: () => this.refresh(),
          destroy: () => {
            this.close()
            document.removeEventListener('pointerdown', this.outside, true)
            document.removeEventListener('scroll', this.scroll, true)
            window.removeEventListener('resize', this.close)
            viewport?.removeEventListener('resize', this.scroll)
            viewport?.removeEventListener('scroll', this.scroll)
          },
        }
      },
    })
  }
}
