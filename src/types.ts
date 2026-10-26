/** `md` is Markdown; `txt` is literal text, shown and saved as typed. */
export type DocumentFormat = 'md' | 'txt'
/** What every adapter call receives, to tell which document, load and call it belongs to. The
 *  operation ID is opaque and differs for each call from one editor. */
export interface DocumentContext {
  documentId: string
  generation: number
  operationId: string
}
/** A document to load. `generation` must be greater than the loaded one. */
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
/** The complete current text. `dirty` is true when it differs from the text of the last load. */
export interface DocumentSnapshot extends DocumentInput, DocumentVersion {
  dirty: boolean
}
/** The closed list of failure codes. The API reference describes each one. */
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
/** Image bytes that the editor captured from a paste or drop, for the adapter to store. */
export interface CapturedImage {
  bytes: Uint8Array
  mimeType: string
  filename?: string
  /** The `src` of the HTML image the bytes belong to, when there is one. */
  source?: string
}
/** Image bytes that leave the editor in clipboard and print output. */
export interface PortableImage {
  bytes: Uint8Array
  mimeType: string
  filename?: string
}
/** The document and cancellation signal for one image import. */
export interface ImageImportContext extends DocumentContext {
  signal: AbortSignal
}
/** Stores, shows and exports the images a host owns. References stay opaque to the editor. */
export interface ImageAdapter {
  /** The display URL for `reference`, or `undefined` when the image is unavailable. */
  presentation(reference: string): { url: string } | undefined
  /** Stores the bytes and returns the reference to write into the Markdown. */
  importImage(
    input: CapturedImage,
    context: ImageImportContext,
  ): Promise<{ reference: string }>
  /** The stored bytes and type of `reference`, for portable clipboard and print output. */
  exportImage(
    reference: string,
    context: DocumentContext,
  ): Promise<PortableImage>
  /** Called for a context-menu request on an image. Inkkit selects the image first. */
  contextMenu?(
    reference: string,
    point: ClientPoint,
    context: DocumentContext,
  ): void
}
/** A wiki link as authored. */
export interface WikiLinkReference {
  /** The note name, with escapes removed. Empty for a link such as `[[#Heading]]`. */
  target: string
  fragment?: string
  /** The text shown: the alias, or the target and fragment. */
  label: string
}
/** Resolves and opens wiki links. The host owns lookup, permissions and navigation. */
export interface WikiLinkAdapter {
  /** Matches note names for a typed `[[` query. Late answers are ignored. */
  suggest?(query: string, context: FileContext): Promise<readonly string[]>
  /** Whether the target is missing, for presentation only. */
  resolve?(
    reference: WikiLinkReference,
    context: DocumentContext,
  ): { missing?: boolean } | undefined
  /** Called by Mod-click, and by Enter or Space on the focused link. */
  open(reference: WikiLinkReference, context: DocumentContext): void
}
/** A file the document refers to, as authored. */
export interface FileReference {
  /** The whole reference, including any fragment. */
  reference: string
  /** `path` for `![alt](destination)`, `wiki` for `![[name]]`. */
  kind: 'path' | 'wiki'
  /** The reference without its fragment. Use it to find the file. */
  target: string
  /** Everything after the separating `#`, such as `t=10` or `page=3`. */
  fragment?: string
  label?: string
  /** The authored width in pixels. */
  width?: number
}
/** The context of a file call. Abandon the work when `signal` aborts. */
export interface FileContext extends DocumentContext {
  signal: AbortSignal
}
/** How the host shows a file. `url` must be private to the host and usable offline. */
export type FilePresentation =
  | {
      kind: 'image' | 'audio' | 'video' | 'pdf'
      url: string
      label?: string
      mimeType?: string
    }
  | { kind: 'file' | 'missing'; label?: string }
  | { kind: 'error'; label?: string; message: string }
