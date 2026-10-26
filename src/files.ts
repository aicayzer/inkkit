import { coded } from './errors'
import type {
  InkKitError,
  DocumentContext,
  FileAdapter,
  FileContext,
  FilePresentation,
  FileReference,
} from './types'
import type { EditorLabels } from './types'

export interface FileViewRuntime {
  adapter: FileAdapter
  capture(): { context: DocumentContext; isCurrent(): boolean }
  active(): boolean
  labels: Readonly<EditorLabels>
  error?(error: InkKitError): void
}

function abort(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException('File resolution cancelled', 'AbortError')
}

export function withFileSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', cancelled)
    const cancelled = () => {
      cleanup()
      reject(new DOMException('File operation cancelled', 'AbortError'))
    }
    if (signal.aborted) cancelled()
    else signal.addEventListener('abort', cancelled, { once: true })
    operation.then(
      (result) => {
        cleanup()
        if (signal.aborted) cancelled()
        else resolve(result)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export async function resolveFile(
  adapter: FileAdapter,
  reference: FileReference,
  context: FileContext,
): Promise<FilePresentation> {
  abort(context.signal)
  const presentation = await withFileSignal(
    adapter.resolve(Object.freeze({ ...reference }), context),
    context.signal,
  )
  abort(context.signal)
  if (
    !presentation ||
    typeof presentation !== 'object' ||
    !['image', 'audio', 'video', 'pdf', 'file', 'missing', 'error'].includes(
      presentation.kind,
    )
  )
    throw new TypeError('File adapter returned an unsupported presentation')
  if (
    presentation.label !== undefined &&
    typeof presentation.label !== 'string'
  )
    throw new TypeError('File presentation label must be text')
  if (presentation.kind === 'error' && typeof presentation.message !== 'string')
    throw new TypeError('File presentation error must include a message')
  if ('url' in presentation) {
    if (typeof presentation.url !== 'string' || !presentation.url.trim())
      throw new TypeError('File presentation needs a resource URL')
    const url = new URL(presentation.url, document.baseURI)
    if (['javascript:', 'vbscript:'].includes(url.protocol))
      throw new TypeError('Executable file presentation URLs are not supported')
    const prefix =
      presentation.kind === 'pdf' ? 'application/pdf' : `${presentation.kind}/`
    const mime = presentation.mimeType?.toLowerCase().split(';')[0]?.trim()
    if (
      mime &&
      (presentation.kind === 'pdf' ? mime !== prefix : !mime.startsWith(prefix))
    )
      throw new TypeError('File presentation MIME type does not match its kind')
    const dataMime = url.pathname.toLowerCase().split(/[;,]/)[0] ?? ''
    if (
      url.protocol === 'data:' &&
      (presentation.kind === 'pdf'
        ? dataMime !== prefix
        : !dataMime.startsWith(prefix))
    )
      throw new TypeError('File presentation data URL does not match its kind')
  } else if (['image', 'audio', 'video', 'pdf'].includes(presentation.kind)) {
    throw new TypeError('File presentation needs a resource URL')
  }
  return Object.freeze({ ...presentation })
}

export type FileResolutionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'resolved'; presentation: FilePresentation }
  | { status: 'failed'; error: InkKitError }

/** The event every reference view hears when the editor's media policy or references change. */
export const mediaPolicyEvent = 'inkkit-media-policy'

/** What `refreshReferences` asks of the views: the targets to resolve again, or every one. */
export interface ReferenceRefresh {
  targets?: ReadonlySet<string>
}

export function requestRefresh(dom: Element, refresh: ReferenceRefresh): void {
  dom.dispatchEvent(new CustomEvent(mediaPolicyEvent, { detail: { refresh } }))
}

/** The refresh a policy event carries. A plain event, such as a host's, carries none. */
export function refreshOf(event: Event): ReferenceRefresh | undefined {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null
  return detail && typeof detail === 'object' && 'refresh' in detail
    ? (detail.refresh as ReferenceRefresh)
    : undefined
}

export function refreshes(refresh: ReferenceRefresh, target: string): boolean {
  return !refresh.targets || refresh.targets.has(target)
}

function samePresentation(a: FilePresentation, b: FilePresentation): boolean {
  const left = a as unknown as Record<string, unknown>
  const right = b as unknown as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  )
}

export class FileResolution {
  state: FileResolutionState = { status: 'idle' }
  private reference?: FileReference
  private key = ''
  private request?: { controller: AbortController; isCurrent(): boolean }
  private dead = false

  constructor(
    private readonly runtime: FileViewRuntime,
    private readonly changed: () => void,
  ) {}

  update(reference: FileReference): void {
    const key = JSON.stringify([
      reference.raw,
      reference.reference,
      reference.kind,
      reference.fragment,
    ])
    this.reference = Object.freeze({ ...reference })
    if (this.key === key && this.request?.isCurrent()) return
    this.key = key
    this.retry()
  }

  /** Resolves again from a blank loading card. */
  retry(): void {
    this.cancel()
    this.start(true)
  }

  /**
   * Resolves again behind the current card, which stays until the answer differs, so a card that
   * the host's change doesn't affect neither blanks nor moves.
   */
  refresh(): void {
    if (this.dead || !this.runtime.active()) return
    if (this.state.status === 'idle') this.retry()
    else this.start(false)
  }

  private start(blank: boolean): void {
    this.request?.controller.abort()
    this.request = undefined
    if (this.dead || !this.reference || !this.runtime.active()) return
    const captured = this.runtime.capture()
    const request = {
      controller: new AbortController(),
      isCurrent: captured.isCurrent,
    }
    this.request = request
    if (blank) {
      this.state = { status: 'loading' }
      this.changed()
    }
    void resolveFile(this.runtime.adapter, this.reference, {
      ...captured.context,
      signal: request.controller.signal,
    }).then(
      (presentation) => {
        if (!this.current(request)) return
        const before = this.state
        this.state = { status: 'resolved', presentation }
        if (
          before.status !== 'resolved' ||
          !samePresentation(before.presentation, presentation)
        )
          this.changed()
      },
      (failure: unknown) => {
        if (!this.current(request)) return
        const error = coded(failure, 'file-unavailable')
        this.state = { status: 'failed', error }
        this.changed()
        this.runtime.error?.(error)
      },
    )
  }

  private current(request: NonNullable<FileResolution['request']>): boolean {
    return (
      !this.dead &&
      this.request === request &&
      !request.controller.signal.aborted &&
      this.runtime.active() &&
      request.isCurrent()
    )
  }

  cancel(): void {
    this.request?.controller.abort()
    this.request = undefined
    this.state = { status: 'idle' }
  }

  destroy(): void {
    this.dead = true
    this.cancel()
  }
}
