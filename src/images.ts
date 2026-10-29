import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { closeHistory } from '@milkdown/kit/prose/history'
import { $view } from '@milkdown/kit/utils'

import { NodeSelection } from '@milkdown/kit/prose/state'

import {
  InkKitError,
  type FileAdapter,
  type FileReference,
  type ImageAdapter,
} from './types'
import { coded } from './errors'
import {
  FileResolution,
  FilePresentationCache,
  mediaPolicyEvent,
  refreshOf,
  refreshes,
  type AdapterHost,
  type FileViewRuntime,
} from './files'
import { fileReference } from './linked-syntax'
import { imageBlockSchema } from './image-blocks'
import { defaultLabels } from './labels'

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

class ImageView implements NodeView {
  dom: HTMLElement
  /** The card or picture, which a standalone image's block row holds. */
  private element: HTMLElement
  private image?: HTMLImageElement
  private handle?: HTMLElement
  private destroyed = false
  private restoreResizeFocus = false
  private media?: HTMLMediaElement
  private pdf?: HTMLIFrameElement
  private width: number | null = null
  private stopResize?: () => void
  private resolution?: FileResolution
  private previewFailed = false
  private suspended = false
  /** True while the card is itself the Open control (`activation: 'card'`). */
  private cardKeys = false
  /** Present when the host sets `files`, which then shows every image. */
  private readonly runtime?: FileViewRuntime

  constructor(
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly adapter: ImageAdapter | undefined,
    private readonly host: AdapterHost | undefined,
    files: FileAdapter | undefined,
    cache: FilePresentationCache,
    private readonly canMutate: () => boolean = () => true,
  ) {
    const runtime = files && host && { ...host, adapter: files }
    this.runtime = runtime
    this.element = document.createElement('span')
    this.element.className = 'inkkit-image'
    this.element.addEventListener('contextmenu', this.contextMenu)
    if (node.isBlock) {
      this.dom = document.createElement('div')
      this.dom.className = 'inkkit-image-block'
      this.dom.append(this.element)
    } else this.dom = this.element
    this.view.dom.addEventListener('inkkit-cancel-resize', this.cancelResize)
    this.view.dom.addEventListener(mediaPolicyEvent, this.mediaPolicy)
    if (runtime) {
      this.resolution = new FileResolution(
        { ...runtime, active: () => this.active() },
        () => {
          this.previewFailed = false
          this.render()
        },
        cache,
      )
      this.resolution.update(this.reference())
    }
    this.render()
  }

  private reference(): FileReference {
    return fileReference(this.node)
  }

  private active(): boolean {
    return (
      !!this.runtime?.active() &&
      !this.dom.closest('[data-inkkit-folded="true"], [hidden]')
    )
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    if (node.sameMarkup(this.node)) {
      this.node = node
      return true
    }
    this.node = node
    this.previewFailed = false
    this.resolution?.update(this.reference())
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    return (
      event.target instanceof Element &&
      (!!event.target.closest(
        '.inkkit-image-handle, .inkkit-file-control, audio, video, iframe',
      ) ||
        // Return and Space on a focused card belong to the card, not the editor.
        (event.type === 'keydown' &&
          event.target === this.element &&
          this.cardKeys))
    )
  }

  ignoreMutation(): boolean {
    return true
  }

  private mediaPolicy = (event: Event): void => {
    if (!this.runtime) return
    const refresh = refreshOf(event)
    if (refresh) {
      if (!refreshes(refresh, this.reference().target)) return
      if (!this.active()) {
        this.resolution?.invalidate()
        return
      }
      // A card whose preview failed has nothing to keep, and a new answer may load.
      if (this.previewFailed) this.resolution?.retry()
      else this.resolution?.refresh()
      return
    }
    if (!this.active()) {
      if (this.suspended) return
      this.suspended = true
      this.stopResize?.()
      this.stopResize = undefined
      this.resolution?.suspend()
      if (this.media || this.pdf) this.render()
    } else {
      const suspended = this.suspended
      this.suspended = false
      this.resolution?.update(this.reference())
      const state = this.resolution?.state
      if (
        suspended &&
        state?.status === 'resolved' &&
        ['audio', 'video', 'pdf'].includes(state.presentation.kind)
      )
        this.render()
    }
  }

  private cancelResize = (): void => {
    if (!this.stopResize) return
    this.stopResize?.()
    this.stopResize = undefined
    this.render()
  }

  private releaseMedia(): void {
    const media = this.media
    this.media = undefined
    if (media) {
      media.pause()
      media.removeAttribute('src')
      media.load()
    }
    this.pdf?.removeAttribute('src')
    this.pdf = undefined
  }

