import {
  Diagnostics,
  diagnosticOperation,
  diagnosticNumber,
  diagnosticReason,
  type DiagnosticReport,
  type DiagnosticState,
  type DiagnosticPresentation,
} from './diagnostics'
import { EditorActivation } from './editor-activation'
import {
  createEditorSuggestions,
  insertWikiSuggestion,
  insertSlashSuggestion,
  runSlashAction,
} from './editor-suggestions'
import {
  releaseFocus,
  captureReloadSurface,
  restoreReloadSurface,
} from './editor-focus'
import {
  applyInputPolicy,
  createInputPolicyPlugin,
  createHistoryInputPlugin,
  createChangePlugin,
} from './editor-policy'
import {
  insertPlainText,
  insertNativeText,
  insertPaths,
  insertImages,
  appendImages,
} from './editor-insert'
import {
  checkDestination,
  setLink,
  editReferenceDefinition,
  openSelectedLink,
} from './editor-links'
import { insertFootnote, navigateFootnote } from './editor-footnotes'
import { EditorOutput } from './editor-output'
import { EditorClipboard } from './editor-clipboard'
import { EditorText } from './editor-text'
import { EditorViewport } from './editor-viewport'
import { EditorSearch } from './editor-search'
import { SourceSurface } from './editor-source'
import { EditorDocument } from './editor-document'
import { SourceHistory } from './editor-history'
import { $prose } from '@milkdown/kit/utils'
import {
  applyFormat,
  caretAlignment,
  formatAvailability,
} from './editor-commands'
import {
  createEditorKeymap,
  tableShortcut,
  createKeymapPlugin,
  createIndentPlugin,
  routeNativeKey,
} from './editor-keymap'
import {
  createMilkdownEditor,
  createDocumentState,
  initialDocumentSelection,
} from './editor-milkdown'
import { caretState } from './editor-selection'
import type { SlashMenuOptions, SlashCommandName, SlashCommand } from './types'
import type { Suggestions, SuggestionSession } from './suggestions'
import { slashMenuOptions } from './slash-menu'
import { type Editor, editorViewCtx } from '@milkdown/kit/core'
import { closeHistory } from '@milkdown/kit/prose/history'
import {
  Mark as ProseMark,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { literalRereadKey } from './literal-edits'
import { defaultLabels } from './labels'
import { extraLinkSchemes } from './link-safety'
import {
  defaultFormats,
  documentFormats,
  formatHandlers,
  type FormatSource,
  type SavedText,
} from './formats'
import {
  linkProblem,
  readRichTextDocument,
  richTextFromText,
  richTextText,
} from './formats/rich-text-model'
import {
  markdownToRichText,
  richContentMarkdown,
  richTextToMarkdown,
} from './formats/convert'
import { sourceAttribute, type SourceProvenance } from './source'
import { referenceDefinitions } from './references'
import { mediaPolicyEvent, requestRefresh } from './files'
import {
  tableCommand,
  tableCommands,
  tableAvailability,
  tableContext,
  tableOptions,
  configureTableMovement,
} from './tables'
import {
  InkKitError,
  type ClientPoint,
  type DocumentFormat,
  type DocumentInput,
  type DocumentSnapshot,
  type ConvertedDocument,
  type TextDocumentFormat,
  type DocumentContext,
  type ImageAdapter,
  type FileAdapter,
  type WikiLinkAdapter,
  type CapturedImage,
  type ClipboardInput,
  type ClipboardOutput,
  type ClipboardScope,
  type DocumentVersion,
  type PrintableDocument,
  type TextRange,
  type ReadableTextSnapshot,
  type TextRect,
  type ViewportInsets,
  type ViewportOptions,
  type ViewportSnapshot,
  type EditorLabels,
  type Heading,
  type TableCommand,
  type TableOptions,
  type BlockMoveDirection,
  type OfferedFormat,
} from './types'
import type { TextProjection } from './text-ranges'
import { canMoveBlock, carriedBlocks, moveBlockTransaction } from './block-move'
import { isWrittenEdit, setCommentVisibility } from './comments'
import { assertHiddenCommentsKept } from './hidden-comments'
import { PasteController } from './paste'
import { DocumentSession, type SessionCapture } from './session'
import {
  coded,
  expectArray,
  expectBoolean,
  expectGeneration,
  expectInteger,
  expectNumber,
  expectOneOf,
  expectRecord,
  expectString,
  invalidArgument,
  isOmitted,
  optionalBoolean,
  optionalGeneration,
  optionalRecord,
  optionalString,
} from './errors'
import { setSelectionHostActive } from './selection'
import {
  collectFormattedHeadings,
  collectSourceHeadings,
  navigateFormattedHeading,
  sourceHeadingPosition,
  type OutlineContext,
} from './outline'
import { diagramsAvailable, DiagramStore } from './mermaid'

/** An inline format that `CaretState` can report. */
export type Mark =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'highlight'
  | 'underline'
  | 'superscript'
  | 'subscript'
  | 'code'
  | 'link'

/** The kind of block that holds the start of the selection. Any other block reports `paragraph`. */
export type Block =
  | { type: 'paragraph' }
  | { type: 'heading'; level: number } // `level` is 1 to 6
  | { type: 'codeBlock' }
  | { type: 'bulletList' }
  | { type: 'orderedList' }
  | { type: 'taskList' }

/** `source` shows the Markdown or literal text in a textarea. A TXT document is always `source`. */
export type EditingMode = 'source' | 'formatted'
const editingModes: readonly EditingMode[] = ['source', 'formatted']

/** The formatting at the selection, for host toolbars. */
export interface CaretState {
  /** At a caret, the marks the next typed text takes. For a range, every mark found in it. */
  marks: Mark[]
  block: Block
  /** One quote holds the whole selection; the block is what sits inside it. */
  quoted: boolean
  /** The address of the link at the caret or, for a range, of the first link in it, as the
   *  document holds it. Present exactly when `marks` includes `'link'`. For a reference link, it
   *  is the address its definition gives. A host's Link sheet starts from it. */
  href?: string
  /** In an RTF document, the alignment of the paragraph that holds the start of the selection. */
  align?: 'left' | 'center' | 'right' | 'justify'
}

const formatCommands = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'paragraph',
  'bold',
  'italic',
  'strikethrough',
  'highlight',
  'underline',
  'superscript',
  'subscript',
  'code',
  'codeBlock',
  'quote',
  'bulletList',
  'orderedList',
  'taskList',
  'toggleTask',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'alignJustify',
  'link',
] as const

/** A command for `format`. */
export type FormatCommand = (typeof formatCommands)[number]

/** `destination` goes only with `link`, and `language` only with `codeBlock`. */
export interface FormatOptions {
  destination?: string
  language?: string
}

/** Checks a format call's options against its command. */
function formatOptions(
  command: unknown,
  options: unknown,
): FormatOptions | undefined {
  expectOneOf(command, formatCommands, 'command')
  const allowed =
    command === 'link'
      ? ['destination']
      : command === 'codeBlock'
        ? ['language']
        : []
  const record = optionalRecord(options, 'options', allowed)
  if (!record) return undefined
  return {
    destination: optionalString(record.destination, 'options.destination'),
    language: optionalString(record.language, 'options.language'),
  }
}

