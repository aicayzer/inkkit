import { literalTextNodes } from './literal-text'
import { wikiSession, wikiSuggestionTransaction } from './wiki-suggestions'
import type { SlashMenuOptions, SlashCommandName, SlashCommand } from './types'
import { Suggestions, type SuggestionSession } from './suggestions'
import { slashMenuOptions, slashSession, slashTransaction } from './slash-menu'
import { htmlBreakAt } from './hard-break'
import {
  Editor,
  commandsCtx,
  type CmdKey,
  defaultValueCtx,
  editorStateOptionsCtx,
  editorViewCtx,
  parserCtx,
  editorViewOptionsCtx,
  prosePluginsCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  schemaCtx,
} from '@milkdown/kit/core'
import {
  visibleClipboard,
  portableClipboard,
  clipboardText,
  clipboardContent,
} from './clipboard'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history, historyKeymap } from '@milkdown/kit/plugin/history'
import {
  closeHistory,
  redoDepth,
  undo as undoHistory,
  redo as redoHistory,
} from '@milkdown/kit/prose/history'
import { cursor } from './cursor'
import { insertTextChunk } from './text-input'
import { blockDropRange } from './drop-placement'
import {
  blockquoteKeymap,
  blockquoteSchema,
  bulletListKeymap,
  codeBlockKeymap,
  codeBlockSchema,
  emphasisKeymap,
  headingKeymap,
  headingSchema,
  inlineCodeKeymap,
  inlineCodeSchema,
  linkSchema,
  listItemKeymap,
  orderedListKeymap,
  paragraphKeymap,
  paragraphSchema,
  strongKeymap,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { authoredSourcesCtx, setTextblockType } from './block-conversion'
import { smartPunctuationCtx, undoSmartPunctuation } from './smart-punctuation'
import {
  strikethroughKeymap,
  tableKeymap,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import {
  NodeRange,
  Fragment,
  Mark as ProseMark,
  Slice,
  type MarkType,
  type Node as ProseNode,
  type ResolvedPos,
} from '@milkdown/kit/prose/model'
import { splitBlock } from '@milkdown/kit/prose/commands'
import { keydownHandler, keymap } from '@milkdown/kit/prose/keymap'
import { goToNextCell } from '@milkdown/kit/prose/tables'
import { liftListItem } from '@milkdown/kit/prose/schema-list'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  Mapping,
  findWrapping,
  liftTarget,
} from '@milkdown/kit/prose/transform'
import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  EditorState,
  type Command,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { $prose, callCommand, type $UserKeymap } from '@milkdown/kit/utils'
import { literalEnter, literalReread, literalRereadKey } from './literal-edits'
import { codeCopyPlugin, placeholderPlugin } from './decorations'
import { codeControlCtx, codeControlsPlugin } from './code-controls'
import { labelsCtx, defaultLabels } from './labels'
import { createDialect, serialize, stringifyOptions } from './dialect'
import { isSafeLinkTarget } from './link-safety'
import { Preservation } from './preserve'
import { modeSelectionMap } from './mode-selection'
import {
  sourceAttribute,
  cleanSourceDoc,
  editedPlainSource,
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
import { imageView } from './images'
import { imagePlacement, isImage, isImageBlock } from './image-blocks'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import { wikiLinkView } from './wiki-view'
import { withFileSignal } from './files'
import {
  tablePlugins,
  tableCommand,
  tableCommands,
  tableAvailability,
  tableContext,
  tableOptions,
  configureTableMovement,
} from './tables'
import { tableBlock, tableControlCtx } from './table-block'
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
import { highlightKeymap, toggleHighlightCommand } from './inline-highlight'
import {
  blockMove,
  canMoveBlock,
  carriedBlocks,
  moveBlockTransaction,
} from './block-move'
import {
  assertCommentsEndWhereWritten,
  commentSelectionContent,
  commentProvenance,
  literalCommentSpans,
  isComment,
  isWrittenEdit,
  setCommentVisibility,
  sourceReplacement,
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
import { selectionPlugin } from './selection'
import { search, SearchQuery, setSearchState } from 'prosemirror-search'
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
import { taskListPlugin, toggleTaskList } from './tasks'
import { modHeld, trackLinkModifier } from './modifier'
import { diagramsAvailable, isMermaid, mermaidPreview } from './mermaid'
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

function headingLevel(command: FormatCommand): number | undefined {
  const match = /^heading([1-6])$/.exec(command)
  return match ? Number(match[1]) : undefined
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

/** A name in `Keymap`: every format command except `link`, history, block moves, and every table
 *  command. */
export type ShortcutName =
  | Exclude<FormatCommand, 'link'>
  | 'undo'
  | 'redo'
  | 'moveBlockUp'
  | 'moveBlockDown'
  | `table${Capitalize<TableCommand>}`

/** Host bindings in ProseMirror key notation, by shortcut name. */
export type Keymap = Partial<Record<ShortcutName, readonly string[]>>

const formatShortcuts = formatCommands.filter(
  (command): command is Exclude<FormatCommand, 'link'> => command !== 'link',
)

function tableShortcut(command: TableCommand): ShortcutName {
  return `table${command[0]!.toUpperCase()}${command.slice(1)}` as ShortcutName
}

/** Every `ShortcutName`. */
export const shortcutNames: readonly ShortcutName[] = [
  ...formatShortcuts,
  'undo',
  'redo',
  'moveBlockUp',
  'moveBlockDown',
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

/** Mount options. Adapters, `labels` and `rendering` are fixed at mount; the rest can change. */
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

const markNames: Record<string, Mark> = {
  strong: 'bold',
  emphasis: 'italic',
  strike_through: 'strikethrough',
  highlight: 'highlight',
  inlineCode: 'code',
  link: 'link',
}

// Select All resolves at the document level, where no block can be read.
function textBounds(state: EditorState): {
  $from: ResolvedPos
  $to: ResolvedPos
} {
  const { selection, doc } = state
  if (selection instanceof AllSelection)
    return TextSelection.between(doc.resolve(0), doc.resolve(doc.content.size))
  return selection
}

/** The extent of `mark` that covers `from` to `to` inside one textblock: the adjacent inline nodes
 *  that carry it. Undefined when the range leaves it. */
function markRun(
  doc: ProseNode,
  mark: ProseMark,
  from: number,
  to: number,
): { from: number; to: number } | undefined {
  const $from = doc.resolve(from)
  if (!$from.parent.inlineContent || to > $from.end()) return undefined
  const start = $from.start()
  let run: { from: number; to: number } | undefined
  let found: { from: number; to: number } | undefined
  $from.parent.forEach((child, offset) => {
    const childFrom = start + offset
    if (!mark.isInSet(child.marks)) {
      run = undefined
      return
    }
    if (run) run.to = childFrom + child.nodeSize
    else run = { from: childFrom, to: childFrom + child.nodeSize }
    if (run.from <= from && to <= run.to) found = run
  })
  return found
}

function caretState(state: EditorState): CaretState {
  const { empty } = state.selection
  const { $from, $to } = textBounds(state)
  const active = new Set<Mark>()
  const marks = empty ? (state.storedMarks ?? $from.marks()) : []
  for (const mark of marks) {
    const name = markNames[mark.type.name]
    if (name) active.add(name)
  }
  if (!empty) {
    for (const [name, mark] of Object.entries(markNames)) {
      const type = state.schema.marks[name]
      if (type && state.doc.rangeHasMark($from.pos, $to.pos, type))
        active.add(mark)
    }
  }
  return {
    marks: [...active],
    block: blockAt($from.parent, $from),
    quoted: quoted($from, $to),
  }
}

// Prefer the last writing position without selecting a terminal atom that typing could replace.
function terminalSelection(doc: ProseNode): Selection {
  const $end = doc.resolve(doc.content.size)
  const gap = GapCursor as unknown as { valid($pos: ResolvedPos): boolean }
  if (isImageBlock(doc.lastChild) && gap.valid($end)) return new GapCursor($end)
  const text = Selection.findFrom($end, -1, true)
  if (text) return text
  if (gap.valid($end)) return new GapCursor($end)
  throw new InkKitError('preservation', 'Document has no safe writing position')
}

// True only when one quote holds the whole selection, so the state matches what the command can lift.
function quoted($from: ResolvedPos, $to: ResolvedPos): boolean {
  return (
    $from.blockRange($to, (node) => node.type.name === 'blockquote') != null
  )
}

function blockAt(
  parent: ProseNode,
  $from: EditorState['selection']['$from'],
): Block {
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    switch (node.type.name) {
      case 'heading':
        return { type: 'heading', level: node.attrs.level }
      case 'code_block':
        return { type: 'codeBlock' }
      case 'list_item':
        return node.attrs.checked == null
          ? {
              type:
                $from.node(depth - 1).type.name === 'ordered_list'
                  ? 'orderedList'
                  : 'bulletList',
            }
          : { type: 'taskList' }
    }
  }
  if (parent.type.name === 'heading')
    return { type: 'heading', level: parent.attrs.level }
  return { type: 'paragraph' }
}

const quotes = new Set(['blockquote', 'inkkit_callout'])

// Backspace at the start of a quote's or callout's first block is left alone
// by the preset, or joins the block to the one above; leaving the quote is what
// a Backspace there means. A callout's only block stays while it holds text,
// because lifting it would remove the callout and its title.
const quoteBackspace = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || $from.parentOffset > 0 || $from.depth < 2) return false
      const quote = $from.node($from.depth - 1)
      if (!quotes.has(quote.type.name) || $from.index($from.depth - 1) > 0)
        return false
      if (
        quote.type.name === 'inkkit_callout' &&
        quote.childCount === 1 &&
        $from.parent.content.size > 0
      )
        return true
      const range = $from.blockRange($from, (node) =>
        quotes.has(node.type.name),
      )
      const target = range && liftTarget(range)
      if (!range || target == null) return false
      dispatch?.(state.tr.lift(range, target).scrollIntoView())
      return true
    },
  }),
)

