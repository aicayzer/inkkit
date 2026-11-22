import { linkSelector } from './link-target'

interface HintHost {
  /** What to draw under this link, or undefined for no hint. */
  text(link: Element): string | undefined
}

/** How long the pointer rests on a link before the hint shows. */
const delay = 600
const gap = 6

/** A hint drawn under a link that the pointer rests on, outside the document so that its text
 *  never reaches the document, a copy or an edit. It shows nothing for touch, hides on any press,
 *  key, scroll or when the pointer leaves, and sits in the root so that the host's tokens style it. */
export class LinkHint {
  private link?: Element
  private point = { x: 0, y: 0 }
  private timer?: ReturnType<typeof setTimeout>
  private tip?: HTMLElement
  private readonly view: Window | null

  constructor(
    private readonly root: HTMLElement,
    private readonly host: HintHost,
  ) {
    this.view = root.ownerDocument.defaultView
    root.addEventListener('pointermove', this.move)
    root.addEventListener('pointerleave', this.hide)
    root.addEventListener('pointerdown', this.hide, true)
    root.addEventListener('contextmenu', this.hide, true)
    // Keys are read on the window, as Mod is: focus may be in a host control.
    this.view?.addEventListener('keydown', this.hide, true)
    this.view?.addEventListener('scroll', this.hide, true)
    this.view?.addEventListener('blur', this.hide)
  }

  destroy(): void {
    this.hide()
    this.root.removeEventListener('pointermove', this.move)
    this.root.removeEventListener('pointerleave', this.hide)
    this.root.removeEventListener('pointerdown', this.hide, true)
    this.root.removeEventListener('contextmenu', this.hide, true)
    this.view?.removeEventListener('keydown', this.hide, true)
    this.view?.removeEventListener('scroll', this.hide, true)
    this.view?.removeEventListener('blur', this.hide)
  }

  private hide = (): void => {
    clearTimeout(this.timer)
    this.timer = undefined
    this.link = undefined
    this.tip?.remove()
    this.tip = undefined
  }

  private move = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return
    const target = event.target
    const link =
      target instanceof Element ? target.closest(linkSelector) : undefined
    if (link === this.link) {
      this.point = { x: event.clientX, y: event.clientY }
      return
    }
    this.hide()
    if (!link || !this.root.contains(link)) return
    this.link = link
    this.point = { x: event.clientX, y: event.clientY }
    this.timer = setTimeout(() => this.show(link), delay)
  }

  private show(link: Element): void {
    this.timer = undefined
    // Mod held already shows the link as ready to open, and the pointer shows the hand.
    if (
      this.link !== link ||
      this.root.classList.contains('inkkit-link-modifier')
    )
      return
    const text = this.host.text(link)
    if (!text) return
    const tip = this.root.ownerDocument.createElement('div')
    tip.className = 'inkkit-link-hint'
    tip.setAttribute('role', 'tooltip')
    tip.textContent = text
    this.root.append(tip)
    this.tip = tip
    // The line the pointer is on, for a link that wraps.
    const rects = [...link.getClientRects()]
    const rect =
      rects.find(
        ({ left, right, top, bottom }) =>
          this.point.x >= left &&
          this.point.x <= right &&
          this.point.y >= top &&
          this.point.y <= bottom,
      ) ?? rects[0]
    if (!rect) return
    const view = this.view
    const width = tip.offsetWidth
    const height = tip.offsetHeight
    const below = rect.bottom + gap
    const top =
      view && below + height > view.innerHeight && rect.top - gap - height >= 0
        ? rect.top - gap - height
        : below
    const left = view
      ? Math.max(4, Math.min(this.point.x - 12, view.innerWidth - width - 4))
      : this.point.x
    tip.style.top = `${top}px`
    tip.style.left = `${left}px`
  }
}
