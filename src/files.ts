import type {
  DocumentContext,
  FileAdapter,
  FileContext,
  FilePresentation,
  FileReference,
} from './types'
import type { EditorLabels } from './labels'

export interface FileViewRuntime {
  adapter: FileAdapter
  capture(): { context: DocumentContext; isCurrent(): boolean }
  active(): boolean
  labels: Readonly<EditorLabels>
  error?(error: Error): void
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
  | { status: 'failed'; error: Error }

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
      reference.reference,
      reference.kind,
      reference.fragment,
    ])
    this.reference = Object.freeze({ ...reference })
    if (this.key === key && this.request?.isCurrent()) return
    this.key = key
    this.retry()
  }

  retry(): void {
    this.cancel()
    if (this.dead || !this.reference || !this.runtime.active()) return
    const captured = this.runtime.capture()
    const request = {
      controller: new AbortController(),
      isCurrent: captured.isCurrent,
    }
    this.request = request
    this.state = { status: 'loading' }
    this.changed()
    void resolveFile(this.runtime.adapter, this.reference, {
      ...captured.context,
      signal: request.controller.signal,
    }).then(
      (presentation) => {
        if (!this.current(request)) return
        this.state = { status: 'resolved', presentation }
        this.changed()
      },
      (failure: unknown) => {
        if (!this.current(request)) return
        const error =
          failure instanceof Error ? failure : new Error(String(failure))
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