  destroy(): void {
    this.destroyed = true
    this.view.dom.removeEventListener('inkkit-cancel-resize', this.cancelResize)
    this.view.dom.removeEventListener(mediaPolicyEvent, this.mediaPolicy)
    this.stopResize?.()
    this.stopResize = undefined
    this.resolution?.destroy()
    this.releaseMedia()
  }

  private button(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'inkkit-file-control'
    button.textContent = label
    button.addEventListener('click', (event) => {
      event.preventDefault()
      action()
    })
    return button
  }

  private activate = (): void => {
    if (!this.runtime || !this.active()) return
    const captured = this.runtime.capture()
    try {
      if (captured.isCurrent())
        this.runtime.adapter.open?.(this.reference(), captured.context)
    } catch (error) {
      this.report(error)
    }
  }

  private report(error: unknown): void {
    this.runtime?.error?.(coded(error, 'file-unavailable'))
  }

  /** Hands the request to the host's hook, which replaces the web view's own menu. A file card
   *  uses `FileAdapter.contextMenu`; any other image selects itself and uses
   *  `ImageAdapter.contextMenu`. */
  private contextMenu = (event: MouseEvent): void => {
    const { host, runtime, adapter } = this
    if (
      !host?.active() ||
      !(runtime ? runtime.adapter.contextMenu : adapter?.contextMenu)
    )
      return
    const captured = host.capture()
    if (!captured.isCurrent()) return
    event.preventDefault()
    const point = { clientX: event.clientX, clientY: event.clientY }
    try {
      if (runtime)
        runtime.adapter.contextMenu?.(this.reference(), point, captured.context)
      else {
        this.select()
        adapter?.contextMenu?.(
          String(this.node.attrs.src ?? ''),
          point,
          captured.context,
        )
      }
    } catch (error) {
      if (runtime) this.report(error)
      else host.error?.(coded(error, 'image-unavailable'))
    }
  }

  private select(): void {
    const pos = this.getPos()
    if (pos == null || this.view.composing) return
    const { state } = this.view
    const selection = NodeSelection.create(state.doc, pos)
    if (!state.selection.eq(selection))
      this.view.dispatch(state.tr.setSelection(selection))
  }

  private cardKey = (event: KeyboardEvent): void => {
    if (event.target !== this.element || event.isComposing) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.activate()
  }

  private cardClick = (): void => this.activate()

  /** Makes the whole card the one control that opens the file, in place of the arrow button. */
  private activateCard(label: string): void {
    const { element } = this
    element.setAttribute('role', 'button')
    element.setAttribute(
      'aria-label',
      `${this.runtime!.labels.fileOpen} ${label}`,
    )
    element.tabIndex = 0
    element.dataset.inkkitFileActivation = 'card'
    this.cardKeys = true
    element.addEventListener('click', this.cardClick)
    element.addEventListener('keydown', this.cardKey)
  }

  private card(
    label: string,
    status?: string,
    retry = false,
    activation = false,
  ): void {
    if (this.resolution?.state.status !== 'loading' && !this.handle)
      this.restoreResizeFocus = false
    const footer = document.createElement('span')
    footer.className = 'inkkit-file-footer'
    const name = document.createElement('span')
    name.className = 'inkkit-file-name'
    const text = document.createElement('span')
    text.className = 'inkkit-file-label'
    text.textContent = label
    text.title = label
    name.append(text)
    if (activation && this.runtime?.adapter.open) this.activateCard(label)
    else if (this.runtime?.adapter.open) {
      const open = this.button('', this.activate)
      open.classList.add('inkkit-file-open')
      open.setAttribute(
        'aria-label',
        `${this.runtime.labels.fileOpen} ${label}`,
      )
      open.title = this.runtime.labels.fileOpen
      open.append(openArrow())
      name.append(open)
    }
    footer.append(name)
    if (status) {
      const description = document.createElement('span')
      description.className = 'inkkit-file-status'
      description.setAttribute('role', 'status')
      description.textContent = status
      footer.append(description)
    }
    if (retry && this.runtime)
      footer.append(
        this.button(this.runtime.labels.fileRetry, () =>
          this.resolution?.retry(),
        ),
      )
    this.element.append(footer)
  }

  private failPreview(): void {
    this.previewFailed = true
    this.runtime?.error?.(
      new InkKitError('file-unavailable', 'The file could not be previewed'),
    )
    this.render()
  }