/** A key press for `keyDown`. An omitted modifier is not held. */
export interface KeyInput {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

const keyModifiers = ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const

function keyInput(value: unknown): Required<KeyInput> {
  const record = expectRecord(value, 'input', ['key', 'code', ...keyModifiers])
  const input = {
    key: expectString(record.key, 'input.key'),
    code: optionalString(record.code, 'input.code') ?? '',
  } as Required<KeyInput>
  for (const name of keyModifiers)
    input[name] = optionalBoolean(record[name], `input.${name}`) ?? false
  return input
}

/** An image to insert by the reference its adapter already stored it under. */
export interface ImageInsertion {
  reference: string
  alt: string
  title?: string
}

function imageInsertions(value: unknown): ImageInsertion[] {
  return expectArray(value, 'images').map((image, index) => {
    const name = `images[${index}]`
    const record = expectRecord(image, name, ['reference', 'alt', 'title'])
    return {
      reference: expectString(record.reference, `${name}.reference`),
      alt: expectString(record.alt, `${name}.alt`),
      title: optionalString(record.title, `${name}.title`),
    }
  })
}

function clientPoint(value: unknown, name: string): ClientPoint {
  const point = expectRecord(value, name, ['clientX', 'clientY'])
  return {
    clientX: expectNumber(point.clientX, `${name}.clientX`),
    clientY: expectNumber(point.clientY, `${name}.clientY`),
  }
}

/** A name in `Keymap`: every format command except `link`, history, link opening, block moves, list indentation,
 *  and every table command. */
export type ShortcutName =
  | Exclude<FormatCommand, 'link'>
  | 'undo'
  | 'redo'
  | 'moveBlockUp'
  | 'moveBlockDown'
  | 'indent'
  | 'outdent'
  | 'openLink'
  | `table${Capitalize<TableCommand>}`

/** Host bindings in ProseMirror key notation, by shortcut name. */
export type Keymap = Partial<Record<ShortcutName, readonly string[]>>

const formatShortcuts = formatCommands.filter(
  (command): command is Exclude<FormatCommand, 'link'> => command !== 'link',
)

/** Every `ShortcutName`. */
export const shortcutNames: readonly ShortcutName[] = [
  ...formatShortcuts,
  'undo',
  'redo',
  'moveBlockUp',
  'moveBlockDown',
  'indent',
  'outdent',
  'openLink',
  ...tableCommands.map(tableShortcut),
]

/** Checks a keymap and drops omitted entries, so a `null` binding keeps its default. */
function keymapBindings(value: unknown, name: string): Keymap {
  const record = expectRecord(value, name, shortcutNames)
  const keymap: Record<string, readonly string[]> = {}
  for (const [shortcut, keys] of Object.entries(record)) {
    if (isOmitted(keys)) continue
    keymap[shortcut] = expectArray(keys, `${name}.${shortcut}`).map(
      (key, index) => expectString(key, `${name}.${shortcut}[${index}]`),
    )
  }
  return keymap
}

const footnoteTargets = ['definition', 'reference'] as const

function footnoteLabel(label: string): boolean {
  return !!label && !/[\s\[\]\\]/.test(label) && label.length <= 999
}

/** Hints for the browser's input features, and smart punctuation. A field left out takes its default. */
export interface TextInputPreferences {
  spellcheck?: boolean
  autocorrect?: boolean
  autocapitalize?: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters'
  /** Typing a quote or `--` gives a curly quote or a dash, in formatted mode. Off unless true. */
  smartPunctuation?: boolean
}

const autocapitalizeValues = [
  'off',
  'none',
  'on',
  'sentences',
  'words',
  'characters',
] as const

function textInputPreferences(
  value: unknown,
  name: string,
): TextInputPreferences {
  const record = expectRecord(value, name, [
    'spellcheck',
    'autocorrect',
    'autocapitalize',
    'smartPunctuation',
  ])
  return {
    spellcheck: optionalBoolean(record.spellcheck, `${name}.spellcheck`),
    autocorrect: optionalBoolean(record.autocorrect, `${name}.autocorrect`),
    smartPunctuation: optionalBoolean(
      record.smartPunctuation,
      `${name}.smartPunctuation`,
    ),
    autocapitalize: isOmitted(record.autocapitalize)
      ? undefined
      : expectOneOf(
          record.autocapitalize,
          autocapitalizeValues,
          `${name}.autocapitalize`,
        ),
  }
}

/** Mount options. Adapters, `formats`, `labels`, `linkSchemes` and `rendering` are fixed at mount;
 *  the rest can change. `F` is the formats offered. */
export interface EditorOptions<F extends DocumentFormat = TextDocumentFormat> {
  /** The formats the host offers, listed by `formats`. Defaults to `['md', 'txt']`. Fixed at mount. */
  formats?: readonly F[]
  /** Shows, imports and exports images. Without it and `files`, image Markdown stays literal. */
  images?: ImageAdapter
  /** Opt-in block suggestions on an empty line. Fixed at mount. */
  slashMenu?: SlashMenuOptions
  /** Resolves path images and `![[name]]` embeds into images, audio, video, PDFs and file cards. */
  files?: FileAdapter
  /** Resolves and opens `[[wiki links]]`. Without it they stay literal. */
  wikiLinks?: WikiLinkAdapter
  /** Defaults to true. See `setEditable`. */
  editable?: boolean
  textInput?: TextInputPreferences
  /** Replaces built-in text and accessible names. */
  labels?: Partial<EditorLabels>
  /** See `setKeymap`. */
  keymap?: Keymap
  /** Schemes beyond `http`, `https`, `mailto` and `tel` that links may use, such as `things`.
   *  Fixed at mount. */
  linkSchemes?: readonly string[]
  rendering?: {
    /** Defaults to true. */
    codeHighlighting?: boolean
    /** Defaults to true. */
    diagramPreview?: boolean
  }
}

const adapterNames = ['images', 'files', 'wikiLinks'] as const

/** Checks the host's format list: at least one known format, none repeated. */
function offeredFormats(
  value: unknown,
  name: string,
): readonly DocumentFormat[] {
  const formats = expectArray(value, name).map((format, index) =>
    expectOneOf(format, documentFormats, `${name}[${index}]`),
  )
  if (!formats.length)
    throw invalidArgument(`${name} must list at least one format`)
  if (new Set(formats).size !== formats.length)
    throw invalidArgument(`${name} must not list a format twice`)
  return formats
}

/** Checks mount options and returns them with omitted values removed. */
function editorOptions(value: unknown): EditorOptions {
  const options =
    optionalRecord(value, 'options', [
      ...adapterNames,
      'editable',
      'textInput',
      'labels',
      'keymap',
      'linkSchemes',
      'rendering',
      'slashMenu',
      'formats',
    ]) ?? {}
  for (const name of adapterNames)
    optionalRecord(options[name], `options.${name}`)
  const wiki = options.wikiLinks as WikiLinkAdapter | undefined
  if (wiki?.suggest != null && typeof wiki.suggest !== 'function')
    throw invalidArgument('wikiLinks.suggest must be a function')
  optionalBoolean(options.editable, 'options.editable')
  if (!isOmitted(options.textInput))
    textInputPreferences(options.textInput, 'options.textInput')
  if (!isOmitted(options.keymap))
    keymapBindings(options.keymap, 'options.keymap')
  const linkSchemes = isOmitted(options.linkSchemes)
    ? undefined
    : extraLinkSchemes(options.linkSchemes, 'options.linkSchemes')
  const rendering = optionalRecord(options.rendering, 'options.rendering', [
    'codeHighlighting',
    'diagramPreview',
  ])
  optionalBoolean(
    rendering?.codeHighlighting,
    'options.rendering.codeHighlighting',
  )
  optionalBoolean(rendering?.diagramPreview, 'options.rendering.diagramPreview')
  const labels = optionalRecord(
    options.labels,
    'options.labels',
    Object.keys(defaultLabels),
  )
  return {
    ...options,
    formats: isOmitted(options.formats)
      ? undefined
      : offeredFormats(options.formats, 'options.formats'),
    slashMenu: slashMenuOptions(options.slashMenu),
    linkSchemes,
    labels:
      labels &&
      Object.fromEntries(
        Object.entries(labels)
          .filter(([, label]) => !isOmitted(label))
          .map(([key, label]) => [
            key,
            expectString(label, `options.labels.${key}`),
          ]),
      ),
  } as EditorOptions
}

/** What the editor can do now. Availability is the state at the time of the call, not a promise. */
export interface CommandState extends DocumentVersion {
  format: DocumentFormat
  mode: EditingMode
  editable: boolean
  /** Text composition (IME) is in progress. */
  composing: boolean
  /** An image import is running. */
  pending: boolean
  caret: CaretState
  /** Present when the selection is in a table. `rows` includes the header row. */
  table?: { row: number; column: number; rows: number; columns: number }
  commands: {
    undo: boolean
    redo: boolean
    insertText: boolean
    paste: boolean
    replace: boolean
    replaceSource: boolean
    insertImages: boolean
    appendImages: boolean
    insertPaths: boolean
    insertFootnote: boolean
    editReferenceDefinition: boolean
    format: Record<FormatCommand, boolean>
    table: Record<TableCommand, boolean>
    moveBlockUp: boolean
    moveBlockDown: boolean
  }
}

/** The host's handlers, passed to `mount`. Only `changed` is required. `F` is the formats offered. */
export interface EditorEvents<F extends DocumentFormat = TextDocumentFormat> {
  /** The document changed. Not sent for a load, a reload or a refused edit. */
  changed(snapshot: DocumentSnapshot<F>): void
  /** Availability or the caret changed, and once after each load. */
  commandStateChanged?(state: CommandState): void
  /** A primary click with Mod on a link. Without it, links don't open. */
  openLink?(href: string): void
  /** The Copy button on a code block was clicked. Without this handler, no button is drawn. */
  copy?(text: string): void
  /** A failure that no call is waiting for, such as one in an edit the person made. */
  error?(error: InkKitError): void
  /** The person copied or cut a selection that holds an image or a diagram. Resolve after the
   *  native clipboard write succeeds; a cut removes the selection only then. */
  clipboard?(content: ClipboardOutput): void | Promise<void>
}

const requiredEvents = ['changed'] as const
const optionalEvents = [
  'commandStateChanged',
  'openLink',
  'copy',
  'error',
  'clipboard',
] as const

/** Every member of `EditorEvents`. The type check below fails to compile when one is left out. */
export const editorEvents = [
  ...requiredEvents,
  ...optionalEvents,
] as const satisfies readonly (keyof EditorEvents)[]
const everyEvent: [
  Exclude<keyof EditorEvents, (typeof editorEvents)[number]>,
] extends [never]
  ? true
  : never = true
void everyEvent

/**
 * Checks the host's handlers and returns them so that an exception thrown by one is the host's: it
 * goes to the platform's `reportError`, never becomes an InkKit error and never stops InkKit's own
 * work or makes a call throw. `clipboard` is left as it is, because its failure is
 * `clipboard-unavailable`.
 */
function hostEvents(value: unknown): EditorEvents {
  const events = expectRecord(value, 'events', editorEvents)
  for (const name of editorEvents) {
    const optional = (optionalEvents as readonly string[]).includes(name)
    if (
      typeof events[name] !== 'function' &&
      !(optional && isOmitted(events[name]))
    )
      throw invalidArgument(`events.${name} must be a function`)
  }
  return new Proxy(events, {
    get(target, name) {
      const handler: unknown = Reflect.get(target, name)
      if (name === 'clipboard' || typeof handler !== 'function') return handler
      return (...args: unknown[]) => {
        try {
          return handler.apply(target, args)
        } catch (error) {
          if (typeof globalThis.reportError === 'function')
            globalThis.reportError(error)
          else
            setTimeout(() => {
              throw error
            })
        }
      }
    },
  }) as unknown as EditorEvents
}

/** A checked load: the document's text, which for RTF is its canonical JSON. */
interface LoadInput {
  documentId: string
  generation: number
  format: DocumentFormat
  text: string
}

/** Checks a load's input. A format the host did not offer is refused like an unknown one, and an
 *  RTF document is checked and put in canonical form. */
function documentInput(
  value: unknown,
  offered: readonly DocumentFormat[],
): LoadInput {
  const input = expectRecord(value, 'input')
  const documentId = expectString(input.documentId, 'input.documentId')
  const generation = expectGeneration(input.generation, 'input.generation')
  const format = expectOneOf(input.format, offered, 'input.format')
  if (format === 'rtf') {
    if (!isOmitted(input.text))
      throw invalidArgument('input.text must be left out for an RTF document')
    return {
      documentId,
      generation,
      format,
      text: richTextText(
        readRichTextDocument(input.document, 'input.document'),
      ),
    }
  }
  if (!isOmitted(input.document))
    throw invalidArgument(`input.document must be left out for ${format}`)
  return {
    documentId,
    generation,
    format,
    text: expectString(input.text, 'input.text'),
  }
}

/** The public snapshot of the editor's text for a document. */
function publicSnapshot(saved: SavedText): DocumentSnapshot<DocumentFormat> {
  const { documentId, generation, revision, format, text, dirty } = saved
  return format === 'rtf'
    ? {
        documentId,
        generation,
        revision,
        format,
        document: richTextFromText(text),
        dirty,
      }
    : { documentId, generation, revision, format, text, dirty }
}

/** A range's shape. Whether its offsets fit the snapshot is `invalid-range`, checked later. */
function textRange(value: unknown, name: string): void {
  const range = expectRecord(value, name)
  expectString(range.snapshotId, `${name}.snapshotId`)
  for (const end of ['from', 'to'])
    if (typeof range[end] !== 'number')
      throw invalidArgument(`${name}.${end} must be a number`)
}

/** An entry `headings()` returned, which may have gone stale since. */
function headingEntry(value: unknown): void {
  const heading = expectRecord(value, 'heading')
  expectString(heading.id, 'heading.id')
  expectInteger(heading.level, 'heading.level', { min: 1, max: 6 })
  expectString(heading.text, 'heading.text')
  expectString(heading.documentId, 'heading.documentId')
  expectGeneration(heading.generation, 'heading.generation')
  expectInteger(heading.revision, 'heading.revision', { min: 0 })
}

const clipboardScopes: readonly ClipboardScope[] = ['document', 'selection']

function clipboardInput(value: unknown): ClipboardInput {
  const input = expectRecord(value, 'input', [
    'text',
    'markdown',
    'html',
    'images',
  ])
  return {
    text: expectString(input.text, 'input.text'),
    markdown: optionalString(input.markdown, 'input.markdown'),
    html: optionalString(input.html, 'input.html'),
    images: isOmitted(input.images)
      ? undefined
      : expectArray(input.images, 'input.images').map((image, index) =>
          capturedImage(image, `input.images[${index}]`),
        ),
  }
}

function capturedImage(value: unknown, name: string): CapturedImage {
  const image = expectRecord(value, name)
  if (!(image.bytes instanceof Uint8Array))
    throw invalidArgument(`${name}.bytes must be a Uint8Array`)
  return {
    bytes: image.bytes,
    mimeType: expectString(image.mimeType, `${name}.mimeType`),
    filename: optionalString(image.filename, `${name}.filename`),
    source: optionalString(image.source, `${name}.source`),
  }
}

interface FacadeCall {
  refusal?: InkKitError
  /** Host events raised during the call, sent when it succeeds and dropped when it fails. */
  events: { name: string | symbol; send: () => void }[]
}

/** Host events that report the editor's state, which a failed call must not have changed. */
const stateEvents: readonly (string | symbol)[] = [
  'changed',
  'commandStateChanged',
]

/**
 * The editor. Create it with `InkKitEditor.mount`, load a document, and read it back with
 * `snapshot`. The reference is https://inkkit.cyzr.me/reference/editor.
 */
export class InkKitEditor<F extends DocumentFormat = TextDocumentFormat> {
  private editor!: Editor
  private readonly diagnostics = new Diagnostics(() => this.diagnosticState())
  private readonly document = new EditorDocument({
    ctx: () => this.editor.ctx,
    literal: () => this.literalSurface,
    pending: () => this.history.pendingText,
  })
  private readonly history = new SourceHistory({
    ctx: () => this.editor.ctx,
    format: () => this.document.format,
    literal: () => this.literalSurface,
    writable: () => this.writable,
    currentText: (doc) => this.document.currentText(doc),
    parseSource: (text, provenance) =>
      this.document.parseSource(text, provenance),
    remember: (doc, text) => this.document.remember(doc, text),
    selection: () => ({
      from: this.source.element.selectionStart,
      to: this.source.element.selectionEnd,
    }),
    beforeInput: () => this.source.beforeInput,
    showSource: (text, from, to) => this.source.showTypedSource(text, from, to),
    changed: () => {
      this.session.changed()
      this.output.cancel()
      this.search.invalidate()
    },
    publish: (text) => {
      if (text !== this.lastMarkdown) {
        this.lastMarkdown = text
        this.events.changed(this.changeSnapshot(text))
      }
      this.publishCommandState()
    },
    loading: (operation) => {
      this.loading = true
      try {
        operation()
      } finally {
        this.loading = false
      }
    },
  })
  private readonly text = new EditorText({
    view: () => this.editor.ctx.get(editorViewCtx),
    literal: () => this.literalSurface,
    element: () => this.source.element,
    capture: () => this.session.capture(),
    version: () => this.session.version(),
    format: () => this.document.format,
    mode: () => this.editingMode,
  })
  private readonly geometry = new EditorViewport({
    root: () => this.root,
    view: () => this.editor.ctx.get(editorViewCtx),
    literal: () => this.literalSurface,
    element: () => this.source.element,
  })
  private readonly search = new EditorSearch({
    view: () => this.editor.ctx.get(editorViewCtx),
    literal: () => this.literalSurface,
    element: () => this.source.element,
    currentText: () => this.document.currentText(),
    capture: () => this.session.capture(),
    applySource: (text, isolated, from, to) =>
      this.history.applySource(text, isolated, from, to),
    assertPreserved: (before, after) =>
      this.document.assertPreserved(before, after),
    revealLiteral: () => this.revealLiteralSelection(),
    revealCurrent: () => this.revealCurrentSelection(),
  })
  private readonly diagrams = new DiagramStore()
  private readonly output: EditorOutput = new EditorOutput({
    ctx: () => this.editor.ctx,
    exportDocument: (text) => this.document.exportDocument(text),
    richTextMarkdown: (content) =>
      richContentMarkdown(this.editor.ctx, content),
    diagrams: () => this.diagrams,
    root: () => this.root,
    handler: () => this.document.handler,
    sourceMode: () => this.mode === 'source',
    element: () => this.source.element,
    images: () => this.options.images,
    files: () => this.options.files,
    linkSchemes: () => this.linkSchemes,
    context: () => this.context(),
    assertCaptured: (captured, aborted) =>
      this.assertCaptured(captured, aborted),
    remember: (output, markdown, content, privateSource) =>
      this.clipboard.remember(output, markdown, content, privateSource),
  })
  private readonly clipboard: EditorClipboard = new EditorClipboard({
    ctx: () => this.editor.ctx,
    handler: () => this.document.handler,
    sourceMode: () => this.mode === 'source',
    element: () => this.source.element,
    replaceSelection: (text) => this.source.replaceLiteralSelection(text),
    writable: () => this.writable,
    snapshot: () => this.savedText(),
    prepareSelection: () => this.clipboardSnapshot('selection'),
    capture: () => this.session.capture(),
    assertCut: (captured) => this.assertCut(captured),
    canWrite: () => Boolean(this.events.clipboard),
    write: (content) => this.events.clipboard!(content),
    linkSchemes: () => this.linkSchemes,
    report: (error) => this.report(error),
  })
  private lastMarkdown = ''
  private readonly session = new DocumentSession()
  private mode: EditingMode = 'formatted'
  private ready = false
  private destroyed = false
  private pasteController!: PasteController
  private source!: SourceSurface
  private root!: HTMLElement
  private ownsRootClass = false
  private activation!: EditorActivation
  private reportingSuppressed = false
  private loading = false
  private call?: FacadeCall
  private writable = true
  private inputPreferences: TextInputPreferences = {}
  private literalKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private indentKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private readOnlyKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private suggestions?: Suggestions
  private suggestionBase?: EditorState
  private changePlugin = createChangePlugin((view, previous) =>
    this.documentChanged(view, previous),
  )

