import { SourceSurface } from './editor-source'
import { EditorDocument } from './editor-document'
import { SourceHistory } from './editor-history'
import { $prose } from '@milkdown/kit/utils'
import { applyFormat, formatAvailability } from './editor-commands'
import { createEditorKeymap, tableShortcut } from './editor-keymap'
import { createMilkdownEditor } from './editor-milkdown'
import { markRun, caretState, terminalSelection } from './editor-selection'
import { literalTextNodes } from './literal-text'
import { wikiSession, wikiSuggestionTransaction } from './wiki-suggestions'
import type { SlashMenuOptions, SlashCommandName, SlashCommand } from './types'
import { Suggestions, type SuggestionSession } from './suggestions'
import { slashMenuOptions, slashSession, slashTransaction } from './slash-menu'
import { htmlBreakAt } from './hard-break'
import {
  type Editor,
  editorStateOptionsCtx,
  editorViewCtx,
  parserCtx,
  prosePluginsCtx,
  remarkCtx,
  schemaCtx,
} from '@milkdown/kit/core'
import { portableClipboard, clipboardText, clipboardContent } from './clipboard'
import { closeHistory } from '@milkdown/kit/prose/history'
import { replacementMarks } from './text-input'
import { blockDropRange } from './drop-placement'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import {
  Fragment,
  Mark as ProseMark,
  Slice,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import { goToNextCell } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { literalRereadKey } from './literal-edits'
import { defaultLabels } from './labels'
import { serialize } from './dialect'
import { extraLinkSchemes, isSafeLinkTarget } from './link-safety'
import { Preservation } from './preserve'
import {
  sourceAttribute,
  sourceSelection,
  rawOffset,
  normalizedOffset,
  type SourceProvenance,
} from './source'
import {
  normaliseLabel,
  referenceDefinitions,
  footnoteDefinitions,
  singleLine,
} from './references'
import {
  selectionMarkdown,
  selectionContent,
  referenceMetadata,
  withReferenceMetadata,
} from './reference-clipboard'
import { imagePlacement, isImage } from './image-blocks'
import { wikiReference } from './linked-syntax'
import { mediaPolicyEvent, requestRefresh, withFileSignal } from './files'
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
  type DocumentInput,
  type DocumentSnapshot,
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
} from './types'
import {
  readableProjection,
  projectionPosition,
  projectionOffset,
  validateOffsets,
  formattedRects,
  literalRangesRects,
  literalVisibleRanges,
  intersectsViewport,
  textRect,
  type TextProjection,
} from './text-ranges'
import { canMoveBlock, carriedBlocks, moveBlockTransaction } from './block-move'
import {
  commentSelectionContent,
  commentProvenance,
  literalCommentSpans,
  isComment,
  isWrittenEdit,
  setCommentVisibility,
} from './comments'
import {
  assertHiddenCommentsKept,
  hiddenCommentExit,
  insertAfterHiddenComment,
} from './hidden-comments'
import { scrollOutward, scrollWholePixels } from './scroll'
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
import { SearchQuery, setSearchState } from 'prosemirror-search'
import {
  findFormatted,
  findLiteral,
  replaceFormatted,
  replaceLiteral,
  replaceFormattedRange,
} from './search'
import {
  collectFormattedHeadings,
  collectSourceHeadings,
  navigateFormattedHeading,
  sourceHeadingPosition,
  type OutlineContext,
} from './outline'
import { toggleTask } from './tasks'
import { modHeld, trackLinkModifier } from './modifier'
import { diagramsAvailable, isMermaid } from './mermaid'
import {
  hasAuthoredImagesInLiterals,
  printableMarkdown,
  printableText,
} from './print'

/** An inline format that `CaretState` can report. */
export type Mark =
  'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code' | 'link'

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
  'code',
  'codeBlock',
  'quote',
  'bulletList',
  'orderedList',
  'taskList',
  'toggleTask',
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