// The preset's Enter in an empty block lifts it out of its parent, splitting
// the parent when the block is not its last. A callout split that way repeats
// its header, so Enter there adds a paragraph instead, and leaves the callout
// only from its last block.
const calloutEnter = $prose(() =>
  keymap({
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (
        !empty ||
        $from.depth < 2 ||
        !$from.parent.isTextblock ||
        $from.parent.type.spec.code ||
        $from.parent.content.size > 0
      )
        return false
      const callout = $from.node($from.depth - 1)
      if (
        callout.type.name !== 'inkkit_callout' ||
        $from.index($from.depth - 1) === callout.childCount - 1
      )
        return false
      return splitBlock(state, dispatch)
    },
  }),
)

// The preset lifts only an item's first line, which cannot leave on its own while the item holds
// more, such as a nested list: at the top of a document Backspace did nothing, and below another block
// it merged the line upward and left an empty bullet. The whole item is lifted instead, and a nested
// list it held joins the items that followed, since both now sit at one level.
const listItemBackspace = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || $from.parentOffset > 0 || $from.depth < 3) return false
      const item = $from.node(-1)
      if (
        item.type.name !== 'list_item' ||
        item.childCount < 2 ||
        $from.index(-1) > 0 ||
        $from.index(-2) > 0
      )
        return false
      const { doc } = state
      const range = new NodeRange(
        doc.resolve($from.start(-1)),
        doc.resolve($from.end(-1)),
        $from.depth - 1,
      )
      const target = liftTarget(range)
      if (target == null) return false
      const tr = state.tr.lift(range, target)
      const $line = tr.doc.resolve(tr.mapping.map($from.pos))
      joinLists(tr, $line.start(-1), $line.index(-1) + item.childCount)
      dispatch?.(tr.scrollIntoView())
      return true
    },
  }),
)

// Lifting an item out of a list that no item holds, the preset leaves a nested list the item held
// beside the items that followed. Out of a nested list it joins the two itself.
const liftItem: Command = (state, dispatch) => {
  const itemType = state.schema.nodes.list_item!
  const { $from, $to } = state.selection
  const range = $from.blockRange(
    $to,
    (node) => node.firstChild?.type === itemType,
  )
  const lift = liftListItem(itemType)
  if (!range || !dispatch || $from.node(range.depth - 1).type === itemType)
    return lift(state, dispatch)
  let lifted: Transaction | undefined
  if (!lift(state, (tr) => (lifted = tr)) || !lifted) return false
  let count = 0
  for (let index = range.startIndex; index < range.endIndex; index++)
    count += range.parent.child(index).childCount
  const start = range.$from.start(range.depth - 1)
  const first =
    range.$from.index(range.depth - 1) + (range.startIndex > 0 ? 1 : 0)
  joinLists(lifted, start, first + count)
  joinLists(lifted, start, first)
  dispatch(lifted)
  return true
}

const listItemShiftTab = $prose(() => keymap({ 'Shift-Tab': liftItem }))

// Backspace in the empty line left by ending a list in the middle removes it and joins the two
// lists again, as they were before. In the empty item left by ending a nested list in the middle,
// it moves the item back into the nested list before it, with the items it took along.
const rejoinLists = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (
        !empty ||
        $from.parent.type.name !== 'paragraph' ||
        $from.parent.content.size > 0
      )
        return false
      const index = $from.index(-1)
      const container = $from.node(-1)
      if (container.type.name === 'list_item') {
        const list = $from.node(-2)
        const sublist = container.maybeChild(1)
        const previous = list.maybeChild($from.index(-2) - 1)?.lastChild
        if (
          index !== 0 ||
          container.childCount !== 2 ||
          !sublist ||
          !isList(sublist) ||
          previous?.type !== sublist.type
        )
          return false
        if (dispatch) {
          const at = $from.before(-1)
          // The end of the content of the list the item before ends with.
          const end = at - 2
          const tr = state.tr
            .delete(at, at + container.nodeSize)
            .insert(
              end,
              Fragment.from(
                container.copy(Fragment.from(container.firstChild!)),
              ).append(sublist.content),
            )
          tr.setSelection(TextSelection.create(tr.doc, end + 2))
          dispatch(tr.scrollIntoView())
        }
        return true
      }
      const before = container.maybeChild(index - 1)
      const after = container.maybeChild(index + 1)
      if (!before || !after || !isList(before) || after.type !== before.type)
        return false
      if (dispatch) {
        const at = $from.before()
        const tr = state.tr.delete(at, $from.after())
        joinLists(tr, $from.start(-1), index)
        tr.setSelection(Selection.near(tr.doc.resolve(at), -1))
        dispatch(tr.scrollIntoView())
      }
      return true
    },
  }),
)

// Enter in an empty item in the middle of a nested list split that list around a line left in the
// item holding it, which Markdown cannot write, so the edit was refused. The item moves out a level
// instead, as the last item of a nested list does, and the items after it become its own.
const nestedItemEnter = $prose(() =>
  keymap({
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection
      const itemType = state.schema.nodes.list_item!
      if (
        !empty ||
        $from.depth < 5 ||
        $from.parent.content.size > 0 ||
        $from.node(-1).type !== itemType ||
        $from.node(-1).childCount !== 1 ||
        $from.node(-3).type !== itemType ||
        $from.indexAfter(-2) === $from.node(-2).childCount
      )
        return false
      return liftListItem(itemType)(state, dispatch)
    },
  }),
)

// Items an edit moves between lists, such as ending a list in the middle or lifting an item out a
// level, keep the attributes ProseMirror copies with them, which then disagree with their new list.
// An item takes its list's kind, which the reopened Markdown would give it. A list split from an
// ordered list, which ProseMirror starts from the first list's number, continues from the items
// left before it, as Markdown written so numbers it. Items are followed by position, since
// relabelling replaces their nodes.
const movedListItems = $prose(
  () =>
    new Plugin({
      key: new PluginKey('movedListItems'),
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const {
          bullet_list: bullet,
          ordered_list: ordered,
          list_item: itemType,
        } = newState.schema.nodes
        const maps = transactions.flatMap((tr) => tr.mapping.maps)
        const mapping = new Mapping(maps)
        const inverse = mapping.invert()
        // The ordered list and index of the item whose content starts at a position.
        const itemAt = (doc: ProseNode, pos: number) => {
          const $pos = doc.resolve(pos)
          return $pos.depth > 1 &&
            $pos.parent.type === itemType &&
            $pos.node(-1).type === ordered
            ? {
                list: $pos.node(-1),
                at: $pos.before(-1),
                index: $pos.index(-1),
              }
            : undefined
        }
        let ranges: Array<[number, number]> = []
        for (const map of maps) {
          ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to)])
          map.forEach((_from, _to, from, to) => ranges.push([from, to]))
        }
        const tr = newState.tr
        const seen = new Set<number>()
        const { doc } = newState
        const continued = (list: ProseNode, pos: number) => {
          const back = inverse.mapResult(pos + 2, 1)
          const origin = back.deleted
            ? undefined
            : itemAt(oldState.doc, back.pos)
          // The original list itself, which lost the items before this one.
          if (!origin?.index || mapping.map(origin.at, 1) === pos) return
          const $list = doc.resolve(pos)
          let before = 0
          for (
            let index = 0, at = origin.at + 1;
            index < origin.index;
            at += origin.list.child(index++).nodeSize
          ) {
            const forward = mapping.mapResult(at + 1, 1)
            const now = forward.deleted ? undefined : itemAt(doc, forward.pos)
            if (
              now &&
              now.at < pos &&
              doc.resolve(now.at).start() === $list.start()
            )
              before++
          }
          // A part split at its own level continues the numbering. A list
          // that comes to follow the first line of an item starts from 1,
          // since Markdown reads a list after a line only when it does.
          const order = before
            ? Number(origin.list.attrs.order) + before
            : $list.parent.type === itemType
              ? 1
              : undefined
          if (order !== undefined && list.attrs.order !== order)
            tr.setNodeMarkup(pos, undefined, { ...list.attrs, order })
        }
        for (const [from, to] of ranges)
          doc.nodesBetween(
            Math.max(0, from - 1),
            Math.min(doc.content.size, to + 1),
            (node, pos, parent) => {
              if (seen.has(pos)) return
              seen.add(pos)
              if (node.type === ordered) continued(node, pos)
              const listType =
                parent?.type === ordered
                  ? 'ordered'
                  : parent?.type === bullet
                    ? 'bullet'
                    : undefined
              if (
                node.type === itemType &&
                listType &&
                node.attrs.listType !== listType
              )
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  listType,
                  label: listType === 'ordered' ? node.attrs.label : '•',
                })
            },
          )
        return tr.docChanged ? tr : null
      },
    }),
)

// A control chord that nothing handles reaches the page as its ASCII control character
// (Control-N as U+000E), which the web view would insert as text.
const controlCharacters = /^[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+$/
const textInputPolicy = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitTextInput'),
      props: {
        handleTextInput: (view, from, to, text, deflt) =>
          controlCharacters.test(text) ||
          insertTextChunk(view, from, to, text, deflt),
      },
    }),
)

function outermostListDepth($pos: ResolvedPos): number | null {
  for (let depth = 1; depth <= $pos.depth; depth++) {
    if (isList($pos.node(depth))) return depth
  }
  return null
}

function innermostListDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth >= 1; depth--) {
    if (isList($pos.node(depth))) return depth
  }
  return null
}

function isList(node: ProseNode): boolean {
  return node.type.name === 'bullet_list' || node.type.name === 'ordered_list'
}

// Two lists of one kind side by side are written with a changed marker to keep them apart, and the
// document shows a gap between them, so an edit that leaves them so joins them.
function joinLists(tr: Transaction, start: number, index: number): void {
  const $start = tr.doc.resolve(start)
  const before = $start.parent.maybeChild(index - 1)
  const after = $start.parent.maybeChild(index)
  if (before && after && isList(before) && after.type === before.type)
    tr.join($start.posAtIndex(index))
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

// A pause in source typing longer than this ends an undo step, as in the
// formatted editor's history.
const sourceGroupDelay = 500
// Earlier undo steps of typed source that the formatted document has not taken
// in; the oldest merge into the next beyond this many.
const sourceStepLimit = 100

interface TypedSource {
  text: string
  from: number
  to: number
  // Where the caret and selection were before this step began.
  before: { from: number; to: number }
  // An edit that is not typing, which later typing does not join.
  closed: boolean
}

/**
 * The editor. Create it with `InkKitEditor.mount`, load a document, and read it back with
 * `snapshot`. The reference is https://github.com/aicayzer/inkkit/blob/main/docs/api.md.
 */
export class InkKitEditor {
  private editor!: Editor
  private lastMarkdown = ''
  private formatType: 'md' | 'txt' = 'md'
  private readonly session = new DocumentSession()
  private exportControllers = new Set<AbortController>()
  private plainComposing = false
  private plainSearch = ''
  private literalMatch?: {
    query: string
    from: number
    to: number
    displayedFrom: number
    displayedTo: number
    version: SessionCapture
  }
  private beforePlainInput?: { from: number; to: number }
  // Source typed in the source editor that the hidden formatted document has
  // not taken in yet. The text is already authoritative: snapshots, change
  // events and the textarea use it, and anything that reads the formatted
  // document first settles it. Undo steps taken inside it need no document,
  // so they run on the text alone: `typedSteps` hold the states at the end of
  // earlier typing, `pendingSource` the latest, and `undoneSteps` what undo
  // set aside.
  private pendingSource?: TypedSource
  private typedSteps: TypedSource[] = []
  private undoneSteps: TypedSource[] = []
  // Formatted-history undos taken while source steps were undone, which a
  // redo replays before it reaches those steps.
  private formattedUndone = 0
  // A source edit invalidates the existing formatted redo tail without
  // removing earlier undo steps. Only subsequent formatted undos can be redone.
  private formattedRedoLimit?: number
  private historyDirection?: 'undo' | 'redo'
  private lastSourceInput = 0
  private syncingSource = false
  private mode: EditingMode = 'formatted'
  private sourcePreservations = new WeakMap<SourceProvenance, Preservation>()
  private sourceTexts = new WeakMap<ProseNode, string>()
  private ready = false
  private destroyed = false
  private preservation?: Preservation
  // The blocks moves have carried since the document loaded, whose source goes
  // with them.
  private carried?: WeakSet<ProseNode>
  private pasteController!: PasteController
  private plain!: HTMLTextAreaElement
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
  private originalSource = ''
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
            if (this.loading || this.sameDocument(view.state.doc, previous.doc))
              return
            // Settling typed source brings the document up to a revision and a
            // change event that were already reported.
            if (this.syncingSource) {
              this.mediaPolicy()
              return
            }
            this.session.changed()
            this.cancelExports()
            this.mediaPolicy()
            this.literalMatch = undefined
            let markdown: string
            try {
              markdown = this.currentText(view.state.doc)
            } catch (error) {
              this.events.error?.(coded(error, 'preservation'))
              return
            }
            if (this.literalSurface) {
              const anchor = view.state.doc.attrs[
                sourceAttribute
              ] as SourceProvenance | null
              const from = anchor?.from ?? this.plain.selectionStart
              const to = anchor?.to ?? this.plain.selectionEnd
              if (!this.plainComposing) this.plain.value = markdown
              if (!this.plainComposing) {
                this.plain.setSelectionRange(
                  Math.min(from, this.plain.value.length),
                  Math.min(to, this.plain.value.length),
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

  private readonly events: EditorEvents
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
      format: this.formatType,
      text,
      dirty: text !== this.originalSource,
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
        .dom.dispatchEvent(new Event('inkkit-media-policy'))
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
        ? this.plainComposing
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
      formattedRedoLimit: this.formattedRedoLimit,
      formattedUndone: this.formattedUndone,
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
    this.formattedRedoLimit = before.formattedRedoLimit
    this.formattedUndone = before.formattedUndone
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
      ? this.plainComposing
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
    view.setProps({
      editable: () => this.writable && !this.literalSurface,
      attributes: {
        ...attributes,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label':
          this.options.labels?.formattedEditor ?? defaultLabels.formattedEditor,
      },
    })
    this.plain.readOnly = !this.writable
    for (const surface of [view.dom, this.plain]) {
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
    const manager = this.editor.ctx.get(commandsCtx)
    const check = <T>(key: CmdKey<T>, payload?: T): boolean =>
      formatted && manager.get(key)(payload)(state)
    const canBecome = (
      type: 'paragraph' | 'heading' | 'codeBlock',
      level?: number,
    ): boolean => formatted && this.textblockType(type, level)(state)
    const heading = (level: number) =>
      canBecome('heading', level) || canBecome('paragraph')
    const format: Record<FormatCommand, boolean> = {
      heading1: heading(1),
      heading2: heading(2),
      heading3: heading(3),
      heading4: heading(4),
      heading5: heading(5),
      heading6: heading(6),
      paragraph: canBecome('paragraph'),
      bold: check(toggleStrongCommand.key),
      italic: check(toggleEmphasisCommand.key),
      strikethrough: check(toggleStrikethroughCommand.key),
      highlight: check(toggleHighlightCommand.key),
      code:
        formatted &&
        (state.selection.empty
          ? state.selection.$from.parent.inlineContent &&
            state.selection.$from.parent.type.allowsMarkType(
              inlineCodeSchema.type(this.editor.ctx),
            )
          : check(toggleInlineCodeCommand.key)),
      codeBlock: canBecome('codeBlock') || canBecome('paragraph'),
      quote: formatted && this.canQuote(state),
      bulletList:
        formatted &&
        (innermostListDepth(textBounds(state).$from) != null ||
          check(wrapInBulletListCommand.key)),
      orderedList:
        formatted &&
        (innermostListDepth(textBounds(state).$from) != null ||
          check(wrapInOrderedListCommand.key)),
      taskList:
        formatted &&
        (innermostListDepth(textBounds(state).$from) != null ||
          check(wrapInBulletListCommand.key)),
      link: check(toggleLinkCommand.key, {}),
    }
    const tables = formatted
      ? tableAvailability(this.editor.ctx)
      : (Object.fromEntries(
          tableCommands.map((name) => [name, false]),
        ) as Record<TableCommand, boolean>)
    return {
      ...this.session.version(),
      format: this.formatType,
      mode: this.editingMode,
      editable: this.writable,
      composing: this.composing,
      pending: this.pasteController.pending,
      caret: this.literalSurface
        ? { marks: [], block: { type: 'paragraph' }, quoted: false }
        : caretState(state),
      table: this.literalSurface ? undefined : tableContext(state),
      commands: {
        undo: mutable && (!!this.pendingSource || undoHistory(state)),
        redo:
          mutable &&
          (this.undoneSteps.length > 0 ||
            (!this.pendingSource &&
              this.formattedRedoLimit !== 0 &&
              redoHistory(state))),
        insertText: mutable,
        paste: mutable,
        replace: mutable,
        replaceSource: mutable,
        insertImages: formatted && this.canInsertImages,
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

  private canQuote(state: EditorState): boolean {
    const { $from, $to } = textBounds(state)
    if (quoted($from, $to)) {
      const range = $from.blockRange(
        $to,
        (node) => node.type.name === 'blockquote',
      )
      return !!range && liftTarget(range) != null
    }
    const type = blockquoteSchema.type(this.editor.ctx)
    let range = $from.blockRange($to)
    if (range && findWrapping(range, type)) return true
    const depth = outermostListDepth($from)
    if (depth == null) return false
    range = new NodeRange(
      state.doc.resolve($from.before(depth)),
      state.doc.resolve($from.after(depth)),
      depth - 1,
    )
    return !!findWrapping(range, type)
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
          this.syncingSource ||
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
    return this.formatType === 'txt' || this.mode === 'source'
  }

  /** `formatted` or `source`. A TXT document is always `source`. */
  get editingMode(): EditingMode {
    this.assertAlive()
    return this.literalSurface ? 'source' : 'formatted'
  }

  private currentText(doc?: ProseNode): string {
    if (!doc && this.pendingSource) return this.pendingSource.text
    doc ??= this.editor.ctx.get(editorViewCtx).state.doc
    const cached = this.sourceTexts.get(doc)
    if (cached !== undefined) return cached
    const provenance = doc.attrs[sourceAttribute] as SourceProvenance | null
    if (this.formatType === 'txt')
      return provenance?.text ?? this.originalSource
    let text: string
    try {
      let preservation = this.preservation
      if (provenance) {
        preservation = this.sourcePreservations.get(provenance)
        if (!preservation) {
          preservation = new Preservation(this.editor.ctx, provenance.text)
          this.sourcePreservations.set(provenance, preservation)
        }
      }
      text = preservation!.serialize(cleanSourceDoc(doc), this.carried)
    } catch (error) {
      throw coded(error, 'preservation')
    }
    this.sourceTexts.set(doc, text)
    return text
  }

  /** Switches between formatted and source editing. Returns false when the mode is already set, and
   *  for TXT. */
  setEditingMode(mode: EditingMode, expectedGeneration?: number): boolean {
    this.assertAlive()
    expectOneOf(mode, editingModes, 'mode')
    this.assertCurrent(expectedGeneration)
    if (this.formatType === 'txt' || this.mode === mode) return false
    const wasSource = this.literalSurface
    const view = this.editor.ctx.get(editorViewCtx)
    const focused = wasSource
      ? this.plain.ownerDocument.activeElement === this.plain
      : view.hasFocus()
    const container = this.viewportContainer ?? this.root
    const previousSurface = wasSource ? this.plain : container
    const fraction =
      previousSurface.scrollTop /
      Math.max(1, previousSurface.scrollHeight - previousSurface.clientHeight)
    const left = previousSurface.scrollLeft
    const sourceSelection = wasSource
      ? {
          anchor:
            this.plain.selectionDirection === 'backward'
              ? this.plain.selectionEnd
              : this.plain.selectionStart,
          head:
            this.plain.selectionDirection === 'backward'
              ? this.plain.selectionStart
              : this.plain.selectionEnd,
        }
      : undefined
    this.settleSource()
    // Source steps that were undone cannot be redone from the other mode.
    this.undoneSteps = []
    this.formattedUndone = 0
    const text = this.snapshot().text
    const mapping = modeSelectionMap(this.editor.ctx, text, view.state.doc)
    const anchor = sourceSelection
      ? mapping.formatted(rawOffset(text, sourceSelection.anchor))
      : normalizedOffset(
          text,
          mapping.source(
            view.state.selection.anchor,
            view.state.selection.anchor < view.state.selection.head ? 1 : -1,
          ),
        )
    const head = sourceSelection
      ? mapping.formatted(rawOffset(text, sourceSelection.head))
      : normalizedOffset(
          text,
          mapping.source(
            view.state.selection.head,
            view.state.selection.head < view.state.selection.anchor ? 1 : -1,
          ),
        )
    this.mode = mode
    this.session.modeChanged()
    this.cancelExports()
    this.plainSearch = ''
    this.literalMatch = undefined
    if (mode === 'source') {
      this.plain.value = text
      this.plain.setSelectionRange(
        Math.min(anchor, head),
        Math.max(anchor, head),
        anchor > head ? 'backward' : 'forward',
      )
    } else {
      view.dispatch(
        view.state.tr
          .setSelection(
            TextSelection.between(
              view.state.doc.resolve(
                Math.min(anchor, view.state.doc.content.size),
              ),
              view.state.doc.resolve(
                Math.min(head, view.state.doc.content.size),
              ),
            ),
          )
          .setMeta('addToHistory', false),
      )
    }
    const suppressed = this.reportingSuppressed
    this.reportingSuppressed = true
    try {
      this.updateSurface()
    } finally {
      this.reportingSuppressed = suppressed
    }
    const surface = this.literalSurface ? this.plain : container
    surface.scrollTop =
      fraction * Math.max(0, surface.scrollHeight - surface.clientHeight)
    surface.scrollLeft = left
    if (focused) {
      if (this.literalSurface) this.plain.focus({ preventScroll: true })
      else view.dom.focus({ preventScroll: true })
      this.revealCurrentSelection()
    }
    this.publishCommandState()
    return true
  }

  private updateSurface(): void {
    this.plain.hidden = !this.literalSurface
    this.applyInputPolicy()
    this.plain.setAttribute(
      'aria-label',
      this.formatType === 'txt'
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
    const changed = this.applySource(text, true)
    if (changed) this.localCopies.clear()
    return changed
  }

  private applySource(
    text: string,
    isolated: boolean,
    from?: number,
    to?: number,
    native = false,
  ): boolean {
    if (!this.writable)
      throw new InkKitError('read-only', 'The editor is read-only')
    // Source edits take the same steps whether typed or not; an edit that is
    // not typing ends the typing step before it and is closed to the next.
    if (this.literalSurface)
      return this.deferSource(text, from, to, native, isolated)
    return this.commitSource(text, isolated, from, to, this.beforePlainInput)
  }

  /**
   * Takes typed source without parsing it. Parsing, preservation and replacing
   * the formatted document cost as much as a document load, so they wait for
   * the next thing that needs them.
   */
  private deferSource(
    text: string,
    from: number | undefined,
    to: number | undefined,
    native: boolean,
    closed: boolean,
  ): boolean {
    if (text === this.currentText()) return false
    const length =
      from === undefined ? text.replace(/\r\n?/g, '\n').length : from
    const now = Date.now()
    const previous = this.pendingSource
    const continuing =
      previous &&
      !previous.closed &&
      !closed &&
      now - this.lastSourceInput <= sourceGroupDelay
    if (previous && !continuing) this.rememberTypedStep(previous)
    this.formattedRedoLimit = 0
    this.lastSourceInput = now
    this.undoneSteps = []
    this.formattedUndone = 0
    const pending: TypedSource = {
      text,
      from: length,
      to: to ?? length,
      before: (continuing ? previous.before : undefined) ??
        this.beforePlainInput ?? {
          from: this.plain.selectionStart,
          to: this.plain.selectionEnd,
        },
      closed,
    }
    this.pendingSource = pending
    this.session.changed()
    this.cancelExports()
    this.literalMatch = undefined
    // Text that did not come from the textarea is shown there.
    if (!native) this.showTypedSource(pending.text, pending.from, pending.to)
    if (text !== this.lastMarkdown) {
      this.lastMarkdown = text
      this.events.changed(this.changeSnapshot(text))
    }
    this.publishCommandState()
    return true
  }

  private rememberTypedStep(step: TypedSource): void {
    this.typedSteps.push(step)
    if (this.typedSteps.length > sourceStepLimit) this.typedSteps.shift()
  }

  private showTypedSource(text: string, from: number, to: number): void {
    this.plain.value = text
    this.plain.setSelectionRange(
      Math.min(from, this.plain.value.length),
      Math.min(to, this.plain.value.length),
    )
    this.revealLiteralSelection()
  }

  /**
   * Undoes or redoes typed source that the formatted document has not taken
   * in, on the text alone. Returns whether there was a step to take.
   */
  private stepTypedSource(direction: 'undo' | 'redo'): boolean {
    const current = this.pendingSource
    let text: string, from: number, to: number
    if (direction === 'undo') {
      if (!current) return false
      this.undoneSteps.push(current)
      this.pendingSource = this.typedSteps.pop()
      text = this.pendingSource?.text ?? this.currentText()
      ;({ from, to } = current.before)
    } else {
      const next = this.undoneSteps.pop()
      if (!next) return false
      if (current) this.rememberTypedStep(current)
      this.pendingSource = next
      text = next.text
      ;({ from, to } = next)
    }
    this.lastSourceInput = 0
    this.session.changed()
    this.cancelExports()
    this.literalMatch = undefined
    this.showTypedSource(text, from, to)
    if (text !== this.lastMarkdown) {
      this.lastMarkdown = text
      this.events.changed(this.changeSnapshot(text))
    }
    this.publishCommandState()
    return true
  }

  /** Brings the formatted document up to the source that was typed. */
  private settleSource(): void {
    const pending = this.pendingSource
    if (!pending) return
    const steps = this.typedSteps,
      undone = this.undoneSteps
    this.pendingSource = undefined
    this.typedSteps = []
    this.undoneSteps = []
    this.syncingSource = true
    try {
      if (
        this.commitSource(
          pending.text,
          // A step of its own, whatever edit follows within the group delay.
          true,
          pending.from,
          pending.to,
          steps[0]?.before ?? pending.before,
        )
      ) {
        const { doc } = this.editor.ctx.get(editorViewCtx).state
        const applied = doc.attrs[sourceAttribute] as SourceProvenance | null
        // A plugin that refuses the change must not lose what was typed.
        if (applied?.text !== pending.text)
          throw new InkKitError(
            'preservation',
            'The typed source could not be applied',
          )
        this.sourceTexts.set(doc, pending.text)
      }
    } catch (error) {
      this.pendingSource = pending
      this.typedSteps = steps
      this.undoneSteps = undone
      throw error
    } finally {
      this.syncingSource = false
    }
  }

  private commitSource(
    text: string,
    isolated: boolean,
    from: number | undefined,
    to: number | undefined,
    before: { from: number; to: number } | undefined,
  ): boolean {
    if (text === this.currentText()) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const normalizedLength = text.replace(/\r\n?/g, '\n').length
    const provenance: SourceProvenance = Object.freeze({
      text,
      format: this.formatType,
      from: from ?? normalizedLength,
      to: to ?? from ?? normalizedLength,
    })
    let parsed: ProseNode
    try {
      if (this.formatType === 'txt')
        parsed = view.state.schema.topNodeType.create(
          null,
          view.state.schema.nodes.paragraph!.create(
            null,
            text ? view.state.schema.text(text) : undefined,
          ),
        )
      else {
        const preservation = new Preservation(this.editor.ctx, text)
        this.sourcePreservations.set(provenance, preservation)
        parsed = preservation.baseline
      }
    } catch (error) {
      throw coded(error, 'preservation')
    }
    if (this.literalSurface) {
      const previous: SourceProvenance = Object.freeze({
        text: this.currentText(),
        format: this.formatType,
        from: before?.from ?? this.plain.selectionStart,
        to: before?.to ?? this.plain.selectionEnd,
      })
      // History must retain the source caret even when the formatted document has no corresponding position.
      this.loading = true
      try {
        view.dispatch(
          view.state.tr
            .setDocAttribute(sourceAttribute, previous)
            .setMeta('addToHistory', false),
        )
      } finally {
        this.loading = false
      }
    }
    let tr = view.state.tr
      .replaceWith(0, view.state.doc.content.size, parsed.content)
      .setDocAttribute(sourceAttribute, provenance)
      .setMeta(sourceReplacement, true)
    tr.setSelection(terminalSelection(tr.doc))
    if (isolated) tr = closeHistory(tr)
    view.dispatch(tr)
    if (isolated)
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
    return true
  }

  /** Returns whether a history step applied. */
  undo(expectedGeneration?: number): boolean {
    this.assertMutation(expectedGeneration)
    if (this.literalSurface && this.stepTypedSource('undo')) return true
    const view = this.editor.ctx.get(editorViewCtx)
    const undone =
      (!this.literalSurface &&
        undoSmartPunctuation(view.state, view.dispatch)) ||
      this.stepFormattedHistory('undo')
    if (undone) {
      // Source steps that were undone come back after the formatted ones.
      if (this.literalSurface && this.undoneSteps.length) this.formattedUndone++
      else this.undoneSteps = []
    }
    return undone
  }

  /** Returns whether a history step applied. */
  redo(expectedGeneration?: number): boolean {
    this.assertMutation(expectedGeneration)
    const view = this.editor.ctx.get(editorViewCtx)
    if (this.literalSurface) {
      if (this.formattedUndone > 0) {
        if (this.formattedRedoLimit !== 0 && redoHistory(view.state)) {
          const redone = this.stepFormattedHistory('redo')
          if (redone) this.formattedUndone--
          return redone
        }
        this.formattedUndone = 0
      }
      if (this.stepTypedSource('redo')) return true
      // Typing after an undo ended the formatted history's redo steps.
      if (this.pendingSource) return false
    }
    return this.stepFormattedHistory('redo')
  }

  private stepFormattedHistory(direction: 'undo' | 'redo'): boolean {
    if (direction === 'redo' && this.formattedRedoLimit === 0) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const before = view.state
    const previous = this.historyDirection
    this.historyDirection = direction
    try {
      const command = direction === 'undo' ? undoHistory : redoHistory
      command(before, view.dispatch)
      // A history command can return true even if dispatch refused its edit.
      return view.state !== before
    } finally {
      this.historyDirection = previous
    }
  }

  private replaceLiteralSelection(
    text: string,
    isolated = true,
    retainEndings = false,
  ): void {
    const value = this.plain.value
    const start = this.plain.selectionStart,
      end = this.plain.selectionEnd
    const next =
      value.slice(0, start) + text.replace(/\r\n?/g, '\n') + value.slice(end)
    const caret = start + text.replace(/\r\n?/g, '\n').length
    const previous = this.currentText()
    const source = retainEndings
      ? previous.slice(0, rawOffset(previous, start)) +
        text +
        previous.slice(rawOffset(previous, end))
      : editedPlainSource(previous, next)
    this.applySource(source, isolated, caret, caret)
  }

  /** The complete current text, which is what a host saves. It throws rather than return partial
   *  text. */
  snapshot(expectedGeneration?: number): DocumentSnapshot {
    this.assertCurrent(expectedGeneration)
    const text = this.currentText()
    return {
      ...this.session.version(),
      format: this.formatType,
      text,
      dirty: text !== this.originalSource,
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
    const doc = this.exportDocument(snapshot.text)
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

  /**
   * The document to export. Source typed in the source editor has not reached
   * the formatted document, which would merge its undo steps, so a document
   * read from the text stands in without touching history.
   */
  private exportDocument(text: string): ProseNode {
    const { doc } = this.editor.ctx.get(editorViewCtx).state
    return this.pendingSource && this.formatType === 'md'
      ? this.editor.ctx.get(parserCtx)(text)
      : doc
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
    if (this.formatType === 'txt') {
      const text = all
        ? snapshot.text
        : snapshot.text.slice(
            rawOffset(snapshot.text, this.plain.selectionStart),
            rawOffset(snapshot.text, this.plain.selectionEnd),
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
        ? this.exportDocument(snapshot.text)
        : this.editor.ctx.get(editorViewCtx).state.doc
    const selectedSource =
      !all && this.mode === 'source'
        ? sourceSelection(
            snapshot.text,
            this.plain.selectionStart,
            this.plain.selectionEnd,
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
            ? new Preservation(this.editor.ctx, snapshot.text).serialize(
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
        this.mode === 'source' && this.formatType === 'md'
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
      this.replaceLiteralSelection(text, true, this.formatType === 'md')
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
        const marks =
          view.state.storedMarks ??
          (view.state.selection.empty
            ? view.state.selection.$from.marks()
            : view.state.selection.$from.marksAcross(
                view.state.selection.$to,
              )) ??
          []
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
    this.pendingSource = undefined
    this.typedSteps = []
    this.undoneSteps = []
    this.formattedUndone = 0
    this.formattedRedoLimit = undefined
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
    this.plain.remove()
    await this.editor.destroy()
    if (this.ownsRootClass) this.root.classList.remove('inkkit-root')
  }

  // The app's bindings, replaced whole whenever they change; the plugin stays.
  private keymapPlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('appKeymap'),
        props: {
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

  private copySourceSelection(event: ClipboardEvent): void {
    event.preventDefault()
    event.stopPropagation()
    try {
      const snapshot = this.snapshot()
      const from = this.plain.selectionStart,
        to = this.plain.selectionEnd
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
              this.plain.setSelectionRange(from, to)
              this.replaceLiteralSelection('')
            }
          })
          .catch((error) => this.report(error))
      } else {
        const output = clipboardContent(parsed.content, parsed.type.schema)
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
        if (cut) this.replaceLiteralSelection('')
      }
    } catch (error) {
      this.report(error)
    }
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
    instance.editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(authoredSourcesCtx.key, (doc, positions) =>
          instance.authoredSources(doc, positions),
        )
        ctx.set(
          smartPunctuationCtx.key,
          () => instance.inputPreferences.smartPunctuation === true,
        )
        ctx.update(labelsCtx.key, () => ({
          ...defaultLabels,
          ...options.labels,
        }))
        ctx.set(codeControlCtx.key, (operation) =>
          instance.forPerson(
            () =>
              instance.facadeCall(() => {
                instance.assertMutation()
                return !instance.literalSurface && operation()
              }),
            false,
          ),
        )
        ctx.set(tableControlCtx.key, (operation) =>
          instance.forPerson(
            () =>
              instance.facadeCall(() => {
                instance.assertMutation()
                return !instance.literalSurface && operation()
              }),
            false,
          ),
        )
        ctx.set(defaultValueCtx, '')
        ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
        // The preset also binds Mod-[ and Mod-] here; the app uses those for back and forward.
        // Shift-Tab is bound to liftItem instead.
        ctx.update(listItemKeymap.key, (keys) => ({
          ...keys,
          SinkListItem: { shortcuts: 'Tab' },
          LiftListItem: { shortcuts: [] },
        }))
        // Formatting keys are the app's to set, through setKeymap; the presets' own go.
        const unbind = <K extends string>(
          keymap: $UserKeymap<string, K>,
          keep: K[] = [],
        ) =>
          ctx.update(keymap.key, (keys) => {
            const cleared = { ...keys }
            for (const name of Object.keys(cleared) as K[]) {
              if (!keep.includes(name)) cleared[name] = { shortcuts: [] }
            }
            return cleared
          })
        unbind(tableKeymap, ['NextCell', 'PrevCell'])
        unbind(historyKeymap)
        unbind(strongKeymap)
        unbind(emphasisKeymap)
        unbind(inlineCodeKeymap)
        unbind(strikethroughKeymap)
        unbind(highlightKeymap)
        unbind(headingKeymap, ['DowngradeHeading'])
        unbind(paragraphKeymap)
        unbind(blockquoteKeymap)
        unbind(codeBlockKeymap)
        unbind(bulletListKeymap)
        unbind(orderedListKeymap)
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          dispatchTransaction: function (this: EditorView, tr) {
            // A call whose edit was refused changes nothing more; it throws when it returns.
            if (instance.call?.refusal && tr.docChanged) return
            for (const node of tr.getMeta(carriedBlocks) ?? [])
              (instance.carried ??= new WeakSet()).add(node)
            instance.suggestions?.beforeTransaction(tr)
            const base = instance.suggestionBase ?? this.state
            const applied = base.applyTransaction(tr)
            let next = applied.state
            if (!instance.loading) {
              const check = (doc: ProseNode) => {
                if (!instance.literalSurface)
                  assertHiddenCommentsKept(base, tr, doc)
                instance.assertPreserved(this.state.doc, doc, isWrittenEdit(tr))
              }
              try {
                try {
                  check(next.doc)
                } catch (error) {
                  // Reading a literal block again never adds a refusal: the
                  // edit is then made as it would be without that.
                  if (
                    !applied.transactions.some((step) =>
                      step.getMeta(literalRereadKey),
                    )
                  )
                    throw error
                  next = base.apply(tr.setMeta(literalRereadKey, 'skip'))
                  check(next.doc)
                }
              } catch (error) {
                this.updateState(this.state)
                instance.refuse(
                  new InkKitError(
                    'preservation',
                    `The edit was not applied because its Markdown could not be preserved: ${error instanceof Error ? error.message : String(error)}`,
                    { cause: error },
                  ),
                )
                return
              }
            }
            if (instance.formattedRedoLimit !== undefined) {
              const depth = redoDepth(next)
              if (depth === 0) instance.formattedRedoLimit = undefined
              else if (next !== this.state) {
                if (instance.historyDirection === 'undo')
                  instance.formattedRedoLimit = Math.min(
                    depth,
                    instance.formattedRedoLimit + 1,
                  )
                else if (instance.historyDirection === 'redo')
                  instance.formattedRedoLimit = Math.max(
                    0,
                    instance.formattedRedoLimit - 1,
                  )
              }
            }
            this.updateState(next)
          },
          handleScrollToSelection: () => {
            if (!instance.loading && instance.ready)
              instance.revealCurrentSelection()
            return true
          },
        }))
      })
      .use(labelsCtx)
      .use(instance.pasteController.plugin)
      .use(visibleClipboard)
      .use($prose(() => instance.suggestions!.plugin()))
      .use(instance.keymapPlugin)
      .use(
        createDialect(
          Boolean(options.images || options.files),
          Boolean(options.wikiLinks),
          Boolean(options.files),
        ),
      )
      .use(codeControlCtx)
      .use(codeControlsPlugin(() => instance.viewport().rect))
      .use(tablePlugins)
      .use(tableBlock)
      .use(instance.changePlugin)
      .use(instance.historyInputPlugin)
      .use(history)
      .use(clipboard)
      .use(cursor)
      .use(taskListPlugin)
      .use(quoteBackspace)
      .use(calloutEnter)
      .use(literalEnter)
      .use(literalReread)
      .use(listItemBackspace)
      .use(listItemShiftTab)
      .use(nestedItemEnter)
      .use(rejoinLists)
      .use(movedListItems)
      .use(textInputPolicy)
      .use(events.copy ? codeCopyPlugin((text) => events.copy?.(text)) : [])
      .use(placeholderPlugin)
      .use(
        options.rendering?.codeHighlighting === false
          ? []
          : (await import('./highlight.js')).highlightPlugin,
      )
      .use(
        options.rendering?.diagramPreview === false || !diagramsAvailable()
          ? []
          : mermaidPreview((error) => instance.report(error)),
      )
      .use(selectionPlugin)
      .use($prose(() => search()))
      .use(instance.policyPlugin)
      .use(
        options.wikiLinks
          ? wikiLinkView(options.wikiLinks, {
              capture: () => instance.adapterCapture(),
              active: () =>
                instance.ready &&
                !instance.destroyed &&
                !instance.literalSurface,
              labels: { ...defaultLabels, ...options.labels },
              error: (error) => instance.report(error),
            })
          : [],
      )
      .use(
        options.images || options.files
          ? imageView(
              options.images,
              options.files
                ? {
                    adapter: options.files,
                    capture: () => instance.adapterCapture(),
                    active: () =>
                      instance.ready &&
                      !instance.destroyed &&
                      !instance.literalSurface,
                    labels: { ...defaultLabels, ...options.labels },
                    error: (error) => instance.report(error),
                  }
                : undefined,
              () => {
                try {
                  instance.assertMutation()
                  return true
                } catch {
                  return false
                }
              },
            )
          : [],
      )
      .create()
    configureTableMovement(instance.editor.ctx, () => {
      try {
        instance.assertCurrent()
        return instance.writable && !instance.literalSurface
      } catch {
        return false
      }
    })
    instance.plain = document.createElement('textarea')
    instance.plain.className = 'inkkit-plain'
    instance.plain.setAttribute('aria-label', 'Plain text editor')
    instance.plain.hidden = true
    root.append(instance.plain)
    instance.plain.addEventListener('beforeinput', (event) => {
      if (!instance.writable) {
        event.preventDefault()
        return
      }
      if (instance.ready && instance.literalSurface)
        instance.beforePlainInput = {
          from: instance.plain.selectionStart,
          to: instance.plain.selectionEnd,
        }
    })
    instance.plain.addEventListener('input', () => {
      if (!instance.ready || !instance.literalSurface) return
      if (!instance.writable) {
        instance.plain.value = instance.currentText()
        return
      }
      try {
        instance.applySource(
          editedPlainSource(instance.currentText(), instance.plain.value),
          false,
          instance.plain.selectionStart,
          instance.plain.selectionEnd,
          true,
        )
      } catch (error) {
        instance.report(error)
      } finally {
        instance.beforePlainInput = undefined
      }
    })
    instance.plain.addEventListener('keydown', (event) => {
      if (instance.plainComposing) return
      if (instance.literalKeys(instance.editor.ctx.get(editorViewCtx), event))
        event.preventDefault()
    })
    for (const event of ['select', 'keyup', 'click'])
      instance.plain.addEventListener(event, () =>
        instance.publishCommandState(),
      )
    instance.plain.addEventListener('paste', (event) => {
      if (!instance.writable) {
        event.preventDefault()
        return
      }
      if (!event.clipboardData) return
      event.preventDefault()
      void instance
        .paste({
          text: event.clipboardData.getData('text/plain'),
          html: event.clipboardData.getData('text/html'),
          markdown: event.clipboardData.getData('text/markdown') || undefined,
        })
        .catch((error) => instance.report(error))
    })
    instance.plain.addEventListener('compositionstart', () => {
      instance.plainComposing = true
      instance.publishCommandState()
    })
    instance.plain.addEventListener('compositionend', () => {
      instance.plainComposing = false
      instance.publishCommandState()
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
      // link-safety.ts.
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
      if (instance.formatType === 'txt') return
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
          const output = clipboardContent(content, view.state.schema)
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
      preservation = new Preservation(this.editor.ctx, markdown)
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
    this.sourcePreservations = new WeakMap()
    this.sourceTexts = new WeakMap()
    this.pendingSource = undefined
    this.typedSteps = []
    this.undoneSteps = []
    this.formattedUndone = 0
    this.formattedRedoLimit = undefined
    this.mode = 'formatted'
    this.plainComposing = false
    this.beforePlainInput = undefined
    this.plainSearch = ''
    this.literalMatch = undefined
    this.formatType = input.format
    this.plain.value = input.text
    this.plain.setSelectionRange(
      this.plain.value.length,
      this.plain.value.length,
    )
    this.load(markdown, preservation)
    this.originalSource = input.text
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
    if (active === this.plain) {
      this.plain.blur()
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
    const previousFormat = this.formatType
    const selectedNode =
      !wasLiteral && view.state.selection instanceof NodeSelection
        ? view.state.selection.node
        : undefined
    const at = wasLiteral
      ? this.plain.selectionStart
      : view.state.selection.anchor
    const end = wasLiteral ? this.plain.selectionEnd : view.state.selection.head
    const direction = this.plain.selectionDirection
    const container = this.viewportContainer ?? this.root
    const top = container.scrollTop,
      left = container.scrollLeft
    const focused = wasLiteral
      ? document.activeElement === this.plain
      : view.hasFocus()
    const plainTop = this.plain.scrollTop,
      plainLeft = this.plain.scrollLeft
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
        this.plain.setSelectionRange(
          Math.min(at, this.plain.value.length),
          Math.min(end, this.plain.value.length),
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
        if (this.literalSurface) this.plain.focus({ preventScroll: true })
        else view.focus()
      }
      container.scrollTop = top
      container.scrollLeft = left
      if (wasLiteral && this.literalSurface) {
        this.plain.scrollTop = plainTop
        this.plain.scrollLeft = plainLeft
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
      const plain = this.plain.getBoundingClientRect()
      const literalLeft = Math.max(
        rect.left,
        plain.left + this.plain.clientLeft,
      )
      const literalTop = Math.max(rect.top, plain.top + this.plain.clientTop)
      rect = textRect({
        left: literalLeft,
        top: literalTop,
        right: Math.max(
          literalLeft,
          Math.min(
            rect.right,
            plain.left + this.plain.clientLeft + this.plain.clientWidth,
          ),
        ),
        bottom: Math.max(
          literalTop,
          Math.min(
            rect.bottom,
            plain.top + this.plain.clientTop + this.plain.clientHeight,
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
        container.scrollTop + (this.literalSurface ? this.plain.scrollTop : 0),
      scrollLeft:
        container.scrollLeft +
        (this.literalSurface ? this.plain.scrollLeft : 0),
    })
  }

  private readableScope(): NonNullable<InkKitEditor['textScope']> {
    const { key } = this.session.capture()
    if (this.textScope?.key !== key)
      this.textScope = {
        key,
        id: `${this.textIdentity}:${key}`,
        projection: this.literalSurface
          ? { text: this.plain.value, spans: [] }
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
      format: this.formatType,
      mode: this.editingMode,
      text: scope.projection.text,
      selection: Object.freeze({
        snapshotId: scope.id,
        from: this.literalSurface
          ? this.plain.selectionStart
          : projectionOffset(scope.projection, selection.from),
        to: this.literalSurface
          ? this.plain.selectionEnd
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
    if (this.literalSurface) this.plain.setSelectionRange(range.from, range.to)
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
      if (this.literalSurface) this.plain.focus({ preventScroll: true })
      else this.editor.ctx.get(editorViewCtx).focus()
    }
    if (reveal) this.revealTextRange(range)
    this.publishCommandState()
  }

  /** Whether two documents are the same note. A move of blocks that read alike, such as a setext
   *  heading and the same heading written with `#`, gives an equal document with other source. */
  private sameDocument(after: ProseNode, before: ProseNode): boolean {
    if (after === before) return true
    if (!after.eq(before)) return false
    if (!this.carried || !this.preservation) return true
    try {
      return this.currentText(after) === this.currentText(before)
    } catch {
      return false
    }
  }

  /** Throws when a document reached by an edit, after every appended normalisation, cannot be
   *  saved as preserved Markdown. Dispatch and the replacement commands share this check.
   *  `written` is false for history steps and source replacement, which restore or supply a
   *  document that may hold comment text the formatted editor would refuse to accept typed. */
  private assertPreserved(
    before: ProseNode,
    after: ProseNode,
    written = true,
  ): void {
    if (this.literalSurface || this.sameDocument(after, before)) return
    if (written) assertCommentsEndWhereWritten(before, after)
    if (this.preservation) this.currentText(after)
  }

  /** Replaces `range` with literal text as one undo step. Returns whether the text changed. */
  replaceTextRange(range: TextRange, text: string): boolean {
    this.assertAlive()
    expectString(text, 'text')
    const projection = this.validateTextRange(range)
    this.assertMutation()
    if (this.literalSurface) {
      const raw = this.currentText()
      const from = rawOffset(raw, range.from),
        to = rawOffset(raw, range.to)
      const ending = /\r\n|\r|\n/.exec(raw)?.[0] ?? '\n'
      const value = text.replace(/\r\n?/g, '\n')
      const replaced =
        raw.slice(0, from) + value.replaceAll('\n', ending) + raw.slice(to)
      return this.applySource(
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
      this.assertPreserved(view.state.doc, view.state.apply(tr).doc),
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
      ? literalRangesRects(this.plain, ranges)
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
        literalVisibleRanges(this.plain, viewport).map((range) =>
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
        this.plain,
      )
      // The first or last line sits within the padding plus its own leading,
      // under half the height of its first rect, so a reveal that ends there
      // shows the edge. A range of many lines does not count as one line.
      const halfCaret = (leading.bottom - leading.top) / 2
      const remaining = scrollWholePixels(this.plain, vertical, horizontal, {
        top: (Number.parseFloat(style.paddingTop) || 0) + halfCaret,
        bottom: (Number.parseFloat(style.paddingBottom) || 0) + halfCaret,
      })
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
      literalRangesRects(this.plain, [
        {
          from: this.plain.selectionStart,
          to: this.plain.selectionEnd,
        },
      ])[0]!,
    )
  }

  private load(markdown: string, preservation: Preservation): void {
    this.localCopies.clear()
    this.originalSource = markdown
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
    this.preservation = preservation
    this.carried = undefined
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
          ? this.plain.selectionEnd
          : this.plain.selectionStart
      const raw = this.currentText()
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
        this.plain.setSelectionRange(displayedFrom, displayedTo)
        this.literalMatch = {
          ...match,
          query: text,
          displayedFrom,
          displayedTo,
          version: this.session.capture(),
        }
      } else if (this.plainSearch)
        this.plain.setSelectionRange(
          this.plain.selectionEnd,
          this.plain.selectionEnd,
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
      const raw = this.currentText()
      const remembered = this.literalMatch
      const selection =
        remembered &&
        remembered.query === search &&
        remembered.version.isCurrent() &&
        remembered.displayedFrom === this.plain.selectionStart &&
        remembered.displayedTo === this.plain.selectionEnd
          ? { from: remembered.from, to: remembered.to }
          : {
              from: rawOffset(raw, this.plain.selectionStart),
              to: rawOffset(raw, this.plain.selectionEnd),
            }
      if (remembered?.query !== search) this.literalMatch = undefined
      const result = replaceLiteral(raw, search, replacement, selection, all)
      if (result.count)
        this.applySource(
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
      (tr) => this.assertPreserved(view.state.doc, view.state.apply(tr).doc),
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
    if (this.formatType === 'txt') return Object.freeze([])
    return this.mode === 'source'
      ? collectSourceHeadings(
          this.editor.ctx,
          this.plain.value,
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
    if (this.formatType === 'txt')
      throw new InkKitError(
        'stale-document',
        'The heading is no longer current',
      )
    if (this.mode === 'source') {
      const position = sourceHeadingPosition(
        this.editor.ctx,
        this.plain.value,
        heading,
        this.outlineContext(),
      )
      this.plain.setSelectionRange(position, position)
      this.plain.focus({ preventScroll: true })
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
        ? this.plainComposing
        : this.editor.ctx.get(editorViewCtx).composing) &&
      generation === this.generation
    )
      return false
    this.assertMutation(generation)
    if (this.literalSurface) {
      this.replaceLiteralSelection(text, false)
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
      if (['Enter', 'Tab', 'Backspace', 'Delete'].includes(key))
        this.assertMutation(generation)
      this.readOnlyKeys(this.editor.ctx.get(editorViewCtx), event)
    }
    if (this.literalSurface) {
      if (this.literalKeys(this.editor.ctx.get(editorViewCtx), event))
        return true
      if (metaKey || ctrlKey || altKey) return false
      if (key === 'Enter' || key === 'Tab') {
        this.replaceLiteralSelection(key === 'Enter' ? '\n' : '\t', false)
        return true
      }
      if (key === 'Backspace' || key === 'Delete') {
        const start = this.plain.selectionStart,
          end = this.plain.selectionEnd
        if (start === end) {
          if (key === 'Backspace' && start > 0)
            this.plain.setSelectionRange(
              start - [...this.plain.value.slice(0, start)].at(-1)!.length,
              end,
            )
          else if (key === 'Delete' && end < this.plain.value.length)
            this.plain.setSelectionRange(
              start,
              end + [...this.plain.value.slice(end)][0]!.length,
            )
          else return false
        }
        this.replaceLiteralSelection('', false)
        return true
      }
      return false
    }
    const view = this.editor.ctx.get(editorViewCtx)
    return Boolean(
      view.someProp('handleKeyDown', (handler) => handler(view, event)),
    )
  }

  focus(expectedGeneration?: number): void {
    this.assertReady(expectedGeneration)
    if (this.literalSurface) this.plain.focus()
    else this.editor.ctx.get(editorViewCtx).focus()
  }

  /** Moves focus off InkKit's text surfaces. Focus anywhere else, such as in a host control or a
   *  control InkKit draws, is left alone. */
  blur(expectedGeneration?: number): void {
    this.assertReady(expectedGeneration)
    this.releaseFocus()
  }

  /** Replaces every binding. Keys are in ProseMirror's notation. A key given to two shortcuts goes
   *  to the later one, in the order history, formatting, block moves, tables, so it lands the same
   *  way every time. A table binding passes a key it shares with a block move to the move outside
   *  a table. */
  setKeymap(keymap: Keymap): void {
    this.assertAlive()
    keymap = keymapBindings(keymap, 'keymap')
    this.configuredKeys = {
      undo: ['Mod-z'],
      redo: ['Mod-y', 'Shift-Mod-z'],
      moveBlockUp: ['Alt-ArrowUp'],
      moveBlockDown: ['Alt-ArrowDown'],
      tableExit: ['Mod-Enter', 'Enter'],
      ...keymap,
    }
    const bindings: Record<string, Command> = {}
    // Consuming unbound history keys prevents the browser's separate undo stack
    // from changing source/TXT outside the shared document history.
    const historyBindings: Record<string, Command> = Object.fromEntries(
      ['Mod-z', 'Mod-y', 'Shift-Mod-z'].map((key) => [key, () => true]),
    )
    for (const name of ['undo', 'redo'] as const) {
      for (const key of this.configuredKeys[name] ?? []) {
        historyBindings[key] = () => {
          if (!this.ready || !this.commandState().commands[name]) return true
          return this.forPerson(() => this[name](), true)
        }
      }
    }
    Object.assign(bindings, historyBindings)
    for (const name of formatShortcuts) {
      for (const key of keymap[name] ?? []) {
        bindings[key] = () => {
          if (!this.ready || !this.commandState().commands.format[name])
            return true
          this.forPerson(() => this.format(name), false)
          return true
        }
      }
    }
    const moves: Record<string, Command> = {}
    for (const [name, direction] of [
      ['moveBlockUp', 'up'],
      ['moveBlockDown', 'down'],
    ] as const) {
      for (const key of this.configuredKeys[name] ?? []) {
        moves[key] = bindings[key] = (state) => {
          // In a table, and when nothing can be edited, the key goes on to the
          // table's own bindings and the web view, which moves the caret.
          if (!this.ready || !this.writable || this.literalSurface) return false
          const move = blockMove(state, direction)
          if (!move) return false
          if (
            move === 'move' &&
            !this.composing &&
            !this.pasteController.pending
          )
            this.forPerson(() => this.moveBlock(direction), false)
          return true
        }
      }
    }
    for (const command of tableCommands) {
      for (const key of this.configuredKeys[tableShortcut(command)] ?? [])
        bindings[key] = (state, dispatch, view) => {
          if (!this.ready || !this.commandState().commands.table[command])
            return moves[key]?.(state, dispatch, view) ?? false
          return this.forPerson(() => this.table(command), true)
        }
    }
    this.readOnlyKeys = keydownHandler(
      Object.fromEntries(
        Object.keys(bindings)
          // A block move key is a caret key while nothing can be edited.
          .filter((key) => !moves[key])
          .map((key) => [
            key,
            () => {
              throw new InkKitError('read-only', 'The editor is read-only')
            },
          ]),
      ),
    )
    this.keys = keydownHandler(bindings)
    this.literalKeys = keydownHandler(historyBindings)
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
    const { schema } = view.state
    const placement = point ? undefined : imagePlacement(view.state)
    if (placement?.kind === 'inline') {
      this.insertInline(images)
      return true
    }
    // One paragraph per image: each is read back as a standalone image block where one fits.
    const blocks = images.map((image) =>
      schema.nodes.paragraph!.create(
        null,
        schema.nodes.image!.create({
          src: image.reference,
          alt: image.alt,
          title: image.title ?? '',
        }),
      ),
    )
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

  // Removing a mark at a caret only clears the stored mark, so the whole marked
  // run is selected for the command and the caret put back after it.
  private withMarkRunSelected(mark: MarkType, command: () => void): boolean {
    const view = this.editor.ctx.get(editorViewCtx)
    const { selection, doc } = view.state
    if (!selection.empty) return false
    const $pos = selection.$from
    const parent = $pos.parent
    const start = $pos.start()
    let from = $pos.pos
    let to = $pos.pos
    parent.forEach((child, offset) => {
      const childFrom = start + offset
      const childTo = childFrom + child.nodeSize
      if (!mark.isInSet(child.marks)) return
      if (childTo >= $pos.pos && childFrom <= to) {
        from = Math.min(from, childFrom)
        to = Math.max(to, childTo)
      }
    })
    if (from === to) return false
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(doc, from, to)),
    )
    command()
    const caret = Math.min($pos.pos, view.state.doc.content.size)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)),
    )
    return true
  }

  // Milkdown's inline code command ignores a caret; a stored mark makes the
  // next typed text code, the way bold and italic behave.
  private toggleInlineCode(): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const type = inlineCodeSchema.type(this.editor.ctx)
    const run = () => {
      this.editor.action(callCommand(toggleInlineCodeCommand.key))
    }
    const { selection, storedMarks } = view.state
    if (!selection.empty) return run()
    // A pending stored mark is only that; the span next to the caret is left alone.
    if (storedMarks) {
      const tr = type.isInSet(storedMarks)
        ? view.state.tr.removeStoredMark(type)
        : view.state.tr.addStoredMark(type.create())
      return view.dispatch(tr)
    }
    if (!type.isInSet(selection.$from.marks()))
      view.dispatch(view.state.tr.addStoredMark(type.create()))
    else this.withMarkRunSelected(type, run)
  }

  private list(kind: 'bulletList' | 'orderedList'): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const { state } = view
    const { $from } = textBounds(state)
    const wanted = kind === 'bulletList' ? 'bullet_list' : 'ordered_list'
    const depth = innermostListDepth($from)
    if (depth == null) {
      const command =
        kind === 'bulletList'
          ? wrapInBulletListCommand
          : wrapInOrderedListCommand
      this.editor.action(callCommand(command.key))
      return
    }
    const list = $from.node(depth)
    if (list.type.name === wanted) {
      liftItem(state, view.dispatch)
      return
    }
    // The items carry the list kind too, and a bullet list whose items say
    // ordered is turned back into one by the preset.
    const pos = $from.before(depth)
    const ordered = wanted === 'ordered_list'
    const attrs = ordered
      ? { order: 1, spread: list.attrs.spread }
      : { spread: list.attrs.spread }
    let tr = state.tr.setNodeMarkup(pos, state.schema.nodes[wanted], attrs)
    list.forEach((item, offset) => {
      tr = tr.setNodeMarkup(pos + 1 + offset, undefined, {
        ...item.attrs,
        listType: ordered ? 'ordered' : 'bullet',
        label: ordered ? '1.' : '•',
      })
    })
    view.dispatch(tr)
  }

  private quote(): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const type = blockquoteSchema.type(this.editor.ctx)
    const { $from, $to } = textBounds(view.state)
    let range = $from.blockRange($to)
    let wrapping = range && findWrapping(range, type)
    if (!wrapping) {
      // A list item cannot hold a quote, so the whole list is quoted instead.
      const depth = outermostListDepth($from)
      if (depth == null) return
      const doc = view.state.doc
      range = new NodeRange(
        doc.resolve($from.before(depth)),
        doc.resolve($from.after(depth)),
        depth - 1,
      )
      wrapping = findWrapping(range, type)
    }
    if (!range || !wrapping) return
    view.dispatch(view.state.tr.wrap(range, wrapping))
  }

  private unquote(): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const { $from, $to } = textBounds(view.state)
    const range = $from.blockRange(
      $to,
      (node) => node.type.name === 'blockquote',
    )
    if (!range) return
    const target = liftTarget(range)
    if (target == null) return
    view.dispatch(view.state.tr.lift(range, target))
  }

  /** Changes the selected textblocks' type, keeping everything they hold. */
  private textblockType(
    type: 'paragraph' | 'heading' | 'codeBlock',
    attr?: string | number,
  ): Command {
    const ctx = this.editor.ctx
    if (type === 'codeBlock')
      return setTextblockType(ctx, codeBlockSchema.type(ctx), {
        language: String(attr ?? ''),
      })
    if (type === 'heading')
      return setTextblockType(ctx, headingSchema.type(ctx), {
        level: Number(attr),
      })
    return setTextblockType(ctx, paragraphSchema.type(ctx))
  }

  /**
   * The authored Markdown of the textblocks at `positions`, found by saving
   * the document once with each block's content replaced by a numbered mark
   * no one writes. The saved text between the marks is the current text
   * between those blocks, so what lies between the same pieces of the current
   * text is each block's source.
   */
  private authoredSources(
    doc: ProseNode,
    positions: readonly number[],
  ): Map<number, string> {
    const none = new Map<number, string>()
    if (this.literalSurface || !positions.length) return none
    try {
      let marked = doc
      // Positions are in document order, so marking the last first leaves
      // the earlier ones where they are.
      for (let index = positions.length - 1; index >= 0; index--) {
        const pos = positions[index]!
        const node = doc.nodeAt(pos)
        if (!node?.isTextblock) return none
        marked = marked.replace(
          pos + 1,
          pos + node.nodeSize - 1,
          new Slice(
            Fragment.from(doc.type.schema.text(`\uE000${index}\uE001`)),
            0,
            0,
          ),
        )
      }
      const text = this.currentText(doc)
      const pieces = this.currentText(marked).split(/\uE000(\d+)\uE001/)
      // Pieces alternate between saved text and a mark's number.
      if (pieces.length !== positions.length * 2 + 1) return none
      for (let index = 0; index < positions.length; index++)
        if (pieces[index * 2 + 1] !== String(index)) return none
      const first = pieces[0]!
      const last = pieces.at(-1)!
      if (!text.startsWith(first) || !text.endsWith(last)) return none
      const found = new Map<number, string>()
      let cursor = first.length
      const end = text.length - last.length
      for (let index = 0; index < positions.length; index++) {
        const lastBlock = index + 1 === positions.length
        const next = lastBlock ? '' : pieces[index * 2 + 2]!
        // Saved text always separates two blocks.
        if (!lastBlock && !next) return none
        const at = lastBlock ? end : text.indexOf(next, cursor)
        if (at < 0 || at > end) return none
        found.set(positions[index]!, text.slice(cursor, at))
        cursor = at + next.length
      }
      return cursor === end ? found : none
    } catch {
      return none
    }
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
    try {
      const result = command.action(this.context())
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
      if (result instanceof Promise)
        result.then(insert).catch((error) => {
          if (this.destroyed) return
          this.report(error)
        })
      else insert(result)
    } catch (error) {
      this.report(error)
    }
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
    const run = (cmd: Parameters<typeof callCommand>[0], payload?: unknown) =>
      this.editor.action(callCommand(cmd, payload))
    const state = caretState(before)
    const become = (
      type: 'paragraph' | 'heading' | 'codeBlock',
      attr?: string | number,
    ) => this.textblockType(type, attr)(view.state, view.dispatch)
    const level = headingLevel(command)
    if (level != null) {
      if (state.block.type === 'heading' && state.block.level === level)
        become('paragraph')
      else become('heading', level)
    }
    switch (command) {
      case 'paragraph':
        become('paragraph')
        break
      case 'bold':
        run(toggleStrongCommand.key)
        break
      case 'italic':
        run(toggleEmphasisCommand.key)
        break
      case 'strikethrough':
        run(toggleStrikethroughCommand.key)
        break
      case 'highlight':
        run(toggleHighlightCommand.key)
        break
      case 'code':
        this.toggleInlineCode()
        break
      case 'codeBlock':
        if (state.block.type === 'codeBlock') become('paragraph')
        else become('codeBlock', checked?.language ?? '')
        break
      case 'quote':
        if (state.quoted) this.unquote()
        else this.quote()
        break
      case 'bulletList':
      case 'orderedList':
        this.list(command)
        break
      case 'taskList':
        toggleTaskList(this.editor.ctx)
        break
      case 'link':
        this.link(checked?.destination)
        break
    }
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
   * Refuses a link destination that is empty, that opens anything but a web, mail or phone address,
   * or that the Markdown writer cannot save so that it reads back the same.
   */
  private checkDestination(destination: string, name: string): void {
    if (destination.trim() === '')
      throw invalidArgument(`${name} must not be empty`)
    if (!isSafeLinkTarget(destination))
      throw invalidArgument(
        `${name} must be relative, or an http, https, mailto or tel address, with no control characters`,
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
    // A stored link that the caret already sits in is that link, kept when another mark was toggled.
    if (stored && !stored.isInSet(selection.$from.marks())) {
      const tr = state.tr.removeStoredMark(type)
      if (destination !== undefined)
        tr.addStoredMark(type.create({ href: destination }))
      view.dispatch(tr)
      return
    }
    const mark = type.isInSet(
      empty
        ? [...selection.$from.marks(), ...(state.doc.nodeAt(from)?.marks ?? [])]
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
      'pasteAsPlainText',
      'commandState',
      'setEditable',
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
      'insertFootnote',
      'navigateFootnote',
      'editReferenceDefinition',
      'setCommentsVisible',
      'focus',
      'blur',
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