  private documentChanged(view: EditorView, previous: EditorState): void {
    if (
      this.loading ||
      this.document.sameDocument(view.state.doc, previous.doc)
    )
      return
    // Settling typed source brings the document up to a revision and a
    // change event that were already reported.
    if (this.history.syncing) {
      this.mediaPolicy()
      return
    }
    this.session.changed()
    this.output.cancel()
    this.mediaPolicy()
    this.search.invalidate()
    let markdown: string
    try {
      markdown = this.document.currentText(view.state.doc)
    } catch (error) {
      this.report(coded(error, 'preservation'))
      return
    }
    if (this.literalSurface)
      this.source.reconcileFormattedChange(
        markdown,
        view.state.doc.attrs[sourceAttribute] as SourceProvenance | null,
      )

    if (markdown === this.lastMarkdown) return
    this.lastMarkdown = markdown
    this.events.changed(this.changeSnapshot(markdown))
  }

  private keys: (view: EditorView, event: KeyboardEvent) => boolean = () =>
    false
  private readingKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false

  private readonly events: EditorEvents<F>
  /** The host's extra link schemes, in lower case. */
  private readonly linkSchemes: ReadonlySet<string>
  /** The formats the host offered, in its order. */
  private readonly offered: readonly DocumentFormat[]
  private readonly formatList: readonly OfferedFormat[]

  /** How many of each state event the host has been sent. */
  private readonly sentEvents = new Map<string | symbol, number>()

  private constructor(
    events: EditorEvents<F>,
    private readonly options: EditorOptions<F>,
  ) {
    // During a facade call, state events wait until the call has succeeded.
    this.events = new Proxy(events, {
      get: (target, name) => {
        const handler: unknown = Reflect.get(target, name)
        if (!stateEvents.includes(name) || typeof handler !== 'function')
          return handler
        return (...args: unknown[]) => {
          const send = () => {
            this.sentEvents.set(name, (this.sentEvents.get(name) ?? 0) + 1)
            handler.apply(target, args)
          }
          if (this.call) this.call.events.push({ name, send })
          else send()
        }
      },
    })
    this.linkSchemes = new Set(options.linkSchemes)
    this.offered = options.formats ?? defaultFormats
    this.formatList = Object.freeze(
      this.offered.map((format) =>
        Object.freeze({ format, promise: formatHandlers[format].promise }),
      ),
    )
    this.writable = options.editable ?? true
    this.inputPreferences = textInputPreferences(
      options.textInput ?? {},
      'options.textInput',
    )
  }

  private context(): DocumentContext {
    return this.session.context()
  }

  /** The generation of the loaded document, for the composition check of native input. */
  private get generation(): number | undefined {
    return this.session.generation
  }

  /** What `changed` reports for the document's new text. */
  private changeSnapshot(text: string): DocumentSnapshot<F> {
    return publicSnapshot(this.saved(text)) as DocumentSnapshot<F>
  }

  private saved(text: string): SavedText {
    return {
      ...this.session.version(),
      format: this.document.format,
      text,
      dirty: text !== this.document.original,
    }
  }

  /** The current text, as `snapshot` checks and reads it. */
  private savedText(expectedGeneration?: unknown): SavedText {
    this.assertCurrent(expectedGeneration)
    return this.saved(this.document.currentText())
  }

  /** Throws unless the document `captured` describes is still current, alive, not composing and
   *  has no import pending. */
  private assertCaptured(captured: SessionCapture, aborted = false): void {
    this.assertAlive()
    if (aborted || !captured.isCurrent())
      throw new InkKitError(
        'stale-document',
        'Document changed while preparing output',
      )
    this.assertCurrent()
  }

  /** Throws unless a deferred cut can still remove what it copied: the document, its revision,
   *  the editing mode and editability are as they were when the cut started. */
  private assertCut(captured: SessionCapture): void {
    this.assertAlive()
    if (!captured.isCurrent())
      throw new InkKitError('stale-document', 'Document changed before cutting')
    this.assertMutation()
    if (!captured.isCurrent({ editability: true }))
      throw new InkKitError(
        'stale-document',
        'Editability changed before cutting',
      )
  }

  /** What file and wiki-link views capture: the adapter context, and whether the same load is
   *  still current. Edits do not make their work stale. */
  private adapterCapture(): {
    context: DocumentContext
    isCurrent(): boolean
  } {
    const captured = this.session.capture()
    return { context: this.context(), isCurrent: captured.isLoaded }
  }

  private mediaPolicy(): void {
    if (this.editor && this.root)
      this.editor.ctx
        .get(editorViewCtx)
        .dom.dispatchEvent(new Event(mediaPolicyEvent))
  }

  private assertAlive(): void {
    if (this.destroyed)
      throw new InkKitError('destroyed', 'The editor has been destroyed')
  }

  private assertReady(expectedGeneration?: unknown): void {
    this.assertAlive()
    const expected = optionalGeneration(expectedGeneration)
    if (!this.ready)
      throw new InkKitError('not-ready', 'No document has been loaded')
    if (expected !== undefined && expected !== this.session.generation)
      throw new InkKitError('stale-document', 'Document changed')
  }

  /** Checks, in order, that the editor is alive, that `expectedGeneration` is a generation, and
   *  that the document is loaded, current, not composing and has no import pending. */
  private assertCurrent(expectedGeneration?: unknown): void {
    this.assertReady(expectedGeneration)
    if (
      this.literalSurface
        ? this.source.composing
        : this.editor.ctx.get(editorViewCtx).composing
    )
      throw new InkKitError('composition', 'Text composition is in progress')
    if (this.pasteController.pending)
      throw new InkKitError(
        'operation-pending',
        'An image import is in progress',
      )
  }

  private assertMutation(expectedGeneration?: unknown): void {
    this.assertCurrent(expectedGeneration)
    if (!this.writable)
      throw new InkKitError('read-only', 'The editor is read-only')
  }

  /**
   * Runs one facade call, so that its failure reaches the caller once and coded, and a failed call
   * changes nothing and sends nothing. An edit that the preservation check refuses during the call
   * is thrown, not sent to `events.error`. When the call fails with a refusal or another coded
   * failure, every step it took is undone: the document, selection and history return to their
   * state before the call, and the state events it raised are dropped. An `internal` failure keeps
   * what happened and sends its events, since the editor's state can no longer be trusted to match.
   * Anything else thrown arrives as an `InkKitError`. A call made inside another runs as part of
   * it. Promises reject instead of throwing.
   */
  private facadeCall<T>(operation: () => T): T {
    if (this.call) return operation()
    const call: FacadeCall = { events: [] }
    const before = this.destroyed ? undefined : this.restorePoint()
    this.call = call
    let result: T
    try {
      result = operation()
    } catch (error) {
      const failure = call.refusal ?? coded(error)
      this.call = undefined
      this.finish(call, before, failure)
      throw failure
    }
    this.call = undefined
    this.finish(call, before, call.refusal)
    if (result instanceof Promise) {
      const settled = result.catch((error: unknown) => {
        throw coded(error)
      })
      if (!call.refusal) return settled as T
      settled.catch(() => {})
      return Promise.reject(call.refusal) as T
    }
    if (call.refusal) throw call.refusal
    return result
  }