  private render(): void {
    if (this.handle && document.activeElement === this.handle)
      this.restoreResizeFocus = true
    this.stopResize?.()
    this.stopResize = undefined
    this.releaseMedia()
    const reference = this.reference()
    const { alt, width } = this.node.attrs.inkkitFileRaw
      ? {
          alt: reference.label ?? reference.reference,
          width: reference.width ?? null,
        }
      : splitAlt(String(this.node.attrs.alt ?? ''))
    this.width = width
    this.element.textContent = ''
    this.element.removeEventListener('click', this.cardClick)
    this.element.removeEventListener('keydown', this.cardKey)
    this.element.removeAttribute('tabindex')
    this.element.removeAttribute('data-inkkit-file-activation')
    this.element.removeAttribute('data-inkkit-file-layout')
    this.cardKeys = false
    this.image = undefined
    this.handle = undefined
    if (this.runtime) {
      this.element.classList.add('inkkit-file')
      const state = this.resolution!.state
      const label =
        state.status === 'resolved'
          ? state.presentation.label || alt || reference.reference
          : alt || reference.reference
      this.element.setAttribute('role', 'group')
      this.element.setAttribute('aria-label', label)
      this.element.dataset.inkkitFileState = this.previewFailed
        ? 'error'
        : state.status
      this.element.dataset.inkkitFileKind =
        state.status === 'resolved' ? state.presentation.kind : 'file'
      if (this.previewFailed) {
        this.card(label, this.runtime.labels.filePreviewUnavailable, true)
        return
      }
      if (state.status === 'loading' || state.status === 'idle') {
        this.card(label, this.runtime.labels.fileLoading, true)
        return
      }
      if (state.status === 'failed') {
        this.card(label, this.runtime.labels.fileError, true)
        return
      }
      const presentation = state.presentation
      if (
        !this.active() &&
        ['audio', 'video', 'pdf'].includes(presentation.kind)
      ) {
        this.card(label)
        return
      }
      if (presentation.kind === 'missing') {
        this.card(label, this.runtime.labels.fileMissing, true)
      } else if (presentation.kind === 'error') {
        this.card(
          label,
          presentation.message || this.runtime.labels.fileError,
          true,
        )
      } else if (presentation.kind === 'image') {
        this.renderImage(presentation.url, label, width)
        this.card(label)
      } else if (
        presentation.kind === 'audio' ||
        presentation.kind === 'video'
      ) {
        const media = document.createElement(presentation.kind)
        media.controls = true
        media.preload = 'metadata'
        if (width != null) media.style.width = `${width}px`
        media.setAttribute('aria-label', label)
        media.addEventListener('error', () => {
          if (this.media === media) this.failPreview()
        })
        media.src = presentation.url
        this.media = media
        this.element.append(media)
        this.card(label)
      } else if (presentation.kind === 'pdf') {
        const pdf = document.createElement('iframe')
        pdf.title = label
        pdf.setAttribute('sandbox', '')
        // WebKit's sandboxed PDF viewer cannot return keyboard focus to its parent.
        // The Open control provides the keyboard path to the document.
        pdf.tabIndex = -1
        pdf.referrerPolicy = 'no-referrer'
        if (width != null) pdf.style.width = `${width}px`
        pdf.addEventListener('error', () => {
          if (this.pdf === pdf) this.failPreview()
        })
        pdf.src = presentation.url
        this.pdf = pdf
        this.element.append(pdf)
        this.card(label, this.runtime.labels.filePDFPreview)
      } else if (presentation.kind === 'file') {
        if (presentation.layout === 'fill')
          this.element.dataset.inkkitFileLayout = 'fill'
        this.card(label, undefined, false, presentation.activation === 'card')
      } else this.card(label)
      this.restoreHandleFocus()
      return
    }
    const presentation = this.adapter?.presentation(
      String(this.node.attrs.src ?? ''),
    )
    if (!presentation) {
      this.element.classList.add('inkkit-image-absent')
      this.element.textContent = alt || String(this.node.attrs.src ?? '')
      return
    }
    this.element.classList.remove('inkkit-image-absent')
    this.renderImage(presentation.url, alt, width)
    this.restoreHandleFocus()
  }

  private restoreHandleFocus(): void {
    if (!this.restoreResizeFocus || !this.handle) return
    this.restoreResizeFocus = false
    // A file adapter may resolve the changed width asynchronously. Do not steal focus
    // if the person has moved elsewhere while the loading card was visible.
    if (this.canResize() && document.activeElement === document.body)
      this.handle.focus({ preventScroll: true })
  }

  private renderImage(url: string, alt: string, width: number | null): void {
    const image = document.createElement('img')
    image.alt = alt
    if (this.node.attrs.title) image.title = String(this.node.attrs.title)
    if (width != null) image.style.width = `${width}px`
    if (this.runtime)
      image.addEventListener('error', () => {
        if (this.image === image) this.failPreview()
      })
    image.src = url
    this.image = image
    const preview = document.createElement('span')
    preview.className = 'inkkit-image-preview'
    preview.append(image)
    // The grip sits on the whole card, so it centres on the picture and its name together.
    const handle = document.createElement('span')
    handle.className = 'inkkit-image-handle'
    handle.tabIndex = 0
    handle.setAttribute('role', 'slider')
    handle.setAttribute('aria-orientation', 'horizontal')
    handle.setAttribute(
      'aria-label',
      `${this.host?.labels.imageResize ?? defaultLabels.imageResize} ${alt}`.trim(),
    )
    handle.addEventListener('focus', this.updateHandle)
    handle.addEventListener('keydown', this.resizeKey)
    handle.addEventListener('pointerdown', this.startResize)
    this.handle = handle
    this.element.append(preview, handle)
    this.updateHandle()
    image.addEventListener('load', this.updateHandle)
  }

