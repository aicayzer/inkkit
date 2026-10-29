import type { Ctx } from '@milkdown/kit/ctx'
import type {
  Fragment,
  Node as ProseNode,
  Slice,
} from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import type { DiagramStore } from '../mermaid'
import type {
  ClipboardInput,
  ClipboardOutput,
  DocumentContext,
  DocumentFormat,
  DocumentVersion,
  EditorLabels,
  FileAdapter,
  FormatPromise,
  ImageAdapter,
  PrintableDocument,
} from '../types'

/** The current document as the editor holds it: its text, which for RTF is the canonical JSON of
 *  its `RichTextDocument`. */
export interface SavedText extends DocumentVersion {
  readonly format: DocumentFormat
  readonly text: string
  readonly dirty: boolean
}

/** What a format whose document is not source text adds to formatted editing. */
export interface RichTextBehaviour {
  /** Whether the document that `tr` reaches from `before` holds only what the format can. */
  allows(tr: Transaction, before: EditorState): boolean
  /** Runs in `from` to `to` that hold both a link and underline, which the format cannot keep. */
  linkedUnderlines(
    doc: ProseNode,
    from: number,
    to: number,
  ): { from: number; to: number }[]
  /** Whether the selection is all link text, where underline does nothing. */
  inLink(state: EditorState): boolean
  /** The slice a formatted paste inserts. */
  paste(
    input: ClipboardInput,
    state: EditorState,
    linkSchemes: ReadonlySet<string>,
  ): Slice
  /** What copying the selection writes. */
  copy(
    state: EditorState,
    linkSchemes: ReadonlySet<string>,
  ): { text: string; html: string }
}

/** What a format keeps from reading a text, to save edits to the document it read. */
export interface FormatSource {
  /** The document read from the text. */
  readonly baseline: ProseNode
  /** The text to save for `doc`, which is `baseline` after edits. `carried` holds nodes that block
   *  moves carried. Absent for a format that saves its literal surface's text. */
  serialize?(doc: ProseNode, carried?: WeakSet<ProseNode>): string
}

/** What a format's output reads from the editor. Each call reads the current value, and
 *  `context()` names a new operation, so call it only when an adapter needs it. */
export interface FormatOutput {
  ctx(): Ctx
  element(): HTMLTextAreaElement
  sourceMode(): boolean
  exportDocument(text: string): ProseNode
  images(): ImageAdapter | undefined
  files(): FileAdapter | undefined
  linkSchemes(): ReadonlySet<string>
  context(): DocumentContext
  diagrams(): DiagramStore
  root(): HTMLElement
  remember<T extends { text: string; html: string }>(
    output: T,
    markdown: string,
    content: Fragment,
    privateSource?: boolean,
  ): T
}

export type PrintableContent = Pick<
  PrintableDocument,
  'html' | 'styles' | 'assets' | 'warnings'
>

export interface PrintRequest {
  /** The current text. */
  readonly text: string
  /** The document to print, which holds source typed but not yet settled. */
  readonly doc: ProseNode
  readonly signal: AbortSignal
  readonly output: FormatOutput
}

export interface ClipboardRequest {
  readonly snapshot: SavedText
  /** The whole document, rather than the selection. */
  readonly all: boolean
  readonly version: DocumentVersion
  readonly output: FormatOutput
  /** Runs asynchronous output work, and throws `stale-document` when the document, its revision or
   *  the editing mode changed meanwhile. */
  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
  /** Throws unless the captured document is still current. */
  assertCurrent(): void
}

/**
 * Everything that differs between document formats. The editor sets one handler on each load and
 * reads its fields directly, so a keystroke does no lookup.
 */
export interface FormatHandler {
  readonly format: DocumentFormat
  readonly promise: FormatPromise
  /** The person edits only the literal surface: there is no formatted mode, and no format, table
   *  or block commands. */
  readonly literalOnly: boolean
  /** A source mode exists beside formatted mode. */
  readonly sourceMode: boolean
  /** The label that names the literal surface. */
  readonly literalLabel: keyof Pick<
    EditorLabels,
    'plainTextEditor' | 'sourceEditor'
  >
  /** `headings` lists the document's headings. */
  readonly headings: boolean
  /** Copying from the literal surface is left to the browser. */
  readonly nativeCopy: boolean
  /** Text inserted on the literal surface keeps its own line endings, rather than taking the
   *  document's. */
  readonly keepsInsertedLineEndings: boolean
  /** Markdown input rules and bare-address links apply while typing in formatted mode. */
  readonly markdownInput: boolean
  /** Present for a format that is not Markdown source but edits in formatted mode. */
  readonly richText?: RichTextBehaviour
  /** Reads loaded text into the formatted document. Throws when it cannot be shown. */
  load(ctx: Ctx, text: string): FormatSource
  /** Reads text from the literal surface into the formatted document. */
  parse(ctx: Ctx, text: string): FormatSource
  /** The document that output reads while text from the literal surface has not reached the
   *  formatted document, or `undefined` to read the formatted document. */
  pendingExport(ctx: Ctx, text: string): ProseNode | undefined
  /** The text that a paste on the literal surface inserts. */
  literalPaste(input: ClipboardInput): string
  print(request: PrintRequest): Promise<PrintableContent>
  clipboard(request: ClipboardRequest): Promise<ClipboardOutput>
}
