import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'

import type { ImageAdapter } from './types'

/** A width rides in the alt text, as `![a picture|400](images/….png)`. Other Markdown readers
 *  show the picture and keep the number without requiring a private extension. */
export function splitAlt(alt: string): { alt: string; width: number | null } {
  const match = /^([\s\S]*)\|(\d{1,5})$/.exec(alt)
  if (!match) return { alt, width: null }
  return { alt: match[1] ?? '', width: Number(match[2]) }
}

export function joinAlt(alt: string, width: number | null): string {
  return width == null ? alt : `${alt}|${width}`
}

const minimumWidth = 48

/** Draws the image and the handle that sizes it. The width is kept in the alt text, so the schema is the
 *  one commonmark gives us; a picture is never wider than its editor, whatever number the alt text holds. */
class ImageView implements NodeView {
  dom: HTMLElement
  private image?: HTMLImageElement
  private width: number | null = null
  private stopResize?: () => void

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly adapter: ImageAdapter | undefined,
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'image'
    this.render()
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  /// The handle's own events are the view's business, not the document's.
  stopEvent(event: Event): boolean {
    return (
      event.target instanceof HTMLElement &&
      event.target.classList.contains('image-handle')
    )
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.stopResize?.()
    this.stopResize = undefined
  }

  private render(): void {
    this.stopResize?.()
    this.stopResize = undefined
    const src = String(this.node.attrs.src ?? '')
    const { alt, width } = splitAlt(String(this.node.attrs.alt ?? ''))
    this.width = width
    this.dom.textContent = ''
    this.image = undefined
    // Only the host adapter decides which authored references can be presented.
    const presentation = this.adapter?.presentation(src)
    if (!presentation) {
      this.dom.classList.add('image-absent')
      this.dom.textContent = alt || src
      return
    }
    this.dom.classList.remove('image-absent')
    const image = document.createElement('img')
    image.src = presentation.url
    image.alt = alt
    if (this.node.attrs.title) image.title = String(this.node.attrs.title)
    if (width != null) image.style.width = `${width}px`
    this.image = image
    const handle = document.createElement('span')
    handle.className = 'image-handle'
    handle.addEventListener('pointerdown', this.startResize)
    this.dom.append(image, handle)
  }

  private startResize = (event: PointerEvent): void => {
    const image = this.image
    if (!image || !this.view.editable) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    const startX = event.clientX
    const startWidth = image.getBoundingClientRect().width
    const limit = this.view.dom.clientWidth
    handle.setPointerCapture?.(event.pointerId)
    const move = (moved: PointerEvent) => {
      const next = Math.round(
        Math.min(
          limit,
          Math.max(minimumWidth, startWidth + (moved.clientX - startX)),
        ),
      )
      this.width = next
      image.style.width = `${next}px`
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', done)
      handle.removeEventListener('pointercancel', done)
    }
    const done = () => {
      cleanup()
      this.stopResize = undefined
      this.commit()
    }
    this.stopResize = cleanup
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', done)
    handle.addEventListener('pointercancel', done)
  }

  private commit(): void {
    if (!this.view.editable) return
    const pos = this.getPos()
    if (pos == null) return
    const { alt } = splitAlt(String(this.node.attrs.alt ?? ''))
    const next = joinAlt(alt, this.width)
    if (next === this.node.attrs.alt) return
    const { state } = this.view
    this.view.dispatch(
      state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, alt: next }),
    )
  }
}

export function imageView(adapter?: ImageAdapter) {
  return $view(
    imageSchema.node,
    () => (node, view, getPos) => new ImageView(node, view, getPos, adapter),
  )
}