/** Resolves, exports and opens files. The host owns storage, permissions and native actions. */
export interface FileAdapter {
  /** Decides what kind of file `reference` is and how to show it. InkKit never guesses from the
   *  extension. */
  resolve(
    reference: FileReference,
    context: FileContext,
  ): Promise<FilePresentation>
  /** Portable bytes of an image for copy and print. Named images need it. */
  exportImage?(
    reference: FileReference,
    context: FileContext,
  ): Promise<PortableImage>
  /** Adds an Open button to file cards. */
  open?(reference: FileReference, context: DocumentContext): void
  /** Called for a context-menu request on a file card. */
  contextMenu?(
    reference: FileReference,
    point: ClientPoint,
    context: DocumentContext,
  ): void
}
/** A position in CSS pixels in the web view's client area, as in DOM pointer events. */
export interface ClientPoint {
  clientX: number
  clientY: number
}
/** What the host read from the native clipboard. */
export interface ClipboardInput {
  text: string
  /** Explicit Markdown source. It takes precedence over `text` and `html`. */
  markdown?: string
  html?: string
  /** Bytes for the images that `html` refers to. */
  images?: CapturedImage[]
}
/** An image in clipboard output. */
export interface ClipboardImage {
  /** The authored reference. Empty for the picture of a diagram. */
  reference: string
  alt: string
  image?: PortableImage
  /** Why `image` is missing. */
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
/** A complete Mermaid diagram in clipboard output. */
export interface ClipboardDiagram {
  source: string
  /** A PNG of the rendered diagram. */
  image?: PortableImage
  /** Why `image` is missing. The source is still in the output. */
  error?: string
}
/** Output that degraded, such as a diagram printed as code or a file printed as a description. */
export interface PrintableWarning {
  code: 'diagram-unavailable' | 'attachment-fallback' | 'attachment-unavailable'
  message: string
}
/** The whole document, ready to print. The host owns the Print or PDF command. */
export interface PrintableDocument extends DocumentVersion {
  format: DocumentFormat
  /** A standalone HTML document with the print CSS embedded and `data:` images only. */
  html: string
  /** The print CSS on its own. */
  styles: string
  /** The images, in the order they appear in `html`. */
  assets: readonly PortableImage[]
  warnings: readonly PrintableWarning[]
}

/** A range of readable text. Offsets are zero-based UTF-16 code units in the `text` of the
 *  snapshot that `snapshotId` names, with `to` exclusive. */
export interface TextRange {
  snapshotId: string
  from: number
  to: number
}
/** The editor's readable text and selection. Ranges from it go stale when the document changes. */
export interface ReadableTextSnapshot extends DocumentVersion {
  snapshotId: string
  format: DocumentFormat
  mode: 'source' | 'formatted'
  text: string
  selection: TextRange
}
/** A rectangle in CSS pixels in the web view's client coordinate space. */
export interface TextRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}
/** How far host chrome covers each edge of the visible area, in non-negative CSS pixels. */
export interface ViewportInsets {
  top: number
  right: number
  bottom: number
  left: number
}
export interface ViewportOptions {
  /** The element that scrolls. It must be the root or an ancestor of it. Defaults to the root. */
  scrollContainer?: HTMLElement
  insets?: Partial<ViewportInsets>
}
export interface ViewportSnapshot {
  /** The visible area, less the insets. */
  rect: TextRect
  insets: ViewportInsets
  /** The combined scroll offsets of the container and, in source and TXT modes, the textarea. */
  scrollTop: number
  scrollLeft: number
}
/** Built-in editor text. Hosts can override individual labels at mount time. */
export interface EditorLabels {
  suggestions: string
  suggestionsEmpty: string
  suggestionsLoading: string
  slashHeading1: string
  slashHeading2: string
  slashHeading3: string
  slashBulletList: string
  slashOrderedList: string
  slashTaskList: string
  slashQuote: string
  slashCodeBlock: string
  slashTable: string
  slashCallout: string
  slashDivider: string
  slashDiagram: string
  slashNote: string
  slashTip: string
  slashImportant: string
  slashWarning: string
  slashCaution: string

  formattedEditor: string
  plainTextEditor: string
  sourceEditor: string
  placeholder: string
  copyCode: string
  codeLanguage: string
  codeLanguageSearch: string
  codeAuto: string
  codePlainText: string
  expandCallout: string
  collapseCallout: string
  diagramRendering: string
  /** Prefix shown before the renderer's diagnostic message. */
  diagramUnavailable: string
  /** Prefix followed by the authored footnote label. */
  footnote: string
  tableAddRow: string
  tableAddColumn: string
  tableDeleteRow: string
  tableDeleteColumn: string
  tableAlignLeft: string
  tableAlignCenter: string
  tableAlignRight: string
  tableMoveColumn: string
  tableMoveRow: string
  fileLoading: string
  fileMissing: string
  fileError: string
  fileRetry: string
  fileOpen: string
  filePreviewUnavailable: string
  filePDFPreview: string
  wikiMissing: string
  /** Name of an author comment, which stays out of the readable text. */
  comment: string
  /** Name of a block of Markdown InkKit keeps as authored and does not render. */
  preservedMarkdown: string
}
/** An outline entry. Pass it back to `navigateHeading`; it goes stale when the document changes. */
export interface Heading extends Readonly<DocumentVersion> {
  /** Opaque. It belongs to the loaded document and editing mode. */
  readonly id: string
  /** 1 to 6. */
  readonly level: number
  readonly text: string
}
/** A command for `table`. `insert` makes a table; the others work on the table at the selection. */
export type TableCommand =
  | 'insert'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'moveRowUp'
  | 'moveRowDown'
  | 'moveColumnLeft'
  | 'moveColumnRight'
  | 'sortRows'
  | 'exit'
/** Where `moveBlock` moves the blocks at the selection. */
export type BlockMoveDirection = 'up' | 'down'
/** Each option belongs to one command; any other combination is refused. */
export interface TableOptions {
  /** `insert`: 1 to 100, counting the header row. Defaults to 3. */
  rows?: number
  /** `insert`: 1 to 100. Defaults to 2. */
  columns?: number
  /** `sortRows`: zero-based. Defaults to the column of the selection. */
  column?: number
  /** `sortRows`. Defaults to `ascending`. */
  order?: 'ascending' | 'descending'
  /** `sortRows`. Defaults to `text`. */
  comparison?: 'text' | 'number'
}

export type SlashCommandName =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock'
  | 'table'
  | 'callout'
  | 'divider'
  | 'diagram'
export interface SlashCommand {
  name: string
  keywords?: readonly string[]
  /** Returns Markdown to insert in place of the trigger. Undefined cancels the action. */
  action(
    context: DocumentContext,
  ): string | undefined | Promise<string | undefined>
}
export interface SlashMenuOptions {
  enabled?: boolean
  commands?: readonly SlashCommandName[]
  customCommands?: readonly SlashCommand[]
}