/** Mount options. Adapters, `labels`, `linkSchemes` and `rendering` are fixed at mount; the rest can change. */
export interface EditorOptions {
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
  format: 'md' | 'txt'
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

/** The host's handlers, passed to `mount`. Only `changed` is required. */
export interface EditorEvents {
  /** The document's text changed. Not sent for a load, a reload or a refused edit. */
  changed(snapshot: DocumentSnapshot): void
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

/** Refuses a cut whose copy lost an image or a diagram, so the person keeps what the clipboard
 *  could not hold. */
function refuseUnportableCut(content: ClipboardOutput): void {
  if (content.images.some((image) => image.error))
    throw new InkKitError(
      'image-unavailable',
      'The selected content could not be cut, because an image in it cannot be copied',
    )
  if (content.diagrams.some((diagram) => diagram.error))
    throw new InkKitError(
      'diagram-unavailable',
      'The selected content could not be cut, because a diagram in it cannot be copied',
    )
}

async function writeClipboard(
  events: EditorEvents,
  content: ClipboardOutput,
): Promise<void> {
  try {
    await events.clipboard!(content)
  } catch (error) {
    throw coded(
      error,
      'clipboard-unavailable',
      'The host could not write the clipboard',
    )
  }
}

function noClipboardHandler(): InkKitError {
  return new InkKitError(
    'clipboard-unavailable',
    'Copying images or diagrams needs the clipboard event',
  )
}

const documentFormats = ['md', 'txt'] as const

function documentInput(value: unknown): DocumentInput {
  const input = expectRecord(value, 'input')
  return {
    documentId: expectString(input.documentId, 'input.documentId'),
    generation: expectGeneration(input.generation, 'input.generation'),
    format: expectOneOf(input.format, documentFormats, 'input.format'),
    text: expectString(input.text, 'input.text'),
  }
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

let editorSequence = 0

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
export class InkKitEditor {
  private editor!: Editor
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
      this.cancelExports()
      this.literalMatch = undefined
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
  private lastMarkdown = ''
  private readonly session = new DocumentSession()
  private exportControllers = new Set<AbortController>()
  private plainSearch = ''
  private literalMatch?: {
    query: string
    from: number
    to: number
    displayedFrom: number
    displayedTo: number
    version: SessionCapture
  }
  private mode: EditingMode = 'formatted'
  private ready = false
  private destroyed = false
  private pasteController!: PasteController
  private source!: SourceSurface
  private root!: HTMLElement
  private ownsRootClass = false
  private clickHandler?: (event: MouseEvent) => void
  private auxClickHandler?: (event: MouseEvent) => void
  private untrackLinkModifier?: () => void
  private footnoteKeyHandler?: (event: KeyboardEvent) => void
  private readonly localCopies = new Map<
    string,
    { text: string; html: string; markdown: string }
  >()

  private rememberCopy<T extends { text: string; html: string }>(
    output: T,
    markdown: string,
    content: Fragment,
    privateSource = false,
    actualCopy = false,
  ): T {
    let comments = privateSource
    content.descendants((node) => {
      const labelled = (label: unknown) =>
        typeof label === 'string' && literalCommentSpans(label).length > 0
      if (
        isComment(node) ||
        (/^(?:reference|footnote)_/.test(node.type.name) &&
          labelled(node.attrs.label)) ||
        node.marks.some(
          (mark) =>
            mark.type.name === 'link' &&
            (labelled(mark.attrs.label) ||
              commentProvenance(mark.attrs.referenceContent)),
        )
      )
        comments = true
    })
    if (!comments) {
      if (actualCopy) this.localCopies.clear()
      return output
    }
    const key = JSON.stringify([output.text, output.html, markdown])
    const previous = this.localCopies.get(key)
    if (previous) {
      output.html = previous.html
      if (actualCopy) this.localCopies.clear()
      this.localCopies.set(key, previous)
      return output
    }
    const wrapper = document.createElement('div')
    const token = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    wrapper.setAttribute('data-inkkit-local-copy', token)
    wrapper.innerHTML = output.html
    output.html = wrapper.outerHTML
    if (actualCopy) this.localCopies.clear()
    this.localCopies.set(key, {
      text: output.text,
      html: output.html,
      markdown,
    })
    return output
  }

  private retainCopy(html: string): void {
    for (const [key, copy] of this.localCopies)
      if (copy.html !== html) this.localCopies.delete(key)
  }

  private restoreCopy<
    T extends {
      text: string
      html?: string
      markdown?: string
      plainText?: boolean
    },
  >(input: T): T {
    const copy = [...this.localCopies.values()].find(
      (copy) => copy.text === input.text && copy.html === input.html,
    )
    return copy &&
      input.markdown == null &&
      !input.plainText &&
      copy.text === input.text &&
      copy.html === input.html
      ? { ...input, markdown: copy.markdown }
      : input
  }

  private copyHandler?: (event: ClipboardEvent) => void
  private reportingSuppressed = false
  private loading = false
  private readonly textIdentity = ++editorSequence
  private call?: FacadeCall
  private textScope?: { key: string; id: string; projection: TextProjection }
  private viewportContainer?: HTMLElement
  private viewportInsets: ViewportInsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }
  private writable = true
  private inputPreferences: TextInputPreferences = {}
  private literalKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private configuredKeys: Keymap = {}
  private indentKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private readOnlyKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private suggestions?: Suggestions
  private suggestionBase?: EditorState
  private changePlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('documentChanges'),
        view: () => ({
          update: (view, previous) => {
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
            this.cancelExports()
            this.mediaPolicy()
            this.literalMatch = undefined
            let markdown: string
            try {
              markdown = this.document.currentText(view.state.doc)
            } catch (error) {
              this.events.error?.(coded(error, 'preservation'))
              return
            }
            if (this.literalSurface) {
              const anchor = view.state.doc.attrs[
                sourceAttribute
              ] as SourceProvenance | null
              const from = anchor?.from ?? this.source.element.selectionStart
              const to = anchor?.to ?? this.source.element.selectionEnd
              if (!this.source.composing) this.source.setSourceValue(markdown)
              if (!this.source.composing) {
                this.source.element.setSelectionRange(
                  Math.min(from, this.source.element.value.length),
                  Math.min(to, this.source.element.value.length),
                )
                this.revealLiteralSelection()
              }
            }
            if (markdown === this.lastMarkdown) return
            this.lastMarkdown = markdown
            this.events.changed(this.changeSnapshot(markdown))
          },
        }),
      }),
  )
  private keys: (view: EditorView, event: KeyboardEvent) => boolean = () =>
    false
  private readingKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false

  private readonly events: EditorEvents
  /** The host's extra link schemes, in lower case. */
  private readonly linkSchemes: ReadonlySet<string>

  /** How many of each state event the host has been sent. */
  private readonly sentEvents = new Map<string | symbol, number>()

  private constructor(
    events: EditorEvents,
    private readonly options: EditorOptions,
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
  private changeSnapshot(text: string): DocumentSnapshot {
    return {
      ...this.session.version(),
      format: this.document.format,
      text,
      dirty: text !== this.document.original,
    }
  }

  private cancelExports(): void {
    for (const controller of this.exportControllers) controller.abort()
    this.exportControllers.clear()
  }

  /** Runs asynchronous output work for the document `captured` describes, and throws
   *  `stale-document` when the document, its revision or the editing mode changed meanwhile. */
  private async exportContent<T>(
    captured: SessionCapture,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    this.exportControllers.add(controller)
    try {
      return await withFileSignal(
        operation(controller.signal),
        controller.signal,
      )
    } finally {
      this.exportControllers.delete(controller)
      this.assertCaptured(captured, controller.signal.aborted)
    }
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
      literalMatch: this.literalMatch,
      textScope: this.textScope,
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
    this.literalMatch = before.literalMatch
    this.textScope = before.textScope
    this.history.restore(before.history)
  }

  /** Reports a refused edit to the facade call that made it, or else to `events.error`. */
  private refuse(error: InkKitError): void {
    if (this.call) this.call.refusal ??= error
    else this.events.error?.(error)
  }

  /** Reports a failure no call is waiting for. */
  private report(error: unknown): void {
    this.events.error?.(coded(error))
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
    const view = this.editor.ctx.get(editorViewCtx)
    const attributes =
      typeof view.props.attributes === 'function'
        ? view.props.attributes(view.state)
        : view.props.attributes
    const inputAttributes = { ...attributes }
    delete inputAttributes['aria-readonly']
    if (!this.writable) inputAttributes['aria-readonly'] = 'true'
    view.setProps({
      editable: () => this.writable && !this.literalSurface,
      attributes: {
        ...inputAttributes,
        role: 'textbox',
        tabindex: '0',
        'aria-multiline': 'true',
        'aria-label':
          this.options.labels?.formattedEditor ?? defaultLabels.formattedEditor,
      },
    })
    this.source.element.readOnly = !this.writable
    for (const surface of [view.dom, this.source.element]) {
      for (const name of [
        'spellcheck',
        'autocorrect',
        'autocapitalize',
      ] as const) {
        const value = this.inputPreferences[name]
        if (value == null) surface.removeAttribute(name)
        else
          surface.setAttribute(
            name,
            name === 'autocorrect' ? (value ? 'on' : 'off') : String(value),
          )
      }
    }
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
    const format = formatAvailability(this.editor, state, formatted)
    const tables = formatted
      ? tableAvailability(this.editor.ctx)
      : (Object.fromEntries(
          tableCommands.map((name) => [name, false]),
        ) as Record<TableCommand, boolean>)
    return {
      ...this.session.version(),
      format: this.document.format,
      mode: this.editingMode,
      editable: this.writable,
      composing: this.composing,
      pending: this.pasteController.pending,
      caret: this.literalSurface
        ? { marks: [], block: { type: 'paragraph' }, quoted: false }
        : caretState(state),
      table: this.literalSurface ? undefined : tableContext(state),
      commands: {
        undo: mutable && this.history.canUndo(state),
        redo: mutable && this.history.canRedo(state),
        insertText: mutable,
        paste: mutable,
        replace: mutable,
        replaceSource: mutable,
        insertImages: formatted && this.canInsertImages,
        appendImages: formatted && this.canInsertImages,
        insertPaths: mutable,
        insertFootnote: formatted,
        editReferenceDefinition:
          formatted && referenceDefinitions(state.doc).size > 0,
        format,
        table: tables,
        moveBlockUp: formatted && canMoveBlock(state, 'up'),
        moveBlockDown: formatted && canMoveBlock(state, 'down'),
      },
    }
  }

  /** An image adapter shows and exports an inserted reference, and so does a file adapter. */
  private get canInsertImages(): boolean {
    return !!this.options.images || !!this.options.files
  }

  // Edit > Undo and the touch gestures arrive as `beforeinput` events that
  // ProseMirror's history would handle on its own. This plugin comes before the
  // history plugin, so every Undo takes the one path through `undo` and `redo`,
  // with smart punctuation's step and the source-step bookkeeping.
  private historyInputPlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('inkkitHistoryInput'),
        props: {
          handleDOMEvents: {
            beforeinput: (_view, event) => {
              if (!this.writable) return false
              const name =
                event.inputType === 'historyUndo'
                  ? 'undo'
                  : event.inputType === 'historyRedo'
                    ? 'redo'
                    : undefined
              if (!name) return false
              event.preventDefault()
              if (this.ready && this.commandState().commands[name])
                this.forPerson(() => this[name](), true)
              return true
            },
          },
        },
      }),
  )

  private policyPlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('inkkitInputPolicy'),
        filterTransaction: (tr) =>
          this.loading ||
          this.writable ||
          // Source that was typed while the editor was writable.
          this.history.syncing ||
          (!tr.docChanged && !tr.storedMarksSet),
        props: {
          editable: () => this.writable && !this.literalSurface,
          // ProseMirror selects the clicked node when Mod is held; a click
          // that opens a link must not.
          handleClick: (_view, _pos, event) =>
            modHeld(event) &&
            !!(event.target as HTMLElement).closest(
              'a[href], .inkkit-wiki-link',
            ),
          handleDOMEvents: {
            compositionstart: () => {
              queueMicrotask(() => this.publishCommandState())
              return false
            },
            compositionend: () => {
              queueMicrotask(() => this.publishCommandState())
              return false
            },
            beforeinput: (_view, event) => {
              if (this.writable) return false
              event.preventDefault()
              return true
            },
            drop: (_view, event) => {
              if (this.writable) return false
              event.preventDefault()
              return true
            },
          },
        },
        view: () => ({ update: () => this.publishCommandState() }),
      }),
  )

  private get literalSurface(): boolean {
    return this.document.format === 'txt' || this.mode === 'source'
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
    if (this.document.format === 'txt' || this.mode === mode) return false
    return this.source.setMode(mode, {
      ctx: this.editor.ctx,
      wasSource: this.literalSurface,
      container: this.viewportContainer ?? this.root,
      settle: () => {
        this.history.settleSource()
        // Source steps that were undone cannot be redone from the other mode.
        this.history.modeChanged()
      },
      text: () => this.snapshot().text,
      changed: () => {
        this.mode = mode
        this.session.modeChanged()
        this.cancelExports()
        this.plainSearch = ''
        this.literalMatch = undefined
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
    this.source.element.setAttribute(
      'aria-label',
      this.document.format === 'txt'
        ? (this.options.labels?.plainTextEditor ??
            defaultLabels.plainTextEditor)
        : (this.options.labels?.sourceEditor ?? defaultLabels.sourceEditor),
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
    const changed = this.history.applySource(text, true)
    if (changed) this.localCopies.clear()
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

  /** The complete current text, which is what a host saves. It throws rather than return partial
   *  text. */
  snapshot(expectedGeneration?: number): DocumentSnapshot {
    this.assertCurrent(expectedGeneration)
    const text = this.document.currentText()
    return {
      ...this.session.version(),
      format: this.document.format,
      text,
      dirty: text !== this.document.original,
    }
  }

  /** The whole document as standalone HTML for printing. Rejects rather than return partial
   *  output. */
  async printableSnapshot(
    expectedGeneration?: number,
  ): Promise<PrintableDocument> {
    const snapshot = this.snapshot(expectedGeneration)
    const captured = this.session.capture()
    const state = this.editor.ctx.get(editorViewCtx).state
    const doc = this.document.exportDocument(snapshot.text)
    const output = await this.exportContent(captured, async (signal) => {
      if (
        snapshot.format === 'md' &&
        !this.options.images &&
        !this.options.files &&
        hasAuthoredImagesInLiterals(doc.content, (source) =>
          this.editor.ctx.get(remarkCtx).parse(source),
        )
      )
        throw new InkKitError(
          'image-unavailable',
          'No image adapter is configured for the authored images.',
        )
      return snapshot.format === 'txt'
        ? printableText(snapshot.text)
        : printableMarkdown(
            doc.content,
            state.schema,
            this.options.images,
            this.context(),
            this.options.files,
            signal,
          )
    })
    return Object.freeze({
      documentId: snapshot.documentId,
      generation: snapshot.generation,
      revision: snapshot.revision,
      format: snapshot.format,
      html: output.html,
      styles: output.styles,
      assets: Object.freeze(
        output.assets.map((asset) =>
          Object.freeze({
            ...asset,
            bytes: new Uint8Array(asset.bytes),
          }),
        ),
      ),
      warnings: Object.freeze(
        output.warnings.map((warning) => Object.freeze({ ...warning })),
      ),
    })
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
    const snapshot = this.snapshot(expectedGeneration)
    const captured = this.session.capture()
    const { documentId, generation, revision } = captured
    const version = { documentId, generation, revision }
    if (this.document.format === 'txt') {
      const text = all
        ? snapshot.text
        : snapshot.text.slice(
            rawOffset(snapshot.text, this.source.element.selectionStart),
            rawOffset(snapshot.text, this.source.element.selectionEnd),
          )
      const pre = document.createElement('pre')
      pre.textContent = text
      return {
        ...version,
        text,
        html: pre.outerHTML,
        markdown: text,
        images: [],
        diagrams: [],
      }
    }
    const { schema, selection } = this.editor.ctx.get(editorViewCtx).state
    // A partial copy in the source editor reads only the selected source.
    const doc =
      all || this.mode !== 'source'
        ? this.document.exportDocument(snapshot.text)
        : this.editor.ctx.get(editorViewCtx).state.doc
    const selectedSource =
      !all && this.mode === 'source'
        ? sourceSelection(
            snapshot.text,
            this.source.element.selectionStart,
            this.source.element.selectionEnd,
          )
        : undefined
    const selectedDoc = selectedSource
      ? this.editor.ctx.get(parserCtx)(selectedSource.shareable)
      : undefined
    const completeDiagrams = new Set<string>()
    ;(selectedDoc ?? doc).descendants((node, pos) => {
      if (
        isMermaid(node) &&
        (selectedDoc
          ? Boolean(node.attrs.authoredFence?.close)
          : all ||
            (selection.from <= pos + 1 &&
              selection.to >= pos + node.nodeSize - 1))
      ) {
        completeDiagrams.add(node.textContent.replace(/\r\n?/g, '\n'))
      }
    })
    const content = selectedDoc
      ? selectedDoc.content
      : all
        ? doc.content
        : commentSelectionContent(
            doc,
            selection.from,
            selection.to,
            selection.content().content,
          )
    const valid = content.firstChild?.isInline
      ? Fragment.from(schema.nodes.paragraph!.create(null, content))
      : content
    let markdown: string
    try {
      markdown = selectedSource
        ? selectedSource.markdown
        : all
          ? snapshot.text
          : completeDiagrams.size
            ? Preservation.read(this.editor.ctx, snapshot.text).serialize(
                doc.type.create(null, selectionContent(doc, valid)),
              )
            : selectionMarkdown(this.editor.ctx, doc, valid)
    } catch (error) {
      throw coded(error, 'preservation')
    }
    const result = await this.exportContent(captured, (signal) =>
      portableClipboard(
        all || selectedDoc ? content : selectionContent(doc, content),
        schema,
        markdown,
        this.options.images,
        this.context(),
        completeDiagrams,
        this.options.files,
        signal,
        this.linkSchemes,
      ),
    )
    const metadata = referenceMetadata(
      this.editor.ctx,
      selectedDoc ?? doc,
      content,
    )
    if (metadata != null)
      result.html = withReferenceMetadata(result.html, metadata)
    this.assertCaptured(captured)
    this.rememberCopy(
      result,
      markdown,
      content,
      selectedSource != null &&
        selectedSource.markdown !== selectedSource.shareable,
    )
    return { ...version, ...result }
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
    input = this.restoreCopy(clipboardInput(input))
    this.assertMutation(expectedGeneration)
    if (this.literalSurface) {
      this.pasteAsPlainText(
        this.mode === 'source' && this.document.format === 'md'
          ? (input.markdown ?? input.text)
          : input.text,
      )
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
    this.insertPlainText(text)
    return !before.isCurrent()
  }

  private insertPlainText(text: string): void {
    if (this.literalSurface) {
      this.source.replaceLiteralSelection(
        text,
        true,
        this.document.format === 'md',
      )
    } else {
      const view = this.editor.ctx.get(editorViewCtx)
      const inHiddenComment = hiddenCommentExit(view.state) !== undefined
      if (
        view.state.selection.$from.parent.type.spec.code &&
        !inHiddenComment
      ) {
        view.dispatch(
          view.state.tr
            .insertText(text.replace(/\r\n?/g, '\n'))
            .scrollIntoView(),
        )
      } else {
        const { schema } = view.state
        const { from, to } = view.state.selection
        const marks = replacementMarks(view.state, from, to)
        const isHTML =
          !inHiddenComment && htmlBreakAt(view.state.selection.$from)
        const lines = text.replace(/\r\n?/g, '\n').split('\n')
        const children = literalTextNodes(schema, text, marks, isHTML)
        if (!children.length) {
          view.dispatch(view.state.tr.deleteSelection())
          return
        }
        const paragraph = schema.nodes.paragraph!.create(null, children)
        const transaction = inHiddenComment
          ? insertAfterHiddenComment(view.state, Fragment.from(paragraph))
          : view.state.tr
              .replaceSelection(new Slice(Fragment.from(paragraph), 1, 1))
              .scrollIntoView()
        if (!transaction) return
        // Dispatch validates after appended plugins have normalized the edit.
        const isolated = lines.length > 1
        view.dispatch(isolated ? closeHistory(transaction) : transaction)
        if (isolated)
          view.dispatch(
            closeHistory(view.state.tr).setMeta('addToHistory', false),
          )
      }
    }
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
    this.destroyed = true
    this.localCopies.clear()
    this.ready = false
    this.session.close()
    this.history.reset()
    this.cancelExports()
    this.mediaPolicy()
    this.pasteController.destroy()
    if (this.clickHandler)
      this.root.removeEventListener('click', this.clickHandler)
    if (this.auxClickHandler)
      this.root.removeEventListener('auxclick', this.auxClickHandler)
    this.untrackLinkModifier?.()
    if (this.footnoteKeyHandler)
      this.root.removeEventListener('keydown', this.footnoteKeyHandler, true)
    if (this.copyHandler) {
      this.root.removeEventListener('copy', this.copyHandler, true)
      this.root.removeEventListener('cut', this.copyHandler, true)
    }
    this.source.destroy()
    await this.editor.destroy()
    if (this.ownsRootClass) this.root.classList.remove('inkkit-root')
  }

  // The app's bindings, replaced whole whenever they change; the plugin stays.
  private keymapPlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('appKeymap'),
        props: {
          // ProseMirror skips its editable keydown handler on read-only views.
          handleDOMEvents: {
            keydown: (view, event) => {
              if (!this.writable && this.readingKeys(view, event)) {
                event.preventDefault()
                return true
              }
              return false
            },
          },
          handleKeyDown: (view, event) => {
            if (event.altKey && event.key === 'Enter') {
              return this.forPerson(
                () =>
                  this.navigateFootnote(
                    event.shiftKey ? 'reference' : 'definition',
                  ),
                true,
              )
            }
            return this.keys(view, event)
          },
        },
      }),
  )

  // Indent and outdent keys, replaced whole with the keymap. Milkdown's own key plugin comes last of
  // the plugins that `use` adds, and it holds the keys that Tab must reach first: Tab in a list item
  // that holds a typed row makes the table. So this plugin is appended after it, in the state options.
  private indentPlugin = new Plugin({
    key: new PluginKey('listIndent'),
    props: { handleKeyDown: (view, event) => this.indentKeys(view, event) },
  })

  private copySourceSelection(event: ClipboardEvent): void {
    event.preventDefault()
    event.stopPropagation()
    try {
      const snapshot = this.snapshot()
      const from = this.source.element.selectionStart,
        to = this.source.element.selectionEnd
      const selected = sourceSelection(snapshot.text, from, to)
      const parsed = this.editor.ctx.get(parserCtx)(selected.shareable)
      let portable = false
      parsed.descendants((node) => {
        if (isImage(node) || isMermaid(node)) portable = true
      })
      const cut = event.type === 'cut' && this.writable
      const captured = this.session.capture()
      if (portable && this.events.clipboard) {
        void this.clipboardSnapshot('selection')
          .then(async (content) => {
            if (cut) refuseUnportableCut(content)
            await writeClipboard(this.events, content)
            this.retainCopy(content.html)
            if (cut) {
              this.assertCut(captured)
              this.source.element.setSelectionRange(from, to)
              this.source.replaceLiteralSelection('')
            }
          })
          .catch((error) => this.report(error))
      } else {
        const output = clipboardContent(
          parsed.content,
          parsed.type.schema,
          this.linkSchemes,
        )
        if (!event.clipboardData) return
        this.rememberCopy(
          output,
          selected.markdown,
          parsed.content,
          selected.markdown !== selected.shareable,
          true,
        )
        event.clipboardData.setData('text/plain', output.text)
        event.clipboardData.setData('text/html', output.html)
        if (portable) {
          this.report(noClipboardHandler())
          return
        }
        if (cut) this.source.replaceLiteralSelection('')
      }
    } catch (error) {
      this.report(error)
    }
  }

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
            `The edit was not applied because its Markdown could not be preserved: ${error instanceof Error ? error.message : String(error)}`,
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
   *  `invalid-argument` for a bad root, handler or option. */
  static async mount(
    root: HTMLElement,
    events: EditorEvents,
    options?: EditorOptions,
  ): Promise<InkKitEditor> {
    if (!(root instanceof HTMLElement))
      throw invalidArgument('root must be an HTML element')
    events = hostEvents(events)
    options = editorOptions(options)
    const instance = new InkKitEditor(events, options)
    events = instance.events
    instance.root = root
    instance.ownsRootClass = !root.classList.contains('inkkit-root')
    root.classList.add('inkkit-root')
    instance.pasteController = new PasteController({
      restoreCopy: (input) => instance.restoreCopy(input),
      ctx: () => instance.editor.ctx,
      context: () => instance.context(),
      adapter: options.images,
      onError: (error) => instance.report(error),
      commit: (apply) => instance.facadeCall(apply),
      literalText: () => instance.literalSurface,
      editable: () => instance.writable && !instance.literalSurface,
      onPendingChanged: () => instance.publishCommandState(),
    })
    instance.suggestions = new Suggestions({
      root,
      labels: { ...defaultLabels, ...options.labels },
      active: () =>
        instance.ready &&
        !instance.destroyed &&
        !instance.loading &&
        !instance.literalSurface &&
        instance.writable &&
        !instance.composing &&
        !instance.pasteController.pending,
      start: (view, from, to, text) =>
        slashSession(view, from, to, text, {
          options: options.slashMenu,
          labels: { ...defaultLabels, ...options.labels },
          diagrams:
            options.rendering?.diagramPreview !== false && diagramsAvailable(),
          choose: (session, command, kind) =>
            instance.chooseSlash(session, command, kind),
        }) ??
        wikiSession(view, from, to, text, {
          adapter: options.wikiLinks,
          context: () => instance.context(),
          choose: (session, name) => instance.chooseWiki(session, name),
          error: (error) => {
            instance.suggestions?.close()
            instance.report(error)
          },
        }),
    })
    instance.editor = await createMilkdownEditor(root, options, {
      plugins: {
        indent: instance.indentPlugin,
        paste: instance.pasteController.plugin,
        suggestions: $prose(() => instance.suggestions!.plugin()),
        keymap: instance.keymapPlugin,
        change: instance.changePlugin,
        historyInput: instance.historyInputPlugin,
        policy: instance.policyPlugin,
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
      dispatchTransaction: (view, tr) => instance.dispatchTransaction(view, tr),
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
    })
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
    const activateFootnote = (event: MouseEvent | KeyboardEvent): boolean => {
      const element = (event.target as HTMLElement).closest(
        '[data-inkkit-footnote-reference]',
      )
      if (!element) return false
      const identifier = element.getAttribute('data-inkkit-footnote-reference')
      const view = instance.editor.ctx.get(editorViewCtx)
      let position: number | undefined
      view.state.doc.descendants((node, pos) => {
        if (
          position == null &&
          node.type.name === 'footnote_reference' &&
          node.attrs.identifier === identifier
        )
          position = pos
      })
      if (position == null) return false
      event.preventDefault()
      try {
        view.dispatch(
          view.state.tr.setSelection(
            NodeSelection.create(view.state.doc, position),
          ),
        )
        instance.navigateFootnote('definition')
      } catch (error) {
        instance.report(error)
      }
      return true
    }
    instance.footnoteKeyHandler = (event) => {
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        activateFootnote(event)
      )
        event.stopPropagation()
    }
    root.addEventListener('keydown', instance.footnoteKeyHandler, true)
    instance.clickHandler = (event) => {
      if (activateFootnote(event)) return
      const anchor = (event.target as HTMLElement).closest('a[href]')
      if (!anchor) return
      // A read-only surface is not editable, so the browser would follow the
      // link itself; only the host opens links.
      event.preventDefault()
      if (event.button !== 0 || !modHeld(event)) return
      // The renderer leaves the address empty when it is not on the list in
      // link-safety.ts or among the host's `linkSchemes`.
      const href = anchor.getAttribute('href')
      if (href) events.openLink?.(href)
    }
    root.addEventListener('click', instance.clickHandler)
    instance.auxClickHandler = (event) => {
      if ((event.target as HTMLElement).closest('a[href]'))
        event.preventDefault()
    }
    root.addEventListener('auxclick', instance.auxClickHandler)
    instance.copyHandler = (event) => {
      if (instance.document.format === 'txt') return
      if (instance.mode === 'source') {
        instance.copySourceSelection(event)
        return
      }
      const view = instance.editor.ctx.get(editorViewCtx)
      const fragment = commentSelectionContent(
        view.state.doc,
        view.state.selection.from,
        view.state.selection.to,
        view.state.selection.content().content,
      )
      const expanded = selectionContent(view.state.doc, fragment)
      let hasImages = false
      expanded.descendants((node) => {
        if (isImage(node) || isMermaid(node)) hasImages = true
      })
      if (!hasImages) {
        if (!event.clipboardData || fragment.size === 0) return
        event.preventDefault()
        event.stopPropagation()
        try {
          instance.snapshot()
          const content = expanded
          const valid = fragment.firstChild?.isInline
            ? Fragment.from(
                view.state.schema.nodes.paragraph!.create(null, fragment),
              )
            : fragment
          const markdown = selectionMarkdown(
            instance.editor.ctx,
            view.state.doc,
            valid,
          )
          const output = clipboardContent(
            content,
            view.state.schema,
            instance.linkSchemes,
          )
          const metadata = referenceMetadata(
            instance.editor.ctx,
            view.state.doc,
            valid,
          )
          if (metadata != null)
            output.html = withReferenceMetadata(output.html, metadata)
          instance.rememberCopy(output, markdown, fragment, false, true)
          event.clipboardData.setData('text/plain', output.text)
          event.clipboardData.setData('text/html', output.html)
          if (event.type === 'cut' && instance.writable)
            view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
        } catch (error) {
          instance.report(error)
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (events.clipboard) {
        const captured = instance.session.capture()
        const { from, to } = view.state.selection
        const cut = event.type === 'cut' && instance.writable
        void instance
          .clipboardSnapshot('selection')
          .then(async (content) => {
            if (cut) refuseUnportableCut(content)
            await writeClipboard(events, content)
            instance.retainCopy(content.html)
            if (cut) {
              instance.assertCut(captured)
              view.dispatch(
                view.state.tr.deleteRange(from, to).scrollIntoView(),
              )
            }
          })
          .catch((error) => instance.report(error))
      } else {
        const container = document.createElement('div')
        container.textContent = clipboardText(expanded)
        event.clipboardData?.setData('text/plain', container.textContent ?? '')
        event.clipboardData?.setData('text/html', container.outerHTML)
        instance.report(noClipboardHandler())
      }
    }
    root.addEventListener('copy', instance.copyHandler, true)
    root.addEventListener('cut', instance.copyHandler, true)
    instance.applyInputPolicy()
    instance.setKeymap(options.keymap ?? {})
    instance.untrackLinkModifier = trackLinkModifier(root)
    return instance
  }

  /** Replaces the document. The generation must be greater than the loaded one. A failed load
   *  changes nothing. */
  loadDocument(input: DocumentInput): void {
    this.assertAlive()
    input = documentInput(input)
    this.session.checkLoad(input.generation, 'input.generation')
    const markdown = input.format === 'txt' ? '' : input.text
    // Parsed before anything changes, so Markdown that cannot be loaded changes nothing.
    let preservation: Preservation
    try {
      preservation = Preservation.read(this.editor.ctx, markdown)
    } catch (error) {
      throw new InkKitError(
        'preservation',
        'The document was not loaded because its Markdown could not be shown without losing part of it',
        { cause: error },
      )
    }
    const container = this.viewportContainer ?? this.root
    const top = container.scrollTop,
      left = container.scrollLeft
    this.releaseFocus()
    this.ready = false
    this.cancelExports()
    this.mediaPolicy()
    this.pasteController.cancelPending()
    // Views made while the new document loads capture its generation.
    this.session.load(input.documentId, input.generation)
    this.document.resetCaches()
    this.history.reset()
    this.mode = 'formatted'
    this.source.reset()
    this.plainSearch = ''
    this.literalMatch = undefined
    this.document.format = input.format
    this.source.setSourceValue(input.text)
    this.source.element.setSelectionRange(
      this.source.element.value.length,
      this.source.element.value.length,
    )
    this.load(markdown, preservation)
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
    const document = this.root.ownerDocument
    const surface = this.editor.ctx.get(editorViewCtx).dom
    const active = document.activeElement
    if (active === this.source.element) {
      this.source.element.blur()
      return
    }
    if (active === surface) surface.blur()
    else if (active && active !== document.body) return
    // WebKit keeps typing into a contenteditable that has lost focus while the document
    // selection is still in it, including after the host blurred it itself.
    const selection = document.getSelection()
    if (selection?.anchorNode && surface.contains(selection.anchorNode))
      selection.removeAllRanges()
  }

  /** Replaces the document with a newer version of it, keeping the selection, focus, scroll
   *  position and Markdown editing mode. With `expectedGeneration`, the loaded document must be
   *  that generation. */
  reloadDocument(input: DocumentInput, expectedGeneration?: number): void {
    this.assertAlive()
    input = documentInput(input)
    if (!isOmitted(expectedGeneration)) this.assertReady(expectedGeneration)
    this.session.checkLoad(input.generation, 'input.generation')
    const view = this.editor.ctx.get(editorViewCtx)
    const wasLiteral = this.literalSurface
    const previousMode = this.editingMode
    const previousFormat = this.document.format
    const selectedNode =
      !wasLiteral && view.state.selection instanceof NodeSelection
        ? view.state.selection.node
        : undefined
    const at = wasLiteral
      ? this.source.element.selectionStart
      : view.state.selection.anchor
    const end = wasLiteral
      ? this.source.element.selectionEnd
      : view.state.selection.head
    const direction = this.source.element.selectionDirection
    const container = this.viewportContainer ?? this.root
    const top = container.scrollTop,
      left = container.scrollLeft
    const focused = wasLiteral
      ? document.activeElement === this.source.element
      : view.hasFocus()
    const plainTop = this.source.element.scrollTop,
      plainLeft = this.source.element.scrollLeft
    this.reportingSuppressed = true
    try {
      this.loadDocument(input)
      if (
        previousFormat === 'md' &&
        input.format === 'md' &&
        previousMode === 'source'
      )
        this.setEditingMode('source', input.generation)
      if (this.literalSurface)
        this.source.element.setSelectionRange(
          Math.min(at, this.source.element.value.length),
          Math.min(end, this.source.element.value.length),
          direction,
        )
      else {
        const anchor = Math.min(at, view.state.doc.content.size)
        const node = view.state.doc.nodeAt(anchor)
        view.dispatch(
          view.state.tr.setSelection(
            selectedNode &&
              node?.type === selectedNode.type &&
              NodeSelection.isSelectable(node)
              ? NodeSelection.create(view.state.doc, anchor)
              : TextSelection.between(
                  view.state.doc.resolve(anchor),
                  view.state.doc.resolve(
                    Math.min(end, view.state.doc.content.size),
                  ),
                ),
          ),
        )
      }
      if (focused) {
        if (this.literalSurface)
          this.source.element.focus({ preventScroll: true })
        else view.focus()
      }
      container.scrollTop = top
      container.scrollLeft = left
      if (wasLiteral && this.literalSurface) {
        this.source.element.scrollTop = plainTop
        this.source.element.scrollLeft = plainLeft
      }
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
    this.viewportContainer = container
    this.viewportInsets = insets
  }

  /** The visible rectangle, the insets and the scroll offsets. */
  viewport(): ViewportSnapshot {
    this.assertAlive()
    const container = this.viewportContainer ?? this.root
    const bounds = container.getBoundingClientRect()
    const root = this.root.getBoundingClientRect()
    const insets = this.viewportInsets
    const window = this.root.ownerDocument.defaultView!
    const left = Math.max(bounds.left + container.clientLeft, root.left, 0)
    const top = Math.max(bounds.top + container.clientTop, root.top, 0)
    const right = Math.max(
      left,
      Math.min(
        bounds.left + container.clientLeft + container.clientWidth,
        root.right,
        window.innerWidth,
      ),
    )
    const bottom = Math.max(
      top,
      Math.min(
        bounds.top + container.clientTop + container.clientHeight,
        root.bottom,
        window.innerHeight,
      ),
    )
    let rect = textRect({ left, top, right, bottom })
    if (this.literalSurface) {
      const plain = this.source.element.getBoundingClientRect()
      const literalLeft = Math.max(
        rect.left,
        plain.left + this.source.element.clientLeft,
      )
      const literalTop = Math.max(
        rect.top,
        plain.top + this.source.element.clientTop,
      )
      rect = textRect({
        left: literalLeft,
        top: literalTop,
        right: Math.max(
          literalLeft,
          Math.min(
            rect.right,
            plain.left +
              this.source.element.clientLeft +
              this.source.element.clientWidth,
          ),
        ),
        bottom: Math.max(
          literalTop,
          Math.min(
            rect.bottom,
            plain.top +
              this.source.element.clientTop +
              this.source.element.clientHeight,
          ),
        ),
      })
    }
    const insetLeft = Math.min(rect.right, rect.left + insets.left)
    const insetTop = Math.min(rect.bottom, rect.top + insets.top)
    rect = textRect({
      left: insetLeft,
      top: insetTop,
      right: Math.max(insetLeft, rect.right - insets.right),
      bottom: Math.max(insetTop, rect.bottom - insets.bottom),
    })
    return Object.freeze({
      rect: Object.freeze(rect),
      insets: Object.freeze({ ...insets }),
      scrollTop:
        container.scrollTop +
        (this.literalSurface ? this.source.element.scrollTop : 0),
      scrollLeft:
        container.scrollLeft +
        (this.literalSurface ? this.source.element.scrollLeft : 0),
    })
  }

  private readableScope(): NonNullable<InkKitEditor['textScope']> {
    const { key } = this.session.capture()
    if (this.textScope?.key !== key)
      this.textScope = {
        key,
        id: `${this.textIdentity}:${key}`,
        projection: this.literalSurface
          ? { text: this.source.element.value, spans: [] }
          : readableProjection(this.editor.ctx.get(editorViewCtx).state.doc),
      }
    return this.textScope
  }

  /** The readable text and selection. Ranges from it go stale when the document, its revision or
   *  the mode changes. */
  textSnapshot(expectedGeneration?: number): ReadableTextSnapshot {
    this.assertCurrent(expectedGeneration)
    const scope = this.readableScope()
    const selection = this.editor.ctx.get(editorViewCtx).state.selection
    return Object.freeze({
      snapshotId: scope.id,
      ...this.session.version(),
      format: this.document.format,
      mode: this.editingMode,
      text: scope.projection.text,
      selection: Object.freeze({
        snapshotId: scope.id,
        from: this.literalSurface
          ? this.source.element.selectionStart
          : projectionOffset(scope.projection, selection.from),
        to: this.literalSurface
          ? this.source.element.selectionEnd
          : projectionOffset(scope.projection, selection.to),
      }),
    })
  }

  private validateTextRange(range: TextRange): TextProjection {
    this.assertAlive()
    textRange(range, 'range')
    this.assertCurrent()
    const scope = this.readableScope()
    if (range.snapshotId !== scope.id)
      throw new InkKitError(
        'stale-document',
        'The readable text snapshot changed',
      )
    validateOffsets(scope.projection.text, range.from, range.to)
    return scope.projection
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
    if (this.literalSurface)
      this.source.element.setSelectionRange(range.from, range.to)
    else {
      for (const span of projection.spans)
        if (
          span.kind === 'embed' &&
          ((range.from > span.from && range.from < span.to) ||
            (range.to > span.from && range.to < span.to))
        )
          throw new InkKitError(
            'invalid-range',
            'Embedded labels must be selected as complete ranges',
          )
      const view = this.editor.ctx.get(editorViewCtx)
      const from = projectionPosition(projection, range.from, 1)
      const to = projectionPosition(
        projection,
        range.to,
        range.from === range.to ? 1 : -1,
      )
      const embed = projection.spans.find(
        (span) =>
          span.kind === 'embed' &&
          span.from === range.from &&
          span.to === range.to,
      )
      view.dispatch(
        view.state.tr.setSelection(
          embed && view.state.doc.nodeAt(embed.start)
            ? NodeSelection.create(view.state.doc, embed.start)
            : TextSelection.between(
                view.state.doc.resolve(from),
                view.state.doc.resolve(to),
              ),
        ),
      )
    }
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
    if (this.literalSurface) {
      const raw = this.document.currentText()
      const from = rawOffset(raw, range.from),
        to = rawOffset(raw, range.to)
      const ending = /\r\n|\r|\n/.exec(raw)?.[0] ?? '\n'
      const value = text.replace(/\r\n?/g, '\n')
      const replaced =
        raw.slice(0, from) + value.replaceAll('\n', ending) + raw.slice(to)
      return this.history.applySource(
        replaced,
        true,
        range.from,
        range.from + value.length,
      )
    }
    if (
      projection.spans.some(
        (span) =>
          (span.kind === 'embed' &&
            range.from > span.from &&
            range.from < span.to) ||
          (span.kind === 'embed' &&
            range.to > span.from &&
            range.to < span.to) ||
          (span.to > range.from &&
            span.from < range.to &&
            span.kind !== 'text'),
      )
    )
      throw new InkKitError(
        'invalid-range',
        'Replacement cannot remove embedded content or structural separators',
      )
    const from = projectionPosition(projection, range.from, 1)
    const to = projectionPosition(
      projection,
      range.to,
      range.from === range.to ? 1 : -1,
    )
    const view = this.editor.ctx.get(editorViewCtx)
    return replaceFormattedRange(view, from, to, text, (tr) =>
      this.document.assertPreserved(view.state.doc, view.state.apply(tr).doc),
    )
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
    if (!ranges.length) return Object.freeze([])
    const results = this.literalSurface
      ? literalRangesRects(this.source.element, ranges)
      : ranges.map((range, index) =>
          formattedRects(
            this.editor.ctx.get(editorViewCtx),
            projections[index]!,
            range.from,
            range.to,
          ),
        )
    return Object.freeze(
      results.map((rects) =>
        Object.freeze(rects.map((rect) => Object.freeze(rect))),
      ),
    )
  }

  /** The ranges of the snapshot that are inside the viewport now. */
  visibleTextRanges(snapshotId: string): readonly TextRange[] {
    this.assertAlive()
    expectString(snapshotId, 'snapshotId')
    const snapshot = this.textSnapshot()
    this.validateTextRange({ snapshotId, from: 0, to: 0 })
    const viewport = this.viewport().rect
    if (this.literalSurface)
      return Object.freeze(
        literalVisibleRanges(this.source.element, viewport).map((range) =>
          Object.freeze({ snapshotId, ...range }),
        ),
      )
    const visible = (rect: TextRect) => intersectsViewport(rect, viewport)
    const ranges: TextRange[] = []
    const projection = this.readableScope().projection
    const view = this.editor.ctx.get(editorViewCtx)
    for (const span of projection.spans) {
      const current = { text: projection.text, spans: [span] }
      if (
        span.kind === 'separator' ||
        !formattedRects(view, current, span.from, span.to).some(visible)
      )
        continue
      for (let from = span.from; from < span.to;) {
        const to = from + (snapshot.text.codePointAt(from)! > 0xffff ? 2 : 1)
        if (formattedRects(view, current, from, to).some(visible)) {
          const previous = ranges.at(-1)
          if (previous?.to === from) previous.to = to
          else ranges.push({ snapshotId, from, to })
        }
        from = to
      }
    }
    return Object.freeze(ranges.map((range) => Object.freeze(range)))
  }

  /** Scrolls `range` into the viewport, unfolding a callout that holds it. */
  revealTextRange(range: TextRange): void {
    const projection = this.validateTextRange(range)
    if (!this.literalSurface) {
      const view = this.editor.ctx.get(editorViewCtx)
      const position = projectionPosition(projection, range.from, 1)
      const at = view.domAtPos(position).node
      let element = at instanceof Element ? at : at.parentElement
      while (element && this.root.contains(element)) {
        if (element.matches('.inkkit-callout[data-inkkit-folded="true"]'))
          element
            .querySelector<HTMLButtonElement>(
              ':scope > .inkkit-callout-header [data-inkkit-callout-toggle]',
            )
            ?.click()
        element = element.parentElement
      }
    }
    this.revealRects(this.textRangesRects([range])[0]!)
  }

  private revealRects(rects: readonly TextRect[]): void {
    if (!rects.length) return
    const viewport = this.viewport().rect
    const leading = rects[0]!
    const envelope = {
      top: leading.top,
      bottom: leading.bottom,
      left: leading.left,
      right: leading.right,
    }
    for (const rect of rects) {
      envelope.top = Math.min(envelope.top, rect.top)
      envelope.bottom = Math.max(envelope.bottom, rect.bottom)
      envelope.left = Math.min(envelope.left, rect.left)
      envelope.right = Math.max(envelope.right, rect.right)
    }
    const fitsHeight = envelope.bottom - envelope.top <= viewport.height
    const fitsWidth = envelope.right - envelope.left <= viewport.width
    const rect = {
      top: fitsHeight ? envelope.top : leading.top,
      bottom: fitsHeight
        ? envelope.bottom
        : Math.min(leading.bottom, leading.top + viewport.height),
      left: fitsWidth ? envelope.left : leading.left,
      right: fitsWidth
        ? envelope.right
        : Math.min(leading.right, leading.left + viewport.width),
    }
    const vertical =
      viewport.height <= 0
        ? 0
        : rect.top < viewport.top
          ? rect.top - viewport.top
          : rect.bottom > viewport.bottom
            ? rect.bottom - viewport.bottom
            : 0
    const horizontal =
      viewport.width <= 0
        ? 0
        : rect.left < viewport.left
          ? rect.left - viewport.left
          : rect.right > viewport.right
            ? rect.right - viewport.right
            : 0
    let remainingTop = vertical,
      remainingLeft = horizontal
    if (this.literalSurface) {
      const style = this.root.ownerDocument.defaultView!.getComputedStyle(
        this.source.element,
      )
      // The first or last line sits within the padding plus its own leading,
      // under half the height of its first rect, so a reveal that ends there
      // shows the edge. A range of many lines does not count as one line.
      const halfCaret = (leading.bottom - leading.top) / 2
      const remaining = scrollWholePixels(
        this.source.element,
        vertical,
        horizontal,
        {
          top: (Number.parseFloat(style.paddingTop) || 0) + halfCaret,
          bottom: (Number.parseFloat(style.paddingBottom) || 0) + halfCaret,
        },
      )
      remainingTop = remaining.vertical
      remainingLeft = remaining.horizontal
    }
    let container: HTMLElement | null = this.viewportContainer ?? this.root
    const document = this.root.ownerDocument
    while (
      container &&
      container !== document.body &&
      container !== document.documentElement
    ) {
      ;({ vertical: remainingTop, horizontal: remainingLeft } =
        scrollWholePixels(container, remainingTop, remainingLeft))
      container = container.parentElement
    }
    if (remainingTop || remainingLeft)
      document.defaultView!.scrollBy(
        scrollOutward(remainingLeft),
        scrollOutward(remainingTop),
      )
  }

  private revealCurrentSelection(): void {
    if (this.loading || !this.ready) return
    if (this.literalSurface) {
      this.revealLiteralSelection()
      return
    }
    const view = this.editor.ctx.get(editorViewCtx)
    const projection = this.readableScope().projection
    const from = projectionOffset(projection, view.state.selection.from)
    const to = projectionOffset(projection, view.state.selection.to)
    if (this.composing || this.pasteController.pending) {
      this.revealRects(formattedRects(view, projection, from, to))
      return
    }
    this.revealTextRange({
      snapshotId: this.readableScope().id,
      from,
      to,
    })
  }

  private revealLiteralSelection(): void {
    this.revealRects(
      literalRangesRects(this.source.element, [
        {
          from: this.source.element.selectionStart,
          to: this.source.element.selectionEnd,
        },
      ])[0]!,
    )
  }

  private load(markdown: string, preservation: Preservation): void {
    this.localCopies.clear()
    this.document.original = markdown
    const { ctx } = this.editor
    const view = ctx.get(editorViewCtx)
    this.loading = true
    try {
      view.updateState(
        EditorState.create(
          ctx.get(editorStateOptionsCtx)({
            schema: ctx.get(schemaCtx),
            doc: preservation.baseline,
            plugins: ctx.get(prosePluginsCtx),
          }),
        ),
      )
    } finally {
      this.loading = false
    }
    this.document.loaded(preservation)
    this.lastMarkdown = markdown
    const end = terminalSelection(view.state.doc)
    view.dispatch(
      setSearchState(
        view.state.tr.setSelection(end),
        new SearchQuery({ search: '' }),
      ),
    )
  }

  /** Selects the next match and returns whether there was one. */
  find(text: string, expectedGeneration?: number): boolean {
    this.assertAlive()
    expectString(text, 'text')
    this.assertCurrent(expectedGeneration)
    if (this.literalSurface) {
      const from =
        this.plainSearch === text
          ? this.source.element.selectionEnd
          : this.source.element.selectionStart
      const raw = this.document.currentText()
      const match = findLiteral(raw, text, rawOffset(raw, from))
      this.literalMatch = undefined
      if (match) {
        // A textarea displays CRLF as one character; retain a match of either raw half for replacement.
        const start =
          raw[match.from] === '\n' && raw[match.from - 1] === '\r'
            ? match.from - 1
            : match.from
        const displayedFrom = normalizedOffset(raw, start),
          displayedTo = normalizedOffset(raw, match.to)
        this.source.element.setSelectionRange(displayedFrom, displayedTo)
        this.literalMatch = {
          ...match,
          query: text,
          displayedFrom,
          displayedTo,
          version: this.session.capture(),
        }
      } else if (this.plainSearch)
        this.source.element.setSelectionRange(
          this.source.element.selectionEnd,
          this.source.element.selectionEnd,
        )
      this.plainSearch = text
      this.revealLiteralSelection()
      return !!match
    }
    const found = findFormatted(this.editor.ctx.get(editorViewCtx), text)
    if (found) this.revealCurrentSelection()
    return found
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
    return this.replaceMatches(search, replacement, false) > 0
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
    return this.replaceMatches(search, replacement, true)
  }

  private replaceMatches(
    search: string,
    replacement: string,
    all: boolean,
  ): number {
    if (this.literalSurface) {
      const raw = this.document.currentText()
      const remembered = this.literalMatch
      const selection =
        remembered &&
        remembered.query === search &&
        remembered.version.isCurrent() &&
        remembered.displayedFrom === this.source.element.selectionStart &&
        remembered.displayedTo === this.source.element.selectionEnd
          ? { from: remembered.from, to: remembered.to }
          : {
              from: rawOffset(raw, this.source.element.selectionStart),
              to: rawOffset(raw, this.source.element.selectionEnd),
            }
      if (remembered?.query !== search) this.literalMatch = undefined
      const result = replaceLiteral(raw, search, replacement, selection, all)
      if (result.count)
        this.history.applySource(
          result.text,
          true,
          normalizedOffset(result.text, result.from),
          normalizedOffset(result.text, result.to),
        )
      this.plainSearch = search
      return result.count
    }
    const view = this.editor.ctx.get(editorViewCtx)
    return replaceFormatted(
      view,
      search,
      replacement,
      (tr) =>
        this.document.assertPreserved(view.state.doc, view.state.apply(tr).doc),
      all,
    )
  }

  private outlineContext(): OutlineContext {
    const { documentId, generation, revision, key } = this.session.capture()
    return { documentId, generation, revision, key }
  }

  /** The outline in document order. Entries go stale when the document changes. */
  headings(expectedGeneration?: number): readonly Heading[] {
    this.assertCurrent(expectedGeneration)
    if (this.document.format === 'txt') return Object.freeze([])
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
    if (this.document.format === 'txt')
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
    if (/[\r\n]/.test(text)) {
      this.pasteAsPlainText(text)
      return true
    }
    const view = this.editor.ctx.get(editorViewCtx)
    if (view.composing) return false
    const { from, to } = view.state.selection
    const transaction = () => view.state.tr.insertText(text, from, to)
    if (
      !view.someProp('handleTextInput', (handler) =>
        handler(view, from, to, text, transaction),
      )
    ) {
      view.dispatch(transaction().scrollIntoView())
    }
    return true
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
    if (!this.literalSurface && altKey && key === 'Enter')
      return this.navigateFootnote(shiftKey ? 'reference' : 'definition')
    if (
      !this.writable &&
      !this.literalSurface &&
      key === 'Tab' &&
      !metaKey &&
      !ctrlKey &&
      !altKey
    ) {
      const view = this.editor.ctx.get(editorViewCtx)
      return goToNextCell(shiftKey ? -1 : 1)(view.state, view.dispatch)
    }
    if (!this.writable) {
      if (
        !this.literalSurface &&
        this.readOnlyKeys(this.editor.ctx.get(editorViewCtx), event)
      )
        return true
      if (['Enter', 'Tab', 'Backspace', 'Delete'].includes(key))
        this.assertMutation(generation)
      if (this.literalSurface)
        this.readOnlyKeys(this.editor.ctx.get(editorViewCtx), event)
    }
    if (this.literalSurface) {
      if (this.literalKeys(this.editor.ctx.get(editorViewCtx), event))
        return true
      return this.source.keyDown(event)
    }
    const view = this.editor.ctx.get(editorViewCtx)
    return Boolean(
      view.someProp('handleKeyDown', (handler) => handler(view, event)),
    )
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
    const { selection } = state
    const node =
      selection instanceof NodeSelection
        ? selection.node
        : selection.$from.nodeAfter
    if (node?.type.name === 'inkkit_wiki_link' && this.options.wikiLinks) {
      const captured = this.adapterCapture()
      try {
        if (captured.isCurrent())
          this.options.wikiLinks.open(wikiReference(node), captured.context)
      } catch (error) {
        this.report(coded(error, 'file-unavailable'))
      }
    } else {
      // Prefer the character after a boundary, then the one before it, just
      // as a caret at either end of a rendered link belongs to that link.
      const mark = [selection.$from.nodeAfter, selection.$from.nodeBefore]
        .flatMap((node) => node?.marks ?? [])
        .find((mark) => mark.type.name === 'link')
      const href = mark?.attrs.href as string | undefined
      if (href && isSafeLinkTarget(href, this.linkSchemes))
        this.events.openLink?.(href)
    }
    return true
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
    this.configuredKeys = bindings.configuredKeys
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
    const { schema } = this.editor.ctx.get(editorViewCtx).state
    this.insertBlocks(
      paths.map((path) =>
        schema.nodes.paragraph!.create(null, schema.text(path)),
      ),
      point,
    )
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
    const view = this.editor.ctx.get(editorViewCtx)
    const placement = point ? undefined : imagePlacement(view.state)
    if (placement?.kind === 'inline') {
      this.insertInline(images)
      return true
    }
    const blocks = this.imageBlocks(images)
    if (point) {
      this.insertBlocks(blocks, point)
      return true
    }
    const tr =
      placement?.kind === 'after'
        ? view.state.tr.insert(placement.pos, blocks)
        : view.state.tr.replaceSelection(
            new Slice(Fragment.fromArray(blocks), 0, 0),
          )
    // After the last image, so typing continues below it rather than in the block that follows.
    const last = blocks.at(-1)!.firstChild
    let after: number | undefined
    tr.doc.descendants((node, pos) => {
      if (node === last) after = pos + node.nodeSize
      return after == null
    })
    if (after != null) tr.setSelection(TextSelection.create(tr.doc, after))
    view.dispatch(tr.scrollIntoView())
    return true
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
    const view = this.editor.ctx.get(editorViewCtx)
    const { doc, tr } = view.state
    const blocks = this.imageBlocks(images)
    // An empty document is one empty paragraph, which would save as `<br />` ahead of the images.
    const empty =
      doc.childCount === 1 &&
      doc.firstChild!.type.name === 'paragraph' &&
      doc.firstChild!.content.size === 0 &&
      this.document.currentText().trim() === ''
    if (empty) tr.replaceWith(0, doc.content.size, blocks)
    else tr.insert(doc.content.size, blocks)
    // A step of its own, so neither earlier nor later typing joins it.
    view.dispatch(closeHistory(tr))
    view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
    return true
  }

  // One paragraph per image: each is read back as a standalone image block where one fits.
  private imageBlocks(images: ImageInsertion[]): ProseNode[] {
    const { schema } = this.editor.ctx.get(editorViewCtx).state
    return images.map((image) =>
      schema.nodes.paragraph!.create(
        null,
        schema.nodes.image!.create({
          src: image.reference,
          alt: image.alt,
          title: image.title ?? '',
        }),
      ),
    )
  }

  // A table cell holds one line, so the images sit side by side where the selection was, with no
  // space between them: a space beside an image in a cell is saved as `&#x20;`.
  private insertInline(images: ImageInsertion[]): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const { state } = view
    const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ')
    const nodes = images.map((image) =>
      state.schema.nodes.image!.create({
        src: image.reference,
        alt: oneLine(image.alt),
        title: oneLine(image.title ?? ''),
      }),
    )
    const { from, to } = state.selection
    const tr = state.tr.replaceWith(from, to, nodes)
    tr.setSelection(TextSelection.create(tr.doc, from + nodes.length))
    view.dispatch(tr.scrollIntoView())
  }

  private insertBlocks(blocks: ProseNode[], point: ClientPoint): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const { from: at, to } = blockDropRange(view, point.clientX, point.clientY)
    const tr = view.state.tr.replaceWith(at, to, blocks)
    const end = at + blocks.reduce((size, node) => size + node.nodeSize, 0) - 1
    view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView(),
    )
    this.focus()
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
          view.dispatch(wikiSuggestionTransaction(view, session, name))
          view.dispatch(
            closeHistory(view.state.tr).setMeta('addToHistory', false),
          )
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
            const view = this.editor.ctx.get(editorViewCtx)
            const tr = slashTransaction(
              this.editor.ctx,
              session.base,
              value,
              kind,
            )
            this.suggestionBase = session.base
            try {
              view.dispatch(tr.scrollIntoView())
            } finally {
              this.suggestionBase = undefined
            }
            view.dispatch(
              closeHistory(view.state.tr).setMeta('addToHistory', false),
            )
            return true
          }),
        false,
      )
    if (typeof command === 'string') {
      commit(command)
      return
    }
    // Only what the host's action throws or rejects with is its failure. Inkkit's own insert reports
    // for itself, so it is not given to this handler.
    const onHostError = (error: unknown) => {
      if (!this.destroyed) this.report(coded(error, 'slash-command-failed'))
    }
    const insert = (markdown: string | undefined) => {
      if (this.destroyed) return
      if (markdown === undefined) return
      if (typeof markdown !== 'string') {
        this.report(
          invalidArgument('A slash command must return Markdown text'),
        )
        return
      }
      commit({ markdown })
    }
    let result: ReturnType<SlashCommand['action']>
    try {
      result = command.action(this.context())
    } catch (error) {
      onHostError(error)
      return
    }
    if (result instanceof Promise) result.then(insert, onHostError)
    else insert(result)
  }

  /** Returns whether the document or the marks the next typed text takes changed. */
  format(
    command: FormatCommand,
    options?: FormatOptions,
    expectedGeneration?: number,
  ): boolean {
    this.assertAlive()
    const checked = formatOptions(command, options)
    if (checked?.destination !== undefined)
      this.checkDestination(checked.destination, 'options.destination')
    this.assertMutation(expectedGeneration)
    if (this.literalSurface) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const before = view.state
    applyFormat(this.editor, command, checked, (destination) =>
      this.link(destination),
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
   * or a scheme the host listed, or that the Markdown writer cannot save so that it reads back the
   * same.
   */
  private checkDestination(destination: string, name: string): void {
    if (destination.trim() === '')
      throw invalidArgument(`${name} must not be empty`)
    if (!isSafeLinkTarget(destination, this.linkSchemes))
      throw invalidArgument(
        `${name} must be relative, or an address with an allowed scheme (http, https, mailto, tel or one of linkSchemes), with no control characters`,
      )
    const { schema } = this.editor.ctx.get(editorViewCtx).state
    const written = serialize(
      this.editor.ctx,
      schema.node('doc', null, [
        schema.node('paragraph', null, [
          schema.text('x', [schema.marks.link!.create({ href: destination })]),
        ]),
      ]),
    )
    let read: unknown
    this.editor.ctx
      .get(parserCtx)(written)
      .descendants((node) => {
        read ??= node.marks.find((mark) => mark.type.name === 'link')?.attrs
          .href
      })
    if (read !== destination)
      throw invalidArgument(`${name} cannot be written in Markdown as given`)
  }

  /**
   * With a destination, sets the link: on the whole link that holds the caret or the selection,
   * keeping its title, or else on the selection. A reference link's shared definition is edited
   * instead. Without one, removes that whole link, or every link in the selection. Marks waiting
   * for the next typed text stay waiting.
   */
  private link(destination: string | undefined): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const { state } = view
    const type = linkSchema.type(this.editor.ctx)
    const { selection, storedMarks } = state
    const { from, to, empty } = selection
    const stored = empty ? type.isInSet(storedMarks ?? []) : undefined
    // Links end at their edges, so a caret at a link's end, where typing
    // continues or leaves it, is still at that link.
    const beside = empty ? (selection.$from.nodeBefore?.marks ?? []) : []
    // A stored link that the caret already sits in is that link, kept when another mark was toggled.
    if (
      stored &&
      !stored.isInSet(selection.$from.marks()) &&
      !stored.isInSet(beside)
    ) {
      const tr = state.tr.removeStoredMark(type)
      if (destination !== undefined)
        tr.addStoredMark(type.create({ href: destination }))
      view.dispatch(tr)
      return
    }
    const mark = type.isInSet(
      empty
        ? [
            ...selection.$from.marks(),
            ...beside,
            ...(state.doc.nodeAt(from)?.marks ?? []),
          ]
        : (state.doc.nodeAt(from)?.marks ?? []),
    )
    const extent = mark && markRun(state.doc, mark, from, to)
    // Steps clear the stored marks; the ones other than the old link are put back.
    const keepStored = (tr: Transaction, link?: ProseMark) => {
      if (!storedMarks) return tr
      const kept = type.removeFromSet(storedMarks)
      return tr.setStoredMarks(
        link && type.isInSet(storedMarks) ? link.addToSet(kept) : kept,
      )
    }
    if (destination === undefined) {
      if (extent)
        view.dispatch(
          keepStored(state.tr.removeMark(extent.from, extent.to, type)),
        )
      else if (!empty && state.doc.rangeHasMark(from, to, type))
        view.dispatch(state.tr.removeMark(from, to, type))
      return
    }
    if (extent && mark!.attrs.identifier != null) {
      const identifier = String(mark!.attrs.identifier)
      const definition = referenceDefinitions(state.doc).get(
        normaliseLabel(identifier),
      )
      if (definition?.node.attrs.url === destination) return
      this.editReferenceDefinition(identifier, destination)
      if (storedMarks) view.dispatch(view.state.tr.setStoredMarks(storedMarks))
      return
    }
    if (extent) {
      // An autolink rewritten with its own address would lose its form for nothing.
      if (mark!.attrs.href === destination) return
      const link = type.create({ href: destination, title: mark!.attrs.title })
      view.dispatch(
        keepStored(
          state.tr
            .removeMark(extent.from, extent.to, type)
            .addMark(extent.from, extent.to, link),
          link,
        ),
      )
      return
    }
    const link = type.create({ href: destination })
    view.dispatch(
      empty
        ? state.tr.addStoredMark(link)
        : state.tr.removeMark(from, to, type).addMark(from, to, link),
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
    if (this.literalSurface) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const definitions = referenceDefinitions(view.state.doc)
    const definition =
      definitions.get(normaliseLabel(label)) ??
      [...definitions.values()].find(
        ({ node }) =>
          normaliseLabel(String(node.attrs.label)) === normaliseLabel(label),
      )
    if (!definition) return false
    const transaction = view.state.tr.setNodeMarkup(definition.pos, undefined, {
      ...definition.node.attrs,
      url: destination,
      title: title == null ? definition.node.attrs.title : singleLine(title),
    })
    // A refused edit makes the call throw `preservation` and change nothing.
    view.dispatch(transaction)
    return true
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
    if (this.literalSurface) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const definitions = footnoteDefinitions(view.state.doc)
    if (label == null) {
      let number = 1
      const labels = new Set(definitions.keys())
      for (const match of this.snapshot().text.matchAll(/\[\^([^\]\r\n]+)\]/g))
        labels.add(normaliseLabel(match[1]!))
      view.state.doc.descendants((node) => {
        if (node.type.name === 'footnote_reference')
          labels.add(String(node.attrs.identifier))
      })
      while (labels.has(normaliseLabel(String(number)))) number++
      label = String(number)
    }
    const identifier = normaliseLabel(label)
    const reference = view.state.schema.nodes.footnote_reference!.create({
      label,
      identifier,
    })
    const tr = view.state.tr.insert(view.state.selection.to, reference)
    if (!definitions.has(identifier)) {
      const definition = view.state.schema.nodes.footnote_definition!.create(
        { label, identifier },
        view.state.schema.nodes.paragraph!.create(),
      )
      const position = tr.doc.content.size
      tr.insert(position, definition).setSelection(
        TextSelection.create(tr.doc, position + 2),
      )
    }
    view.dispatch(tr.scrollIntoView())
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
    const view = this.editor.ctx.get(editorViewCtx)
    const { $from } = view.state.selection
    let identifier: string | undefined
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node.type.name === 'footnote_definition')
        identifier = String(node.attrs.identifier)
    }
    const at = view.state.doc.nodeAt(view.state.selection.from)
    const adjacent =
      at?.type.name === 'footnote_reference' ? at : $from.nodeBefore
    if (adjacent?.type.name === 'footnote_reference')
      identifier = String(adjacent.attrs.identifier)
    if (!identifier) return false
    let position: number | undefined
    if (target === 'definition') {
      const found = footnoteDefinitions(view.state.doc).get(identifier)
      if (found) position = found.pos + 2
    } else
      view.state.doc.descendants((node, pos) => {
        if (
          position == null &&
          node.type.name === 'footnote_reference' &&
          node.attrs.identifier === identifier
        )
          position = pos
      })
    if (position == null) return false
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.near(view.state.doc.resolve(position)))
        .scrollIntoView(),
    )
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
          return this.facadeCall(() => method.apply(this, args))
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
    InkKitEditor.mount = async (...args) => {
      try {
        return await mount(...args)
      } catch (error) {
        throw coded(error)
      }
    }
  }
}

type PublicMethod = {
  [K in keyof InkKitEditor]: InkKitEditor[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never
}[keyof InkKitEditor]
