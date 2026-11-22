import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { footnoteReferencePosition } from './editor-footnotes'
import { LinkHint } from './link-hint'
import { opensLink, trackLinkModifier } from './modifier'
import type { ClientPoint } from './types'

interface ActivationRuntime {
  view(): EditorView
  footnote(): void
  openLink(href: string): void
  /** Whether the person can edit. When not, a plain click opens a link. */
  editable(): boolean
  /** What to draw under a link that the pointer rests on, or undefined for no hint. */
  hint(link: Element): string | undefined
  /** Hands a link's context-menu request to the host. False when the host takes none or `element`
   *  is not a link, so the web view's own menu shows. */
  linkMenu(element: Element, point: ClientPoint): boolean
  report(error: unknown): void
}

function clickedReference(
  view: EditorView,
  element: Element,
  identifier: string | null,
): number | undefined {
  try {
    const position = view.posAtDOM(element, 0)
    const node = view.state.doc.nodeAt(position)
    return node?.type.name === 'footnote_reference' &&
      String(node.attrs.identifier) === identifier
      ? position
      : undefined
  } catch {
    return undefined
  }
}

/** Owns link and footnote activation listeners on the editor root. */
export class EditorActivation {
  private untrackModifier?: () => void
  private readonly hint: LinkHint
  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: ActivationRuntime,
  ) {
    root.addEventListener('keydown', this.footnoteKey, true)
    root.addEventListener('click', this.click)
    root.addEventListener('auxclick', this.auxClick)
    root.addEventListener('contextmenu', this.contextMenu)
    this.hint = new LinkHint(root, {
      text: (link) => runtime.hint(link),
    })
  }

  trackModifier(): void {
    this.untrackModifier = trackLinkModifier(this.root)
  }

  destroy(): void {
    this.root.removeEventListener('click', this.click)
    this.root.removeEventListener('auxclick', this.auxClick)
    this.root.removeEventListener('contextmenu', this.contextMenu)
    this.hint.destroy()
    this.untrackModifier?.()
    this.root.removeEventListener('keydown', this.footnoteKey, true)
  }

  private activateFootnote(event: MouseEvent | KeyboardEvent): boolean {
    const element = (event.target as HTMLElement).closest(
      '[data-inkkit-footnote-reference]',
    )
    if (!element) return false
    const identifier = element.getAttribute('data-inkkit-footnote-reference')
    const view = this.runtime.view()
    // The reference that was activated, not the first one with its label, which a fold may hide.
    const position =
      clickedReference(view, element, identifier) ??
      footnoteReferencePosition(view.state.doc, identifier)
    if (position == null) return false
    event.preventDefault()
    try {
      view.dispatch(
        view.state.tr.setSelection(
          NodeSelection.create(view.state.doc, position),
        ),
      )
      this.runtime.footnote()
    } catch (error) {
      this.runtime.report(error)
    }
    return true
  }

  private footnoteKey = (event: KeyboardEvent): void => {
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      this.activateFootnote(event)
    )
      event.stopPropagation()
  }

  private click = (event: MouseEvent): void => {
    if (this.activateFootnote(event)) return
    const anchor = (event.target as HTMLElement).closest('a[href]')
    if (!anchor) return
    // A read-only surface is not editable, so the browser would follow the link itself;
    // only the host opens links.
    event.preventDefault()
    if (!opensLink(event, this.runtime.editable())) return
    // Rendering has already refused addresses outside the allowed schemes.
    const href = anchor.getAttribute('href')
    if (href) this.runtime.openLink(href)
  }

  private auxClick = (event: MouseEvent): void => {
    if ((event.target as HTMLElement).closest('a[href]')) event.preventDefault()
  }

  private contextMenu = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const point = { clientX: event.clientX, clientY: event.clientY }
    if (this.runtime.linkMenu(event.target, point)) event.preventDefault()
  }
}
