import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { footnoteReferencePosition } from './editor-footnotes'
import { modHeld, trackLinkModifier } from './modifier'

interface ActivationRuntime {
  view(): EditorView
  footnote(): void
  openLink(href: string): void
  report(error: unknown): void
}

/** Owns link and footnote activation listeners on the editor root. */
export class EditorActivation {
  private untrackModifier?: () => void
  constructor(
    private readonly root: HTMLElement,
    private readonly runtime: ActivationRuntime,
  ) {
    root.addEventListener('keydown', this.footnoteKey, true)
    root.addEventListener('click', this.click)
    root.addEventListener('auxclick', this.auxClick)
  }

  trackModifier(): void {
    this.untrackModifier = trackLinkModifier(this.root)
  }

  destroy(): void {
    this.root.removeEventListener('click', this.click)
    this.root.removeEventListener('auxclick', this.auxClick)
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
    const position = footnoteReferencePosition(view.state.doc, identifier)
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
    if (event.button !== 0 || !modHeld(event)) return
    // Rendering has already refused addresses outside the allowed schemes.
    const href = anchor.getAttribute('href')
    if (href) this.runtime.openLink(href)
  }

  private auxClick = (event: MouseEvent): void => {
    if ((event.target as HTMLElement).closest('a[href]')) event.preventDefault()
  }
}