  /** Sends a finished call's state events in order. Each event reports the whole of its state, so
   *  once a call made from one of the host's handlers has sent a newer event of a kind, the call's
   *  remaining events of that kind are out of date and are dropped. */
  private deliver(events: FacadeCall['events']): void {
    const before = new Map(this.sentEvents)
    const own = new Map<string | symbol, number>()
    for (const { name, send } of events) {
      const count = own.get(name) ?? 0
      if ((this.sentEvents.get(name) ?? 0) !== (before.get(name) ?? 0) + count)
        continue
      own.set(name, count + 1)
      send()
    }
  }

  /** What a failed call puts back. */
  private restorePoint() {
    return {
      state: this.editor.ctx.get(editorViewCtx).state,
      revision: this.session.mark(),
      lastMarkdown: this.lastMarkdown,
      search: this.search.capture(),
      text: this.text.capture(),
      history: this.history.capture(),
    }
  }

  private finish(
    call: FacadeCall,
    before: ReturnType<InkKitEditor['restorePoint']> | undefined,
    failure: InkKitError | undefined,
  ): void {
    if (!failure || failure.code === 'internal' || !before) {
      this.deliver(call.events)
      return
    }
    const view = this.editor.ctx.get(editorViewCtx)
    if (view.state !== before.state) {
      // Loading keeps the change plugin from counting the restored document as another edit.
      const loading = this.loading
      this.loading = true
      try {
        view.updateState(before.state)
      } finally {
        this.loading = loading
      }
    }
    this.session.restore(before.revision)
    this.lastMarkdown = before.lastMarkdown
    this.search.restore(before.search)
    this.text.restore(before.text)
    this.history.restore(before.history)
  }

  /** Reports a refused edit to the facade call that made it, or else to `events.error`. */
  private refuse(error: InkKitError): void {
    this.diagnostics.capture({
      kind: 'error',
      code: error.code,
      ...(error.code === 'preservation'
        ? { reason: diagnosticReason(error) }
        : {}),
    })
    if (this.call) this.call.refusal ??= error
    else this.events.error?.(error)
  }

  /** Reports a failure no call is waiting for. */
  private report(error: unknown): void {
    const failure = coded(error)
    this.diagnostics.capture({
      kind: 'error',
      code: failure.code,
      ...(failure.code === 'preservation'
        ? { reason: diagnosticReason(failure) }
        : {}),
    })
    this.events.error?.(failure)
  }

  /** Runs a facade method for something the person did, such as a shortcut. Its failure goes to
   *  `events.error`, unless a host call such as `keyDown` is waiting for it. */
  private forPerson<T>(operation: () => T, otherwise: T): T {
    try {
      return operation()
    } catch (error) {
      if (this.call) throw error
      this.report(error)
      return otherwise
    }
  }

  private get composing(): boolean {
    return this.literalSurface
      ? this.source.composing
      : this.editor.ctx.get(editorViewCtx).composing
  }

  private diagnosticState(): DiagnosticState {
    const view = this.editor?.ctx.get(editorViewCtx)
    const literal = this.source && this.literalSurface
    return {
      ready: this.ready,
      revision: this.session.revision,
      generation: this.session.generation,
      format: this.document.format,
      mode: literal ? 'source' : 'formatted',
      editable: this.writable,
      composing: Boolean(literal ? this.source.composing : view?.composing),
      pending: Boolean(this.pasteController?.pending),
      ...(view
        ? {
            selection: literal
              ? {
                  from: this.source.element.selectionStart,
                  to: this.source.element.selectionEnd,
                }
              : {
                  from: view.state.selection.from,
                  to: view.state.selection.to,
                },
          }
        : {}),
    }
  }

  /** Starts or clears content-free local tracing. Disabled by default. */
  setDiagnosticsEnabled(enabled: boolean): void {
    this.assertAlive()
    if (typeof enabled !== 'boolean')
      throw invalidArgument('enabled must be a boolean')
    this.diagnostics.setEnabled(enabled, this.root, this.editor.ctx)
  }

