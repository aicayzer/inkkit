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
export interface DocumentSnapshot extends DocumentInput {
  revision: number
  dirty: boolean
}
export type EditorErrorCode =
  | 'not-ready'
  | 'stale-document'
  | 'composition'
  | 'read-only'
  | 'operation-pending'
  | 'destroyed'
  | 'preservation'
  | 'image-unavailable'
  | 'diagram-unavailable'
  | 'invalid-range'
export class InkKitError extends Error {
  constructor(
    public readonly code: EditorErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'InkKitError'
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
    point: { clientX: number; clientY: number },
    context: DocumentContext,
  ): void
}
export interface ClipboardInput {
  text: string
  markdown?: string
  html?: string
  images?: CapturedImage[]
  plainText?: boolean
}
export interface ClipboardImage {
  reference: string
  alt: string
  image?: PortableImage
  error?: string
}
export interface ClipboardOutput {
  text: string
  html: string
  markdown: string
  images: ClipboardImage[]
  diagrams?: ClipboardDiagram[]
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
export interface PrintableDocument {
  documentId: string
  generation: number
  revision: number
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
export interface ReadableTextSnapshot {
  snapshotId: string
  documentId: string
  generation: number
  revision: number
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
