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
  | 'operation-pending'
  | 'destroyed'
  | 'preservation'
  | 'image-unavailable'
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
export interface ClipboardInput {
  text: string
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
}
