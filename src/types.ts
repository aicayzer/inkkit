export type DocumentFormat = 'md' | 'txt'
export interface DocumentContext {
  documentId: string
  generation: number
  operationId: string
}
export interface DocumentInput {
  documentId: string
  generation: number
  format: DocumentFormat
  text: string
}
/** Which document an output describes: the load, named by its generation, and the revision of
 *  its content within that load. */
export interface DocumentVersion {
  documentId: string
  generation: number
  revision: number
}
export interface DocumentSnapshot extends DocumentInput, DocumentVersion {
  dirty: boolean
}
/** The closed list of failure codes; `docs/api.md` describes each one. */
export const editorErrorCodes = [
  'not-ready',
  'destroyed',
  'stale-document',
  'composition',
  'operation-pending',
  'read-only',
  'invalid-argument',
  'invalid-range',
  'preservation',
  'image-unavailable',
  'diagram-unavailable',
  'file-unavailable',
  'clipboard-unavailable',
  'internal',
] as const
export type EditorErrorCode = (typeof editorErrorCodes)[number]
/** Every failure InkKit reports. Hosts branch on `code`; `message` is for logs. When the failure
 *  started elsewhere, such as in an adapter, the host clipboard or the renderer, `cause` holds the
 *  original error. */
export class InkKitError extends Error {
  readonly code: EditorErrorCode
  constructor(
    code: EditorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'InkKitError'
    this.code = code
  }
}
export interface CapturedImage {
  bytes: Uint8Array
  mimeType: string
  filename?: string
  source?: string
}
export interface PortableImage {
  bytes: Uint8Array
  mimeType: string
  filename?: string
}
export interface ImageAdapter {
  presentation(reference: string): { url: string } | undefined
  importImage(
    input: CapturedImage,
    context: DocumentContext,
  ): Promise<{ reference: string }>
  exportImage(
    reference: string,
    context: DocumentContext,
  ): Promise<PortableImage>
}
export interface WikiLinkReference {
  target: string
  fragment?: string
  label: string
}
export interface WikiLinkAdapter {
  resolve?(
    reference: WikiLinkReference,
    context: DocumentContext,
  ): { missing?: boolean } | undefined
  open(reference: WikiLinkReference, context: DocumentContext): void
}
export interface FileReference {
  reference: string
  kind: 'path' | 'wiki'
  target: string
  fragment?: string
  label?: string
  width?: number
}
export interface FileContext extends DocumentContext {
  signal: AbortSignal
}
export type FilePresentation =
  | {
      kind: 'image' | 'audio' | 'video' | 'pdf'
      url: string
      label?: string
      mimeType?: string
    }
  | { kind: 'file' | 'missing'; label?: string }
  | { kind: 'error'; label?: string; message: string }
export interface FileAdapter {
  resolve(
    reference: FileReference,
    context: FileContext,
  ): Promise<FilePresentation>
  exportImage?(
    reference: FileReference,
    context: FileContext,
  ): Promise<PortableImage>
  open?(reference: FileReference, context: DocumentContext): void
  contextMenu?(
    reference: FileReference,
    point: ClientPoint,
    context: DocumentContext,
  ): void
}
export interface ClientPoint {
  clientX: number
  clientY: number
}
export interface ClipboardInput {
  text: string
  markdown?: string
  html?: string
  images?: CapturedImage[]
}
export interface ClipboardImage {
  reference: string
  alt: string
  image?: PortableImage
  error?: string
}
/** What `clipboardSnapshot` copies: the whole document or the current selection. */
export type ClipboardScope = 'document' | 'selection'
/** Clipboard content, with the document version it was copied from. */
export interface ClipboardOutput extends DocumentVersion {
  text: string
  html: string
  markdown: string
  images: ClipboardImage[]
  diagrams: ClipboardDiagram[]
}
export interface ClipboardDiagram {
  source: string
  image?: PortableImage
  error?: string
}
export interface PrintableWarning {
  code: 'diagram-unavailable' | 'attachment-fallback' | 'attachment-unavailable'
  message: string
}
export interface PrintableDocument extends DocumentVersion {
  format: DocumentFormat
  html: string
  styles: string
  assets: readonly PortableImage[]
  warnings: readonly PrintableWarning[]
}

export interface TextRange {
  snapshotId: string
  from: number
  to: number
}
export interface ReadableTextSnapshot extends DocumentVersion {
  snapshotId: string
  format: DocumentFormat
  mode: 'source' | 'formatted'
  text: string
  selection: TextRange
}
export interface TextRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}
export interface ViewportInsets {
  top: number
  right: number
  bottom: number
  left: number
}
export interface ViewportOptions {
  scrollContainer?: HTMLElement
  insets?: Partial<ViewportInsets>
}
export interface ViewportSnapshot {
  rect: TextRect
  insets: ViewportInsets
  scrollTop: number
  scrollLeft: number
}