  /** Reads diagnostics without serializing the document or requiring an editable surface. */
  diagnosticReport(): DiagnosticReport {
    this.assertAlive()
    let presentation: DiagnosticPresentation | undefined
    if (this.diagnostics.enabled) {
      try {
        const view = this.editor.ctx.get(editorViewCtx)
        const literal = this.literalSurface
        const selection = view.state.selection
        const dom = literal
          ? this.source.element
          : view.domAtPos(selection.from).node
        const element =
          dom.nodeType === 1
            ? (dom as HTMLElement)
            : (dom.parentElement ?? view.dom)
        const window = this.root.ownerDocument.defaultView!
        const style = window.getComputedStyle(element)
        const fontFamily = style.fontFamily
          .slice(0, 160)
          .replace(/[^\p{L}\p{N} ,"'_-]/gu, '')
        const type = selection.$from.parent.type.name
        const block: DiagnosticPresentation['block'] = literal
          ? 'literal'
          : type === 'paragraph'
            ? 'paragraph'
            : type === 'heading'
              ? 'heading'
              : type === 'code_block'
                ? 'code'
                : 'other'
        const markNames = [
          'strong',
          'emphasis',
          'inlineCode',
          'strike_through',
          'link',
          'highlight',
        ] as const
        const marks: DiagnosticPresentation['marks'] = literal
          ? []
          : (view.state.storedMarks ?? selection.$from.marks())
              .slice(0, 12)
              .map(
                (mark) =>
                  markNames.find((name) => name === mark.type.name) ?? 'other',
              )
        const bounds = literal ? undefined : view.coordsAtPos(selection.from)
        presentation = {
          fontFamily,
          fontSize: diagnosticNumber(Number.parseFloat(style.fontSize)),
          fontWeight: diagnosticNumber(
            style.fontWeight === 'normal'
              ? 400
              : style.fontWeight === 'bold'
                ? 700
                : Number.parseFloat(style.fontWeight),
          ),
          fontStyle:
            style.fontStyle === 'normal' ||
            style.fontStyle === 'italic' ||
            style.fontStyle === 'oblique'
              ? style.fontStyle
              : 'other',
          ...(!literal &&
          type === 'heading' &&
          [1, 2, 3, 4, 5, 6].includes(selection.$from.parent.attrs.level)
            ? {
                headingLevel: selection.$from.parent.attrs.level as
                  1 | 2 | 3 | 4 | 5 | 6,
              }
            : {}),
          ...(style.lineHeight !== 'normal'
            ? {
                lineHeight: diagnosticNumber(
                  Number.parseFloat(style.lineHeight),
                ),
              }
            : {}),
          block,
          marks,
          caretColor:
            /^(?:rgba?\([\d.,% ]+\)|#[\da-f]{3,8}|auto|transparent|currentcolor)$/i.test(
              style.caretColor,
            )
              ? style.caretColor.slice(0, 80)
              : 'other',
          ...(bounds
            ? {
                caret: {
                  left: diagnosticNumber(bounds.left),
                  top: diagnosticNumber(bounds.top),
                  right: diagnosticNumber(bounds.right),
                  bottom: diagnosticNumber(bounds.bottom),
                },
              }
            : {}),
          viewport: {
            width: diagnosticNumber(window.innerWidth),
            height: diagnosticNumber(window.innerHeight),
          },
          scroll: {
            left: diagnosticNumber(this.geometry.container.scrollLeft),
            top: diagnosticNumber(this.geometry.container.scrollTop),
          },
        }
      } catch {
        // Layout may be unavailable while a surface is being replaced.
      }
    }
    return this.diagnostics.report(presentation)
  }

  /** The formats the host offered at mount, in its order, with what saving each promises. */
  get formats(): readonly OfferedFormat[] {
    this.assertAlive()
    return this.formatList
  }

  /** Whether the person can edit. A read-only editor still permits selection, copying and find. */
  get editable(): boolean {
    this.assertAlive()
    return this.writable
  }

  /** Turns editing on or off for both surfaces. Throws `composition` during text composition. */
  setEditable(editable: boolean): void {
    this.assertAlive()
    expectBoolean(editable, 'editable')
    if (this.composing)
      throw new InkKitError('composition', 'Text composition is in progress')
    if (this.writable === editable) return
    const suppressed = this.reportingSuppressed
    this.reportingSuppressed = true
    try {
      this.writable = editable
      this.session.editabilityChanged()
      if (!editable) this.pasteController.cancelPending()
      this.editor.ctx
        .get(editorViewCtx)
        .dom.dispatchEvent(new Event('inkkit-cancel-resize'))
      this.applyInputPolicy()
      this.mediaPolicy()
    } finally {
      this.reportingSuppressed = suppressed
    }
    this.publishCommandState()
  }

  /** Supplies native host activation for selection presentation. Null restores browser detection. */
  setHostActive(active: boolean | null): void {
    this.assertAlive()
    if (active !== null) expectBoolean(active, 'active')
    setSelectionHostActive(this.editor.ctx.get(editorViewCtx), active)
  }

  /** Replaces the input preferences. A field left out takes its default. Throws `composition`
   *  during text composition. */
  setTextInputPreferences(preferences: TextInputPreferences): void {
    this.assertAlive()
    const checked = textInputPreferences(preferences, 'preferences')
    if (this.composing)
      throw new InkKitError('composition', 'Text composition is in progress')
    const suppressed = this.reportingSuppressed
    this.reportingSuppressed = true
    try {
      this.inputPreferences = checked
      this.applyInputPolicy()
    } finally {
      this.reportingSuppressed = suppressed
    }
    this.publishCommandState()
  }

  private applyInputPolicy(): void {
    applyInputPolicy(
      this.editor.ctx.get(editorViewCtx),
      this.source.element,
      this.inputPreferences,
      this.options.labels?.[this.document.handler.formattedLabel] ??
        defaultLabels[this.document.handler.formattedLabel],
      {
        writable: () => this.writable,
        literal: () => this.literalSurface,
      },
    )
  }

  private publishCommandState(): void {
    this.suggestions?.refresh()
    if (
      !this.ready ||
      this.loading ||
      this.reportingSuppressed ||
      this.destroyed
    )
      return
    this.events.commandStateChanged?.(this.commandState())
  }

  /** What the editor can do now, for enabling host controls. Unlike `snapshot`, it works during
   *  composition. */
  commandState(expectedGeneration?: number): CommandState {
    this.assertReady(expectedGeneration)
    const view = this.editor.ctx.get(editorViewCtx)
    const { state } = view
    const mutable =
      this.writable && !this.composing && !this.pasteController.pending
    const formatted = mutable && !this.literalSurface
    const rich = this.document.handler.richText != null
    const format = formatAvailability(
      this.editor,
      state,
      formatted,
      this.document.handler,
    )
    const tables = formatted
      ? tableAvailability(this.editor.ctx)
      : (Object.fromEntries(
          tableCommands.map((name) => [name, false]),
        ) as Record<TableCommand, boolean>)
    // An RTF table cell has no alignment of its own.
    if (rich) tables.alignLeft = tables.alignCenter = tables.alignRight = false
    const caret: CaretState = this.literalSurface
      ? { marks: [], block: { type: 'paragraph' }, quoted: false }
      : caretState(state)
    if (rich) caret.align = caretAlignment(state)
    return {
      ...this.session.version(),
      format: this.document.format,
      mode: this.editingMode,
      editable: this.writable,
      composing: this.composing,
      pending: this.pasteController.pending,
      caret,
      table: this.literalSurface ? undefined : tableContext(state),
      commands: {
        undo: mutable && this.history.canUndo(state),
        redo: mutable && this.history.canRedo(state),
        insertText: mutable,
        paste: mutable,
        replace: mutable,
        replaceSource: mutable && !rich,
        insertImages: formatted && !rich && this.canInsertImages,
        appendImages: formatted && !rich && this.canInsertImages,
        insertPaths: mutable,
        insertFootnote: formatted && !rich,
        editReferenceDefinition:
          formatted && !rich && referenceDefinitions(state.doc).size > 0,
        format,
        table: tables,
        moveBlockUp: formatted && canMoveBlock(state, 'up'),
        moveBlockDown: formatted && canMoveBlock(state, 'down'),
      },
    }
  }

  /** An image adapter shows and exports an inserted reference, and so does a file adapter. An RTF
   *  document holds no images. */
  private get canInsertImages(): boolean {
    return (
      (!!this.options.images || !!this.options.files) &&
      !this.document.handler.richText
    )
  }

  private historyInputPlugin = createHistoryInputPlugin({
    writable: () => this.writable,
    available: (name) => this.ready && this.commandState().commands[name],
    run: (name) => {
      this.forPerson(() => this[name](), true)
    },
  })

  private policyPlugin = createInputPolicyPlugin({
    loading: () => this.loading,
    writable: () => this.writable,
    syncing: () => this.history.syncing,
    literal: () => this.literalSurface,
    publish: () => this.publishCommandState(),
  })

  private get literalSurface(): boolean {
    return this.document.handler.literalOnly || this.mode === 'source'
  }

  /** `formatted` or `source`. A TXT document is always `source`. */
  get editingMode(): EditingMode {
    this.assertAlive()
    return this.literalSurface ? 'source' : 'formatted'
  }

  /** Switches between formatted and source editing. Returns false when the mode is already set, and
   *  for TXT. */
  setEditingMode(mode: EditingMode, expectedGeneration?: number): boolean {
    this.assertAlive()
    expectOneOf(mode, editingModes, 'mode')
    this.assertCurrent(expectedGeneration)
    if (!this.document.handler.sourceMode || this.mode === mode) return false
    return this.source.setMode(mode, {
      ctx: this.editor.ctx,
      wasSource: this.literalSurface,
      container: this.geometry.container,
      settle: () => {
        this.history.settleSource()
        // Source steps that were undone cannot be redone from the other mode.
        this.history.modeChanged()
      },
      text: () => this.savedText().text,
      changed: () => {
        this.mode = mode
        this.session.modeChanged()
        this.output.cancel()
        this.search.reset()
      },
      update: () => {
        const suppressed = this.reportingSuppressed
        this.reportingSuppressed = true
        try {
          this.updateSurface()
        } finally {
          this.reportingSuppressed = suppressed
        }
      },
      reveal: () => this.revealCurrentSelection(),
    })
  }

  private updateSurface(): void {
    this.source.element.hidden = !this.literalSurface
    this.applyInputPolicy()
    const label = this.document.handler.literalLabel
    this.source.element.setAttribute(
      'aria-label',
      this.options.labels?.[label] ?? defaultLabels[label],
    )
    this.editor.ctx.get(editorViewCtx).dom.parentElement!.hidden =
      this.literalSurface
    this.mediaPolicy()
  }

  /** Replaces the complete source as one undo step. Returns false for identical source. */
  replaceSource(text: string, expectedGeneration?: number): boolean {
    this.assertAlive()
    expectString(text, 'text')
    this.assertMutation(expectedGeneration)
    if (this.document.handler.richText)
      throw invalidArgument('An RTF document has no source to replace')
    const changed = this.history.applySource(text, true)
    if (changed) this.clipboard.clear()
    return changed
  }

  /** Returns whether a history step applied. */
  undo(expectedGeneration?: number): boolean {
    this.assertMutation(expectedGeneration)
    return this.history.undo()
  }

  /** Returns whether a history step applied. */
  redo(expectedGeneration?: number): boolean {
    this.assertMutation(expectedGeneration)
    return this.history.redo()
  }

  /** The complete current document, which is what a host saves. It throws rather than return a
   *  partial document. */
  snapshot(expectedGeneration?: number): DocumentSnapshot<F> {
    return publicSnapshot(
      this.savedText(expectedGeneration),
    ) as DocumentSnapshot<F>
  }

  /**
   * The loaded document converted to `format`, which must be offered, with what the conversion
   * lost. It changes nothing: load the result as a new generation. Markdown converts to RTF and
   * RTF to Markdown; the same format returns a copy. Throws `invalid-argument` for any other pair.
   */
  convertDocument(
    format: DocumentFormat,
    expectedGeneration?: number,
  ): ConvertedDocument {
    this.assertAlive()
    expectOneOf(format, this.offered, 'format')
    const saved = this.savedText(expectedGeneration)
    const from = saved.format
    if (from === format)
      return from === 'rtf'
        ? {
            format: 'rtf',
            document: richTextFromText(saved.text),
            lost: Object.freeze([]),
          }
        : { format: from, text: saved.text, lost: Object.freeze([]) }
    if (from === 'md' && format === 'rtf') {
      const { document, lost } = markdownToRichText(
        this.document.exportDocument(saved.text),
      )
      return { format, document, lost }
    }
    if (from === 'rtf' && format === 'md') {
      const { text, lost } = richTextToMarkdown(
        this.editor.ctx,
        richTextFromText(saved.text),
      )
      return { format, text, lost }
    }
    throw invalidArgument(
      `Inkkit does not convert ${from} to ${format}; ${from === 'txt' || format === 'txt' ? 'the host converts plain text' : 'convert through another format'}`,
    )
  }

  /** The whole document as standalone HTML for printing. Rejects rather than return partial
   *  output. */
  async printableSnapshot(
    expectedGeneration?: number,
  ): Promise<PrintableDocument> {
    const snapshot = this.savedText(expectedGeneration)
    const captured = this.session.capture()
    return this.output.printable(snapshot, captured)
  }

  /** Prepares the document or the selection for the native clipboard. Rejects with `stale-document`
   *  if the document changes first. */
  async clipboardSnapshot(
    scope?: ClipboardScope,
    expectedGeneration?: number,
  ): Promise<ClipboardOutput> {
    this.assertAlive()
    const all =
      (isOmitted(scope)
        ? 'document'
        : expectOneOf(scope, clipboardScopes, 'scope')) === 'document'
    const snapshot = this.savedText(expectedGeneration)
    const captured = this.session.capture()
    return this.output.clipboard(snapshot, captured, all)
  }

  /** Cancels the pending image paste without changing the document or editability. */
  cancelPendingImports(expectedGeneration?: number): void {
    this.assertReady(expectedGeneration)
    this.pasteController.cancelPending()
  }

  /** Pastes content the host read from the native clipboard. Capture it once; don't read the
   *  clipboard again while this runs. */
  async paste(
    input: ClipboardInput,
    expectedGeneration?: number,
  ): Promise<void> {
    this.assertAlive()
    input = this.clipboard.restore(clipboardInput(input))
    this.assertMutation(expectedGeneration)
    if (this.literalSurface) {
      this.pasteAsPlainText(this.document.handler.literalPaste(input))
      return
    }
    await this.pasteController.paste(input)
  }

  /** Shows or hides author comments. Presentation only: the revision, history and dirty state don't
   *  change. */
  setCommentsVisible(visible: boolean): void {
    this.assertAlive()
    expectBoolean(visible, 'visible')
    setCommentVisibility(this.editor.ctx.get(editorViewCtx), visible)
  }

  /** Inserts `text` literally at the selection and returns whether the document changed. */
  pasteAsPlainText(text: string, expectedGeneration?: number): boolean {
    this.assertAlive()
    expectString(text, 'text')
    this.assertMutation(expectedGeneration)
    const before = this.session.capture()
    const doc = this.editor.ctx.get(editorViewCtx).state.doc
    this.insertPlainText(text)
    // An RTF paste that changes nothing was refused; it never fails silently.
    if (text && this.refusedRichEdit(doc))
      throw new InkKitError(
        'preservation',
        'The text was not pasted because the RTF document cannot hold it there',
      )
    return !before.isCurrent()
  }

  /** Whether an RTF edit that should have changed `before` was refused. */
  private refusedRichEdit(before: ProseNode): boolean {
    return (
      this.document.handler.richText != null &&
      !this.literalSurface &&
      this.editor.ctx.get(editorViewCtx).state.doc === before
    )
  }

  private insertPlainText(text: string): void {
    if (this.literalSurface)
      this.source.replaceLiteralSelection(
        text,
        true,
        this.document.handler.keepsInsertedLineEndings,
      )
    else if (this.document.handler.richText) {
      const view = this.editor.ctx.get(editorViewCtx)
      const slice = this.document.handler.richText.paste(
        { text },
        view.state,
        this.linkSchemes,
      )
      const lines = /[\r\n\u000c\u0085\u2028\u2029\u000b]/.test(text)
      const tr = view.state.tr.replaceSelection(slice).scrollIntoView()
      view.dispatch(lines ? closeHistory(tr) : tr)
      if (lines)
        view.dispatch(
          closeHistory(view.state.tr).setMeta('addToHistory', false),
        )
    } else insertPlainText(this.editor.ctx.get(editorViewCtx), text)
  }

  /** Runs a table command and returns whether it applied. False in source and TXT modes, outside a
   *  table for commands that need one, and at a boundary a move can't cross. */
  table(
    command: TableCommand,
    options?: TableOptions,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    options = tableOptions(command, options)
    this.assertMutation(expectedGeneration)
    if (this.literalSurface) return false
    return tableCommand(this.editor.ctx, command, options)
  }

  /** Moves the blocks at the selection one place up or down in their list, quote, callout, footnote
   *  or note, as one undo step. Returns whether they moved: false in source and TXT modes, in a
   *  table, and when they are already first or last. */
  moveBlock(
    direction: BlockMoveDirection,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    expectOneOf(direction, ['up', 'down'], 'direction')
    this.assertMutation(expectedGeneration)
    if (this.literalSurface) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const tr = moveBlockTransaction(view.state, direction)
    if (!tr) return false
    view.dispatch(closeHistory(tr))
    view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
    return true
  }

  /** Cancels pending work and releases the editor. It never rejects. Afterwards every other member
   *  throws `destroyed`. */
  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.diagnostics.destroy(this.editor.ctx)
    this.destroyed = true
    this.clipboard.clear()
    this.ready = false
    this.session.close()
    this.history.reset()
    this.output.cancel()
    this.mediaPolicy()
    this.pasteController.destroy()
    this.activation.destroy()
    this.clipboard.destroy()
    this.source.destroy()
    this.diagrams.destroy()
    await this.editor.destroy()
    if (this.ownsRootClass) this.root.classList.remove('inkkit-root')
  }

  private keymapPlugin = createKeymapPlugin({
    writable: () => this.writable,
    reading: (view, event) => this.readingKeys(view, event),
    keys: (view, event) => this.keys(view, event),
    footnote: (target) =>
      this.forPerson(() => this.navigateFootnote(target), true),
  })

  private indentPlugin = createIndentPlugin((view, event) =>
    this.indentKeys(view, event),
  )

  private dispatchTransaction(view: EditorView, tr: Transaction): void {
    // A call whose edit was refused changes nothing more; it throws when it returns.
    if (this.call?.refusal && tr.docChanged) return
    this.document.carry(tr.getMeta(carriedBlocks) ?? [])
    this.suggestions?.beforeTransaction(tr)
    const base = this.suggestionBase ?? view.state
    const applied = base.applyTransaction(tr)
    let next = applied.state
    if (!this.loading) {
      const check = (doc: ProseNode) => {
        if (!this.literalSurface) assertHiddenCommentsKept(base, tr, doc)
        this.document.assertPreserved(view.state.doc, doc, isWrittenEdit(tr))
      }
      try {
        try {
          check(next.doc)
        } catch (error) {
          // Reading a literal block again never adds a refusal: the
          // edit is then made as it would be without that.
          if (
            !applied.transactions.some((step) => step.getMeta(literalRereadKey))
          )
            throw error
          next = base.apply(tr.setMeta(literalRereadKey, 'skip'))
          check(next.doc)
        }
      } catch (error) {
        view.updateState(view.state)
        this.refuse(
          new InkKitError(
            'preservation',
            this.document.handler.richText
              ? `The edit was not applied because the document could not be saved as RTF: ${error instanceof Error ? error.message : String(error)}`
              : `The edit was not applied because its Markdown could not be preserved: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        )
        return
      }
    }
    this.history.didApply(view.state, next)
    view.updateState(next)
  }

  /** Builds the editor in `root`. It has no document until `loadDocument`. Rejects with
   *  `invalid-argument` for a bad root, handler or option. The editor's type follows `formats`:
   *  without `rtf` among them, its documents are text. */
  static async mount<F extends DocumentFormat>(
    root: HTMLElement,
    events: EditorEvents<F>,
    options: EditorOptions<F> & { formats: readonly F[] },
  ): Promise<InkKitEditor<F>>
  static async mount(
    root: HTMLElement,
    events: EditorEvents,
    options?: EditorOptions,
  ): Promise<InkKitEditor>
  static async mount<F extends DocumentFormat>(
    root: HTMLElement,
    events: EditorEvents<F>,
    options?: EditorOptions<F>,
  ): Promise<InkKitEditor<F>> {
    if (!(root instanceof HTMLElement))
      throw invalidArgument('root must be an HTML element')
    events = hostEvents(events) as unknown as EditorEvents<F>
    options = editorOptions(options) as unknown as EditorOptions<F>
    const instance = new InkKitEditor<F>(events, options)
    events = instance.events
    instance.root = root
    instance.ownsRootClass = !root.classList.contains('inkkit-root')
    root.classList.add('inkkit-root')
    instance.pasteController = new PasteController({
      restoreCopy: (input) => instance.clipboard.restore(input),
      ctx: () => instance.editor.ctx,
      context: () => instance.context(),
      adapter: options.images,
      onError: (error) => instance.report(error),
      commit: (apply) => instance.facadeCall(apply),
      literalText: () => instance.literalSurface,
      editable: () => instance.writable && !instance.literalSurface,
      onPendingChanged: () => instance.publishCommandState(),
      richText: () => instance.document.handler.richText,
      linkSchemes: instance.linkSchemes,
    })
    instance.suggestions = createEditorSuggestions({
      root,
      labels: () => ({ ...defaultLabels, ...options.labels }),
      slashMenu: () => options.slashMenu,
      wikiLinks: () => options.wikiLinks,
      diagrams: () =>
        options.rendering?.diagramPreview !== false && diagramsAvailable(),
      active: () =>
        instance.ready &&
        !instance.destroyed &&
        !instance.loading &&
        !instance.literalSurface &&
        instance.writable &&
        !instance.composing &&
        !instance.pasteController.pending,
      context: () => instance.context(),
      chooseSlash: (session, command, kind) =>
        instance.chooseSlash(session, command, kind),
      chooseWiki: (session, name) => instance.chooseWiki(session, name),
      report: (error) => instance.report(error),
    })
    instance.editor = await createMilkdownEditor(
      root,
      options as EditorOptions,
      {
        diagrams: instance.diagrams,
        plugins: {
          indent: instance.indentPlugin,
          paste: instance.pasteController.plugin,
          suggestions: $prose(() => instance.suggestions!.plugin()),
          keymap: instance.keymapPlugin,
          change: instance.changePlugin,
          historyInput: instance.historyInputPlugin,
          policy: instance.policyPlugin,
        },
        format: {
          markdownInput: () => instance.document.handler.markdownInput,
          richText: () => instance.document.handler.richText,
        },
        authoredSources: (doc, positions) =>
          instance.document.authoredSources(doc, positions),
        smartPunctuation: () =>
          instance.inputPreferences.smartPunctuation === true,
        linkSchemes: instance.linkSchemes,
        mutate: (operation) =>
          instance.forPerson(
            () =>
              instance.facadeCall(() => {
                instance.assertMutation()
                return !instance.literalSurface && operation()
              }),
            false,
          ),
        dispatchTransaction: (view, tr) =>
          instance.dispatchTransaction(view, tr),
        revealSelection: () => {
          if (!instance.loading && instance.ready)
            instance.revealCurrentSelection()
        },
        visibleRect: () => instance.viewport().rect,
        capture: () => instance.adapterCapture(),
        active: () =>
          instance.ready && !instance.destroyed && !instance.literalSurface,
        canMutate: () => {
          try {
            instance.assertMutation()
            return true
          } catch {
            return false
          }
        },
        report: (error) => instance.report(error),
        copy: events.copy ? (text) => events.copy?.(text) : undefined,
      },
    )
    configureTableMovement(instance.editor.ctx, () => {
      try {
        instance.assertCurrent()
        return instance.writable && !instance.literalSurface
      } catch {
        return false
      }
    })
    instance.source = new SourceSurface(root, {
      ready: () => instance.ready,
      literal: () => instance.literalSurface,
      writable: () => instance.writable,
      currentText: () => instance.document.currentText(),
      applySource: (text, isolated, from, to, native) =>
        instance.history.applySource(text, isolated, from, to, native),
      keyDown: (event) =>
        instance.literalKeys(instance.editor.ctx.get(editorViewCtx), event),
      publish: () => instance.publishCommandState(),
      paste: (input) => instance.paste(input),
      report: (error) => instance.report(error),
      reveal: () => instance.revealLiteralSelection(),
    })
    instance.activation = new EditorActivation(root, {
      view: () => instance.editor.ctx.get(editorViewCtx),
      footnote: () => {
        instance.navigateFootnote('definition')
      },
      openLink: (href) => events.openLink?.(href),
      report: (error) => instance.report(error),
    })
    instance.clipboard.install(root)
    instance.applyInputPolicy()
    instance.setKeymap(options.keymap ?? {})
    instance.activation.trackModifier()
    return instance
  }

  /** Replaces the document. The generation must be greater than the loaded one. A failed load
   *  changes nothing. */
  loadDocument(document: DocumentInput<F>): void {
    this.assertAlive()
    const input = documentInput(document, this.offered)
    this.session.checkLoad(input.generation, 'input.generation')
    const handler = formatHandlers[input.format]
    // A literal-only format keeps its text on the literal surface, not in the formatted document.
    const markdown = handler.literalOnly ? '' : input.text
    // Parsed before anything changes, so Markdown that cannot be loaded changes nothing.
    let source: FormatSource
    try {
      source = handler.load(this.editor.ctx, markdown)
    } catch (error) {
      throw coded(
        error,
        'preservation',
        'The document was not loaded because its Markdown could not be shown without losing part of it',
      )
    }
    const container = this.geometry.container
    const top = container.scrollTop,
      left = container.scrollLeft
    this.releaseFocus()
    this.ready = false
    this.output.cancel()
    this.mediaPolicy()
    this.pasteController.cancelPending()
    // Views made while the new document loads capture its generation.
    this.diagrams.clear()
    this.session.load(input.documentId, input.generation)
    this.document.resetCaches()
    this.history.reset()
    this.mode = 'formatted'
    this.source.reset()
    this.search.reset()
    this.document.handler = handler
    // An RTF document has no source text to show.
    this.source.setSourceValue(handler.richText ? '' : input.text)
    this.source.element.setSelectionRange(
      this.source.element.value.length,
      this.source.element.value.length,
    )
    this.load(markdown, source)
    this.document.original = input.text
    this.lastMarkdown = input.text
    this.updateSurface()
    this.ready = true
    this.mediaPolicy()
    container.scrollTop = top
    container.scrollLeft = left
    this.publishCommandState()
  }

  /** Moves focus off whichever of InkKit's text surfaces holds it; other focus is left alone. */
  private releaseFocus(): void {
    releaseFocus(
      this.root,
      this.editor.ctx.get(editorViewCtx),
      this.source.element,
    )
  }

  /** Replaces the document with a newer version of it, keeping the selection, focus, scroll
   *  position and Markdown editing mode. With `expectedGeneration`, the loaded document must be
   *  that generation. */
  reloadDocument(
    document: DocumentInput<F>,
    expectedGeneration?: number,
  ): void {
    this.assertAlive()
    const input = documentInput(document, this.offered)
    if (!isOmitted(expectedGeneration)) this.assertReady(expectedGeneration)
    this.session.checkLoad(input.generation, 'input.generation')
    const view = this.editor.ctx.get(editorViewCtx)
    const wasLiteral = this.literalSurface
    const previousMode = this.editingMode
    const previous = this.document.handler
    const saved = captureReloadSurface(
      view,
      this.source.element,
      this.geometry.container,
      wasLiteral,
    )
    this.reportingSuppressed = true
    try {
      this.loadDocument(document)
      if (
        previous.sourceMode &&
        this.document.handler.sourceMode &&
        previousMode === 'source'
      )
        this.setEditingMode('source', input.generation)
      restoreReloadSurface(
        view,
        this.source.element,
        () => this.literalSurface,
        saved,
      )
    } finally {
      this.reportingSuppressed = false
      this.publishCommandState()
    }
  }

  /** Names the scroll container and the host chrome that overlaps the editor. It replaces earlier
   *  settings. */
  setViewport(options: ViewportOptions): void {
    this.assertAlive()
    const record = expectRecord(options, 'options', [
      'scrollContainer',
      'insets',
    ])
    const container = isOmitted(record.scrollContainer)
      ? this.root
      : record.scrollContainer
    if (
      !(container instanceof HTMLElement) ||
      (container !== this.root && !container.contains(this.root))
    )
      throw invalidArgument(
        'options.scrollContainer must be the editor root or an ancestor',
      )
    const sides = ['top', 'right', 'bottom', 'left'] as const
    const given = optionalRecord(record.insets, 'options.insets', sides) ?? {}
    const insets = Object.fromEntries(
      sides.map((side) => [
        side,
        isOmitted(given[side])
          ? 0
          : expectNumber(given[side], `options.insets.${side}`, { min: 0 }),
      ]),
    ) as unknown as ViewportInsets
    this.geometry.configure(container, insets)
  }

  /** The visible rectangle, the insets and the scroll offsets. */
  viewport(): ViewportSnapshot {
    this.assertAlive()
    return this.geometry.snapshot()
  }

  /** The readable text and selection. Ranges from it go stale when the document, its revision or
   *  the mode changes. */
  textSnapshot(expectedGeneration?: number): ReadableTextSnapshot {
    this.assertCurrent(expectedGeneration)
    return this.text.snapshot()
  }

  private validateTextRange(range: TextRange): TextProjection {
    this.assertAlive()
    textRange(range, 'range')
    this.assertCurrent()
    return this.text.validate(range)
  }

  selectTextRange(
    range: TextRange,
    options?: { focus?: boolean; reveal?: boolean },
  ): void {
    this.assertAlive()
    const choices = optionalRecord(options, 'options', ['focus', 'reveal'])
    const focus = optionalBoolean(choices?.focus, 'options.focus')
    const reveal = optionalBoolean(choices?.reveal, 'options.reveal')
    const projection = this.validateTextRange(range)
    this.text.select(range, projection)
    if (focus) {
      if (this.literalSurface)
        this.source.element.focus({ preventScroll: true })
      else this.editor.ctx.get(editorViewCtx).focus()
    }
    if (reveal) this.revealTextRange(range)
    this.publishCommandState()
  }

  /** Replaces `range` with literal text as one undo step. Returns whether the text changed. */
  replaceTextRange(range: TextRange, text: string): boolean {
    this.assertAlive()
    expectString(text, 'text')
    const projection = this.validateTextRange(range)
    this.assertMutation()
    return this.search.replaceRange(range, text, projection)
  }

  /** Measures ranges in client coordinates, with one array of rectangles for each. It measures only
   *  when called. */
  textRangesRects(
    ranges: readonly TextRange[],
  ): readonly (readonly TextRect[])[] {
    this.assertAlive()
    expectArray(ranges, 'ranges').forEach((range, index) =>
      textRange(range, `ranges[${index}]`),
    )
    this.assertCurrent()
    const projections = ranges.map((range) => this.validateTextRange(range))
    return this.geometry.rangesRects(ranges, projections)
  }

  /** The ranges of the snapshot that are inside the viewport now. */
  visibleTextRanges(snapshotId: string): readonly TextRange[] {
    this.assertAlive()
    expectString(snapshotId, 'snapshotId')
    const snapshot = this.textSnapshot()
    this.validateTextRange({ snapshotId, from: 0, to: 0 })
    return this.geometry.visibleRanges(
      snapshotId,
      snapshot,
      this.text.scope().projection,
    )
  }

  /** Scrolls `range` into the viewport, unfolding a callout that holds it. */
  revealTextRange(range: TextRange): void {
    const projection = this.validateTextRange(range)
    if (!this.literalSurface) this.geometry.revealCallouts(range, projection)
    this.geometry.revealRects(this.textRangesRects([range])[0]!)
  }

  private revealCurrentSelection(): void {
    if (this.loading || !this.ready) return
    if (this.literalSurface) {
      this.revealLiteralSelection()
      return
    }
    const { range, projection } = this.text.selection()
    if (this.composing || this.pasteController.pending) {
      this.geometry.revealFormattedSelection(range, projection)
      return
    }
    this.revealTextRange(range)
  }

  private revealLiteralSelection(): void {
    this.geometry.revealLiteralSelection()
  }

  private load(markdown: string, source: FormatSource): void {
    this.clipboard.clear()
    this.document.original = markdown
    const { ctx } = this.editor
    const view = ctx.get(editorViewCtx)
    this.loading = true
    try {
      view.updateState(createDocumentState(ctx, source.baseline))
    } finally {
      this.loading = false
    }
    this.document.loaded(source)
    this.lastMarkdown = markdown
    view.dispatch(initialDocumentSelection(view.state))
  }

  /** Returns every non-overlapping match without changing selection, focus or highlights. */
  searchMatches(
    text: string,
    expectedGeneration?: number,
  ): readonly TextRange[] {
    this.assertAlive()
    expectString(text, 'text')
    this.assertCurrent(expectedGeneration)
    const scope = this.text.scope()
    return this.search.matches(text, scope.id, scope.projection)
  }

  /** Selects the next match and returns whether there was one. */
  find(text: string, expectedGeneration?: number): boolean {
    this.assertAlive()
    expectString(text, 'text')
    this.assertCurrent(expectedGeneration)
    return this.search.find(text)
  }

  /** Replaces the selected match, or the next one, and returns whether text changed. */
  replace(
    search: string,
    replacement: string,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    expectString(search, 'search')
    expectString(replacement, 'replacement')
    this.assertMutation(expectedGeneration)
    const doc = this.editor.ctx.get(editorViewCtx).state.doc
    const replaced = this.search.replace(search, replacement, false) > 0
    return replaced && (replacement === search || !this.refusedRichEdit(doc))
  }

  /** Replaces every non-overlapping match once and returns how many. */
  replaceAll(
    search: string,
    replacement: string,
    expectedGeneration?: number,
  ): number {
    this.assertAlive()
    expectString(search, 'search')
    expectString(replacement, 'replacement')
    this.assertMutation(expectedGeneration)
    const doc = this.editor.ctx.get(editorViewCtx).state.doc
    const count = this.search.replace(search, replacement, true)
    // A replacement an RTF document can't hold is refused, so nothing was replaced.
    return count && replacement !== search && this.refusedRichEdit(doc)
      ? 0
      : count
  }

  private outlineContext(): OutlineContext {
    const { documentId, generation, revision, key } = this.session.capture()
    return { documentId, generation, revision, key }
  }

  /** The outline in document order. Entries go stale when the document changes. */
  headings(expectedGeneration?: number): readonly Heading[] {
    this.assertCurrent(expectedGeneration)
    if (!this.document.handler.headings) return Object.freeze([])
    return this.mode === 'source'
      ? collectSourceHeadings(
          this.editor.ctx,
          this.source.element.value,
          this.outlineContext(),
        )
      : collectFormattedHeadings(
          this.editor.ctx.get(editorViewCtx).state.doc,
          this.outlineContext(),
        )
  }

  /** Moves to `heading`. Returns true, or throws `stale-document` for a stale entry. */
  navigateHeading(heading: Heading): boolean {
    this.assertAlive()
    headingEntry(heading)
    this.assertCurrent(heading.generation)
    if (!this.document.handler.headings)
      throw new InkKitError(
        'stale-document',
        'The heading is no longer current',
      )
    if (this.mode === 'source') {
      const position = sourceHeadingPosition(
        this.editor.ctx,
        this.source.element.value,
        heading,
        this.outlineContext(),
      )
      this.source.element.setSelectionRange(position, position)
      this.source.element.focus({ preventScroll: true })
      this.revealLiteralSelection()
      return true
    }
    return navigateFormattedHeading(
      this.editor.ctx.get(editorViewCtx),
      heading,
      this.outlineContext(),
    )
  }

  /** Buffered native typing: input rules apply as if its last character were typed after the rest. */
  insertText(text: string, generation: number): boolean {
    this.assertAlive()
    expectString(text, 'text')
    expectGeneration(generation)
    if (
      (this.literalSurface
        ? this.source.composing
        : this.editor.ctx.get(editorViewCtx).composing) &&
      generation === this.generation
    )
      return false
    this.assertMutation(generation)
    if (this.literalSurface) {
      this.source.replaceLiteralSelection(text, false)
      return true
    }
    const doc = this.editor.ctx.get(editorViewCtx).state.doc
    if (/[\r\n]/.test(text)) this.insertPlainText(text)
    else if (!insertNativeText(this.editor.ctx.get(editorViewCtx), text))
      return false
    // Text an RTF document can't hold, such as U+0000, is refused.
    return !(text && this.refusedRichEdit(doc))
  }

  /**
   * A key the host's native input received, run through InkKit's key handling. Returns whether
   * InkKit handled it; when it did, the host must not also handle it natively.
   */
  keyDown(input: KeyInput, expectedGeneration: number): boolean {
    this.assertAlive()
    const { key, code, metaKey, ctrlKey, altKey, shiftKey } = keyInput(input)
    const generation = expectGeneration(
      expectedGeneration,
      'expectedGeneration',
    )
    if (this.composing && generation === this.generation) return false
    this.assertCurrent(generation)
    const event = new KeyboardEvent('keydown', {
      key,
      code,
      metaKey,
      ctrlKey,
      altKey,
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
    return routeNativeKey(event, {
      literal: () => this.literalSurface,
      writable: () => this.writable,
      view: () => this.editor.ctx.get(editorViewCtx),
      readOnly: (view, event) => this.readOnlyKeys(view, event),
      literalKeys: (view, event) => this.literalKeys(view, event),
      source: (event) => this.source.keyDown(event),
      footnote: (target) => this.navigateFootnote(target),
      refuseMutation: () => this.assertMutation(generation),
    })
  }

  focus(expectedGeneration?: number): void {
    this.assertReady(expectedGeneration)
    if (this.literalSurface) this.source.element.focus()
    else {
      const view = this.editor.ctx.get(editorViewCtx)
      // ProseMirror focuses its DOM only while editable.
      if (!this.writable) view.dom.focus({ preventScroll: true })
      view.focus()
    }
  }

  /** Moves focus off InkKit's text surfaces. Focus anywhere else, such as in a host control or a
   *  control InkKit draws, is left alone. */
  blur(expectedGeneration?: number): void {
    this.assertReady(expectedGeneration)
    this.releaseFocus()
  }

  /**
   * Resolves wiki links and file embeds again, all of them or those whose `target` is named, after
   * something they point to changed. A file keeps its card until the new answer differs. Changes no
   * document state, so it works in a read-only editor and during composition. Source and TXT modes
   * draw no references; named file answers are invalidated and resolved when formatted mode returns.
   */
  refreshReferences(
    targets?: readonly string[],
    expectedGeneration?: number,
  ): void {
    this.assertAlive()
    const names = isOmitted(targets)
      ? undefined
      : new Set(
          expectArray(targets, 'targets').map((target) =>
            expectString(target, 'targets entry'),
          ),
        )
    this.assertReady(expectedGeneration)
    requestRefresh(this.editor.ctx.get(editorViewCtx).dom, {
      ...(names && { targets: names }),
    })
  }

  private openSelectedLink(state: EditorState): boolean {
    if (!this.ready || this.composing || this.literalSurface) return false
    return openSelectedLink(state, {
      wikiLinks: this.options.wikiLinks,
      capture: () => this.adapterCapture(),
      linkSchemes: this.linkSchemes,
      openLink: (href) => this.events.openLink?.(href),
      report: (error) => this.report(error),
    })
  }

  /** Replaces every binding. Keys are in ProseMirror's notation. A key given to two shortcuts goes
   *  to the later one, in the order history, link opening, formatting, block moves, tables, so it lands the same
   *  way every time. A table binding passes a key it shares with a block move to the move outside
   *  a table. List indentation keys apply after all of these, and after the table keys the editor
   *  keeps for itself. */
  setKeymap(keymap: Keymap): void {
    this.assertAlive()
    keymap = keymapBindings(keymap, 'keymap')
    const bindings = createEditorKeymap(keymap, formatShortcuts, {
      ready: () => this.ready,
      writable: () => this.writable,
      literalSurface: () => this.literalSurface,
      composing: () => this.composing,
      pending: () => this.pasteController.pending,
      commandState: () => this.commandState(),
      run: (operation, fallback) => this.forPerson(operation, fallback),
      undo: () => this.undo(),
      redo: () => this.redo(),
      openLink: (state) => this.openSelectedLink(state),
      format: (command) => this.format(command),
      moveBlock: (direction) => this.moveBlock(direction),
      table: (command) => this.table(command),
    })
    this.readOnlyKeys = bindings.readOnlyKeys
    this.keys = bindings.keys
    this.readingKeys = bindings.readingKeys
    this.indentKeys = bindings.indentKeys
    this.literalKeys = bindings.literalKeys
  }

  /** Dropped files land as one paragraph per path at the drop point: in place of an empty block, after
   *  the top-level block otherwise, so a list or quote is not opened up by them. */
  insertPaths(
    paths: string[],
    at: ClientPoint,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    expectArray(paths, 'paths').forEach((path, index) =>
      expectString(path, `paths[${index}]`),
    )
    const point = clientPoint(at, 'at')
    this.assertMutation(expectedGeneration)
    if (paths.length === 0) return false
    if (this.literalSurface) {
      this.pasteAsPlainText(paths.join('\n\n'))
      return true
    }
    insertPaths(this.editor.ctx.get(editorViewCtx), paths, point)
    this.focus()
    return true
  }

  /** Inserts images by reference, at the selection or the drop point `at`. Returns false when it
   *  does nothing. */
  insertImages(
    images: ImageInsertion[],
    at?: ClientPoint,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    images = imageInsertions(images)
    const point = isOmitted(at) ? undefined : clientPoint(at, 'at')
    this.assertMutation(expectedGeneration)
    if (!images.length || !this.canInsertImages || this.literalSurface)
      return false
    return insertImages(this.editor.ctx.get(editorViewCtx), images, point, () =>
      this.focus(),
    )
  }

  /** Adds images as the last blocks of the document and leaves everything else as it is: no focus,
   *  no scrolling, and the selection stays on the text it covered. For a host that attaches images
   *  to a document the person is not editing at that moment. Returns false when it does nothing. */
  appendImages(images: ImageInsertion[], expectedGeneration?: number): boolean {
    this.assertAlive()
    images = imageInsertions(images)
    this.assertMutation(expectedGeneration)
    if (!images.length || !this.canInsertImages || this.literalSurface)
      return false
    return appendImages(this.editor.ctx.get(editorViewCtx), images, () =>
      this.document.currentText(),
    )
  }

  private chooseWiki(session: SuggestionSession, name: string): void {
    this.suggestions?.close()
    this.forPerson(
      () =>
        this.facadeCall(() => {
          this.assertMutation()
          const view = this.editor.ctx.get(editorViewCtx)
          if (this.literalSurface || !session.valid?.(view))
            throw new InkKitError(
              'stale-document',
              'The suggestion belongs to an earlier edit',
            )
          insertWikiSuggestion(view, session, name)
          return true
        }),
      false,
    )
  }

  private chooseSlash(
    session: SuggestionSession,
    command: SlashCommandName | SlashCommand,
    kind?: string,
  ): void {
    const capture = this.session.capture()
    const chosenState = this.editor.ctx.get(editorViewCtx).state
    this.suggestions?.close()
    const commit = (value: SlashCommandName | { markdown: string }) =>
      this.forPerson(
        () =>
          this.facadeCall(() => {
            if (
              !capture.isCurrent({ editability: true }) ||
              this.editor.ctx.get(editorViewCtx).state !== chosenState
            )
              throw new InkKitError(
                'stale-document',
                'The suggestion belongs to an earlier edit',
              )
            this.assertMutation(capture.generation)
            if (this.literalSurface) return false
            insertSlashSuggestion(
              this.editor.ctx,
              session.base,
              value,
              kind,
              (operation) => {
                this.suggestionBase = session.base
                try {
                  operation()
                } finally {
                  this.suggestionBase = undefined
                }
              },
            )
            return true
          }),
        false,
      )
    if (typeof command === 'string') {
      commit(command)
      return
    }
    runSlashAction(command, {
      context: () => this.context(),
      destroyed: () => this.destroyed,
      commit: (markdown) => {
        commit({ markdown })
      },
      report: (error) => this.report(error),
    })
  }

  /** Returns whether the document or the marks the next typed text takes changed. */
  format(
    command: FormatCommand,
    options?: FormatOptions,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    const checked = formatOptions(command, options)
    // A rich text link's address loses the spaces at its ends, as a pasted link's does.
    if (checked?.destination !== undefined && this.document.handler.richText)
      checked.destination = checked.destination.trim()
    if (checked?.destination !== undefined)
      this.checkDestination(checked.destination, 'options.destination')
    this.assertMutation(expectedGeneration)
    if (this.literalSurface) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const before = view.state
    // Alignment, and anything an RTF document cannot hold, applies only where it is available.
    if (
      (this.document.handler.richText || command.startsWith('align')) &&
      !this.commandState().commands.format[command]
    )
      return false
    applyFormat(
      this.editor,
      command,
      checked,
      (destination) => this.link(destination),
      this.document.handler.richText != null,
    )
    this.focus()
    const after = view.state
    const marks = (state: EditorState) =>
      state.storedMarks ?? state.selection.$from.marks()
    return (
      !after.doc.eq(before.doc) ||
      !ProseMark.sameSet(marks(after), marks(before))
    )
  }

  /**
   * Refuses a link destination that is empty, that opens anything but a web, mail or phone address
   * or a scheme the host listed, or, in Markdown, that the writer cannot save so that it reads back
   * the same. In RTF, it also refuses what the rich text link rule refuses.
   */
  private checkDestination(destination: string, name: string): void {
    const rich = this.document.handler.richText != null
    checkDestination(
      this.editor.ctx,
      destination,
      name,
      this.linkSchemes,
      !rich,
    )
    const problem = rich ? linkProblem(destination) : undefined
    if (problem) throw invalidArgument(`${name}: ${problem}`)
  }

  /**
   * With a destination, sets the link: on the whole link that holds the caret or the selection,
   * keeping its title, or else on the selection. A reference link's shared definition is edited
   * instead. Without one, removes that whole link, or every link in the selection. Marks waiting
   * for the next typed text stay waiting.
   */
  private link(destination: string | undefined): void {
    setLink(this.editor.ctx, destination, (label, value) =>
      this.editReferenceDefinition(label, value),
    )
  }

  /** Changes the destination, and optionally the title, of the shared definition for `label`.
   *  Returns false when no definition has that label. */
  editReferenceDefinition(
    label: string,
    destination: string,
    title?: string,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    expectString(label, 'label')
    this.checkDestination(
      expectString(destination, 'destination'),
      'destination',
    )
    optionalString(title, 'title')
    this.assertMutation(expectedGeneration)
    if (this.literalSurface || this.document.handler.richText) return false
    return editReferenceDefinition(
      this.editor.ctx.get(editorViewCtx),
      label,
      destination,
      title,
    )
  }

  /** Inserts a footnote reference, and a definition when the label has none, and returns whether
   *  it did: formatted Markdown only. */
  insertFootnote(label?: string, expectedGeneration?: number): boolean {
    this.assertAlive()
    const given = optionalString(label, 'label')
    if (given !== undefined && !footnoteLabel(given))
      throw invalidArgument(
        'A footnote label must be 1 to 999 characters without whitespace, brackets or backslashes',
      )
    this.assertMutation(expectedGeneration)
    if (this.literalSurface || this.document.handler.richText) return false
    insertFootnote(
      this.editor.ctx.get(editorViewCtx),
      label,
      () => this.savedText().text,
    )
    this.focus()
    return true
  }

  /** Moves to the definition, or the first reference, of the footnote at the caret. Returns whether
   *  there was one. */
  navigateFootnote(
    target: 'definition' | 'reference',
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    expectOneOf(target, footnoteTargets, 'target')
    this.assertCurrent(expectedGeneration)
    if (this.literalSurface) return false
    if (!navigateFootnote(this.editor.ctx.get(editorViewCtx), target))
      return false
    this.focus()
    return true
  }

  // Every public method runs through `facadeCall`, so each failure reaches its caller once, as an
  // InkKitError. The type check below fails to compile when a public method is left out.
  static {
    const methods = [
      'loadDocument',
      'reloadDocument',
      'snapshot',
      'convertDocument',
      'printableSnapshot',
      'clipboardSnapshot',
      'paste',
      'cancelPendingImports',
      'pasteAsPlainText',
      'commandState',
      'setEditable',
      'setHostActive',
      'setTextInputPreferences',
      'setEditingMode',
      'replaceSource',
      'undo',
      'redo',
      'find',
      'searchMatches',
      'replace',
      'replaceAll',
      'format',
      'table',
      'moveBlock',
      'insertText',
      'keyDown',
      'insertPaths',
      'insertImages',
      'appendImages',
      'insertFootnote',
      'navigateFootnote',
      'editReferenceDefinition',
      'setCommentsVisible',
      'focus',
      'blur',
      'refreshReferences',
      'setKeymap',
      'textSnapshot',
      'selectTextRange',
      'revealTextRange',
      'replaceTextRange',
      'textRangesRects',
      'visibleTextRanges',
      'setViewport',
      'viewport',
      'headings',
      'navigateHeading',
      'destroy',
      'setDiagnosticsEnabled',
      'diagnosticReport',
    ] as const satisfies readonly PublicMethod[]
    const everyMethod: [
      Exclude<PublicMethod, (typeof methods)[number]>,
    ] extends [never]
      ? true
      : never = true
    void everyMethod
    for (const name of methods) {
      const method = InkKitEditor.prototype[name] as (
        this: InkKitEditor,
        ...args: unknown[]
      ) => unknown
      Object.defineProperty(InkKitEditor.prototype, name, {
        value(this: InkKitEditor, ...args: unknown[]) {
          if (name === 'setDiagnosticsEnabled' || name === 'diagnosticReport')
            return method.apply(this, args)
          if (!this.diagnostics.enabled)
            return this.facadeCall(() => method.apply(this, args))
          const operation = diagnosticOperation(name)
          this.diagnostics.capture({
            kind: 'operation',
            phase: 'begin',
            operation,
          })
          const success = (value: unknown) => {
            this.diagnostics.capture({
              kind: 'operation',
              phase: 'success',
              operation,
            })
            return value
          }
          const refused = (error: unknown): never => {
            const failure = coded(error)
            this.diagnostics.capture({
              kind: 'operation',
              phase: 'refused',
              operation,
              code: failure.code,
              ...(failure.code === 'preservation'
                ? { reason: diagnosticReason(failure) }
                : {}),
            })
            throw failure
          }
          try {
            const result = this.facadeCall(() => method.apply(this, args))
            return result instanceof Promise
              ? result.then(success, refused)
              : success(result)
          } catch (error) {
            return refused(error)
          }
        },
        writable: true,
        configurable: true,
      })
    }
    for (const name of ['editable', 'editingMode'] as const) {
      const getter = Object.getOwnPropertyDescriptor(
        InkKitEditor.prototype,
        name,
      )!.get!
      Object.defineProperty(InkKitEditor.prototype, name, {
        get(this: InkKitEditor) {
          return this.facadeCall(() => getter.call(this))
        },
        configurable: true,
      })
    }
    const mount = InkKitEditor.mount
    InkKitEditor.mount = (async (...args: Parameters<typeof mount>) => {
      try {
        return await mount(...args)
      } catch (error) {
        throw coded(error)
      }
    }) as typeof mount
  }
}

type PublicMethod = {
  [K in keyof InkKitEditor]: InkKitEditor[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never
}[keyof InkKitEditor]