  private updateHandle = (): void => {
    if (!this.handle || !this.image) return
    const width = Math.round(
      this.image.getBoundingClientRect().width || this.width || minimumWidth,
    )
    this.handle.setAttribute(
      'aria-valuemin',
      String(Math.min(minimumWidth, width)),
    )
    this.handle.setAttribute(
      'aria-valuemax',
      String(Math.max(minimumWidth, width, this.view.dom.clientWidth)),
    )
    this.handle.setAttribute('aria-valuenow', String(width))
    this.handle.setAttribute('aria-valuetext', `${width}px`)
  }

  private resizeKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || !this.canResize())
      return
    const image = this.image
    if (
      !image ||
      event.currentTarget !== this.handle ||
      !this.handle.isConnected
    )
      return
    const limit = Math.max(minimumWidth, this.view.dom.clientWidth)
    const current = Math.round(
      image.getBoundingClientRect().width || this.width || minimumWidth,
    )
    const step = event.shiftKey ? 1 : 10
    let width: number
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        width = current - step
        break
      case 'ArrowRight':
      case 'ArrowUp':
        width = current + step
        break
      case 'Home':
        width = minimumWidth
        break
      case 'End':
        width = limit
        break
      default:
        return
    }
    event.preventDefault()
    this.width = Math.min(limit, Math.max(minimumWidth, width))
    this.commit()
    this.handle?.focus({ preventScroll: true })
    this.updateHandle()
  }

  private startResize = (event: PointerEvent): void => {
    event.preventDefault()
    const image = this.image
    if (!image || !this.canResize()) return
    const handle = event.currentTarget as HTMLElement
    const startX = event.clientX
    const startWidth = image.getBoundingClientRect().width
    const limit = this.view.dom.clientWidth
    handle.setPointerCapture?.(event.pointerId)
    const move = (moved: PointerEvent) => {
      if (!this.canResize()) {
        this.cancelResize()
        return
      }
      this.width = Math.round(
        Math.min(
          limit,
          Math.max(minimumWidth, startWidth + moved.clientX - startX),
        ),
      )
      image.style.width = `${this.width}px`
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', done)
      handle.removeEventListener('pointercancel', cancel)
    }
    const done = () => {
      cleanup()
      this.stopResize = undefined
      this.commit()
    }
    const cancel = () => {
      cleanup()
      this.stopResize = undefined
      this.render()
    }
    this.stopResize = cleanup
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', done)
    handle.addEventListener('pointercancel', cancel)
  }

  private commit(): void {
    if (!this.canResize()) {
      this.render()
      return
    }
    const pos = this.getPos()
    if (pos == null) return
    const alt = this.node.attrs.inkkitFileRaw
      ? (this.reference().label ?? this.reference().reference)
      : splitAlt(String(this.node.attrs.alt ?? '')).alt
    const next = joinAlt(alt, this.width)
    if (next === this.node.attrs.alt) return
    const { state } = this.view
    this.view.dispatch(
      closeHistory(
        state.tr.setNodeMarkup(pos, undefined, {
          ...this.node.attrs,
          alt: next,
        }),
      ),
    )
    this.view.dispatch(closeHistory(this.view.state.tr))
  }

  private canResize(): boolean {
    return (
      !this.destroyed &&
      this.view.editable &&
      !this.view.composing &&
      (!this.host || this.host.active()) &&
      this.canMutate()
    )
  }
}

const svg = 'http://www.w3.org/2000/svg'

function openArrow(): SVGElement {
  const icon = document.createElementNS(svg, 'svg')
  icon.setAttribute('viewBox', '0 0 12 12')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  const path = document.createElementNS(svg, 'path')
  path.setAttribute('d', 'M4 2.5h5.5V8M9.5 2.5 2.5 9.5')
  icon.append(path)
  return icon
}

export function imageView(
  adapter?: ImageAdapter,
  host?: AdapterHost,
  files?: FileAdapter,
  canMutate: () => boolean = () => true,
) {
  const cache = new FilePresentationCache()
  const view = (schema: { node: unknown }) =>
    $view(
      schema.node as typeof imageSchema.node,
      () => (node, view, getPos) =>
        new ImageView(
          node,
          view,
          getPos,
          adapter,
          host,
          files,
          cache,
          canMutate,
        ),
    )
  return [view(imageSchema), view(imageBlockSchema)]
}
