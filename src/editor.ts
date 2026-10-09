import {
  Editor,
  commandsCtx,
  type CmdKey,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  editorViewOptionsCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
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
  undo as undoHistory,
  redo as redoHistory,
} from '@milkdown/kit/prose/history'
import { cursor } from '@milkdown/kit/plugin/cursor'
import {
  blockquoteKeymap,
  blockquoteSchema,
  bulletListKeymap,
  codeBlockKeymap,
  createCodeBlockCommand,
  emphasisKeymap,
  headingKeymap,
  inlineCodeKeymap,
  inlineCodeSchema,
  linkSchema,
  listItemKeymap,
  orderedListKeymap,
  paragraphKeymap,
  strongKeymap,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  strikethroughKeymap,
  tableKeymap,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import {
  NodeRange,
  Fragment,
  Slice,
  type MarkType,
  type Node as ProseNode,
  type ResolvedPos,
} from '@milkdown/kit/prose/model'
import { keydownHandler, keymap } from '@milkdown/kit/prose/keymap'
import { goToNextCell } from '@milkdown/kit/prose/tables'
import { liftListItem } from '@milkdown/kit/prose/schema-list'
import type { EditorView } from '@milkdown/kit/prose/view'
import { findWrapping, liftTarget } from '@milkdown/kit/prose/transform'
import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import {
  $prose,
  callCommand,
  replaceAll,
  type $UserKeymap,
} from '@milkdown/kit/utils'
import { codeCopyPlugin, placeholderPlugin } from './decorations'
import { labelsCtx, defaultLabels, type EditorLabels } from './labels'
import { createDialect, stringifyOptions } from './dialect'
import { Preservation } from './preserve'
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
} from './references'
import {
  selectionMarkdown,
  selectionContent,
  referenceMetadata,
  withReferenceMetadata,
} from './reference-clipboard'
import { imageView } from './images'
import {
  tablePlugins,
  tableCommand,
  tableCommands,
  tableAvailability,
  tableContext,
  configureTableMovement,
  type TableCommand,
  type TableOptions,
} from './tables'
import {
  InkKitError,
  type DocumentInput,
  type DocumentSnapshot,
  type DocumentContext,
  type ImageAdapter,
  type ClipboardInput,
  type ClipboardOutput,
  type PrintableDocument,
  type TextRange,
  type ReadableTextSnapshot,
  type TextRect,
  type ViewportInsets,
  type ViewportOptions,
  type ViewportSnapshot,
} from './types'
import {
  readableProjection,
  projectionPosition,
  projectionOffset,
  validateOffsets,
  formattedRects,
  literalRects,
  literalVisibleRanges,
  intersectsViewport,
  textRect,
  type TextProjection,
} from './text-ranges'
import { highlightPlugin } from './highlight'
import { highlightKeymap, toggleHighlightCommand } from './inline-highlight'
import { commentSelectionContent, setCommentVisibility } from './comments'
import { PasteController } from './paste'
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
  type Heading,
  type OutlineContext,
} from './outline'
import { taskListPlugin, toggleTaskList } from './tasks'
import { isMermaid, mermaidPreview } from './mermaid'
import {
  hasAuthoredImagesInLiterals,
  printableMarkdown,
  printableText,
} from './print'

export type Mark =
  'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code' | 'link'

export type Block =
  | { type: 'paragraph' }
  | { type: 'heading'; level: number }
  | { type: 'codeBlock' }
  | { type: 'bulletList' }
  | { type: 'orderedList' }
  | { type: 'taskList' }

export type EditingMode = 'source' | 'formatted'

export interface CaretState {
  marks: Mark[]
  block: Block
  /** One quote holds the whole selection; the block is what sits inside it. */
  quoted: boolean
}

export type FormatCommand =
  | 'heading'
  | 'paragraph'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'highlight'
  | 'code'
  | 'codeBlock'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'link'

/** Host bindings by documented formatting, history or table shortcut name. */
export type Keymap = Record<string, string[]>

const shortcutCommands: Record<string, [FormatCommand, number?]> = {
  heading1: ['heading', 1],
  heading2: ['heading', 2],
  heading3: ['heading', 3],
  heading4: ['heading', 4],
  heading5: ['heading', 5],
  heading6: ['heading', 6],
  paragraph: ['paragraph'],
  bold: ['bold'],
  italic: ['italic'],
  strikethrough: ['strikethrough'],
  highlight: ['highlight'],
  code: ['code'],
  codeBlock: ['codeBlock'],
  quote: ['quote'],
  bulletList: ['bulletList'],
  orderedList: ['orderedList'],
  taskList: ['taskList'],
}

export interface TextInputPreferences {
  spellcheck?: boolean
  autocorrect?: boolean
  autocapitalize?: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters'
}

export interface EditorOptions {
  images?: ImageAdapter
  editable?: boolean
  textInput?: TextInputPreferences
  labels?: Partial<EditorLabels>
  keymap?: Keymap
}

export interface CommandState {
  documentId: string
  generation: number
  revision: number
  format: 'md' | 'txt'
  mode: EditingMode
  editable: boolean
  composing: boolean
  pending: boolean
  caret: CaretState
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
  }
}

export interface EditorEvents {
  changed(markdown: string, generation: number): void
  stateChanged(state: CaretState): void
  commandStateChanged?(state: CommandState): void
  openLink(href: string): void
  copy(text: string): void
  error?(error: Error): void
  clipboard?(content: ClipboardOutput): void | Promise<void>
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

// Backspace at the start of a quote's first block is left alone by the preset;
// leaving the quote is what a Backspace there means.
const quoteBackspace = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { $from, empty } = state.selection
      if (!empty || $from.parentOffset > 0 || $from.depth < 2) return false
      if (
        $from.node($from.depth - 1).type.name !== 'blockquote' ||
        $from.index($from.depth - 1) > 0
      )
        return false
      const range = $from.blockRange(
        $from,
        (node) => node.type.name === 'blockquote',
      )
      const target = range && liftTarget(range)
      if (!range || target == null) return false
      dispatch?.(state.tr.lift(range, target).scrollIntoView())
      return true
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

// A control chord that nothing handles reaches the page as its ASCII control character
// (Control-N as U+000E), which the web view would insert as text.
const controlCharacters = /^[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+$/
const dropControlCharacters = $prose(
  () =>
    new Plugin({
      key: new PluginKey('dropControlCharacters'),
      props: {
        handleTextInput: (_view, _from, _to, text) =>
          controlCharacters.test(text),
      },
    }),
)

// The listener plugin reports selection changes from inside state.apply, before
// the view holds the new state, so the caret state is read from the view instead.
function caretStatePlugin(events: EditorEvents, active = () => true) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('caretState'),
        view: () => ({
          update(view, previous) {
            if (!active()) return
            const { state } = view
            if (
              state.selection.eq(previous.selection) &&
              state.doc.eq(previous.doc) &&
              state.storedMarks === previous.storedMarks
            )
              return
            events.stateChanged(caretState(state))
          },
        }),
      }),
  )
}

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

export class InkKitEditor {
  private editor!: Editor
  private lastMarkdown = ''
  private documentId = ''
  private formatType: 'md' | 'txt' = 'md'
  private revision = 0
  private documentEpoch = 0
  private operationSequence = 0
  private plainComposing = false
  private plainSearch = ''
  private literalMatch?: {
    query: string
    from: number
    to: number
    displayedFrom: number
    displayedTo: number
    revision: number
    epoch: number
  }
  private beforePlainInput?: { from: number; to: number }
  private mode: EditingMode = 'formatted'
  private sourcePreservations = new WeakMap<SourceProvenance, Preservation>()
  private outlineEpoch = 0
  private ready = false
  private destroyed = false
  private preservation?: Preservation
  private pasteController!: PasteController
  private plain!: HTMLTextAreaElement
  private root!: HTMLElement
  private ownsRootClass = false
  private clickHandler?: (event: MouseEvent) => void
  private footnoteKeyHandler?: (event: KeyboardEvent) => void
  private copyHandler?: (event: ClipboardEvent) => void
  private originalSource = ''
  private generation = 0
  private reportingSuppressed = false
  private loading = false
  private readonly textIdentity = ++editorSequence
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
  private policyEpoch = 0
  private literalKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private configuredKeys: Keymap = {}
  private readOnlyKeys: (view: EditorView, event: KeyboardEvent) => boolean =
    () => false
  private changePlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('documentChanges'),
        view: () => ({
          update: (view, previous) => {
            if (this.loading || view.state.doc.eq(previous.doc)) return
            this.revision += 1
            this.literalMatch = undefined
            let markdown: string
            try {
              markdown = this.currentText(view.state.doc)
            } catch (error) {
              this.events.error?.(
                error instanceof Error ? error : new Error(String(error)),
              )
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
            this.events.changed(markdown, this.generation)
          },
        }),
      }),
  )
  private keys: (view: EditorView, event: KeyboardEvent) => boolean = () =>
    false

  private constructor(
    private readonly events: EditorEvents,
    private readonly options: EditorOptions,
  ) {
    this.writable = options.editable ?? true
    this.inputPreferences = { ...options.textInput }
  }

  private context(): DocumentContext {
    return {
      documentId: this.documentId,
      generation: this.generation,
      operationId: `${this.documentEpoch}:${this.generation}:${++this.operationSequence}`,
    }
  }

  private assertAlive(): void {
    if (this.destroyed)
      throw new InkKitError('destroyed', 'The editor has been destroyed')
  }

  private assertCurrent(generation = this.generation): void {
    this.assertAlive()
    if (!this.ready)
      throw new InkKitError('not-ready', 'No document has been loaded')
    if (generation !== this.generation)
      throw new InkKitError('stale-document', 'Document changed')
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

  private assertMutation(generation = this.generation): void {
    this.assertCurrent(generation)
    if (!this.writable)
      throw new InkKitError('read-only', 'The editor is read-only')
  }

  private get composing(): boolean {
    return this.literalSurface
      ? this.plainComposing
      : this.editor.ctx.get(editorViewCtx).composing
  }

  get editable(): boolean {
    this.assertAlive()
    return this.writable
  }

  setEditable(editable: boolean): void {
    this.assertAlive()
    if (this.composing)
      throw new InkKitError('composition', 'Text composition is in progress')
    if (this.writable === editable) return
    const suppressed = this.reportingSuppressed
    this.reportingSuppressed = true
    try {
      this.writable = editable
      this.policyEpoch += 1
      if (!editable) this.pasteController.cancelPending()
      this.editor.ctx
        .get(editorViewCtx)
        .dom.dispatchEvent(new Event('inkkit-cancel-resize'))
      this.applyInputPolicy()
    } finally {
      this.reportingSuppressed = suppressed
    }
    this.publishCommandState()
  }

  setTextInputPreferences(preferences: TextInputPreferences): void {
    this.assertAlive()
    if (this.composing)
      throw new InkKitError('composition', 'Text composition is in progress')
    const suppressed = this.reportingSuppressed
    this.reportingSuppressed = true
    try {
      this.inputPreferences = { ...preferences }
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
    if (
      !this.ready ||
      this.loading ||
      this.reportingSuppressed ||
      this.destroyed
    )
      return
    this.events.commandStateChanged?.(this.commandState())
  }

  commandState(expectedGeneration = this.generation): CommandState {
    this.assertAlive()
    if (!this.ready)
      throw new InkKitError('not-ready', 'No document has been loaded')
    if (expectedGeneration !== this.generation)
      throw new InkKitError('stale-document', 'Document changed')
    const view = this.editor.ctx.get(editorViewCtx)
    const { state } = view
    const mutable =
      this.writable && !this.composing && !this.pasteController.pending
    const formatted = mutable && !this.literalSurface
    const manager = this.editor.ctx.get(commandsCtx)
    const check = <T>(key: CmdKey<T>, payload?: T): boolean =>
      formatted && manager.get(key)(payload)(state)
    const format: Record<FormatCommand, boolean> = {
      heading:
        check(wrapInHeadingCommand.key, 1) || check(turnIntoTextCommand.key),
      paragraph: check(turnIntoTextCommand.key),
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
      codeBlock:
        check(createCodeBlockCommand.key, '') || check(turnIntoTextCommand.key),
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
      documentId: this.documentId,
      generation: this.generation,
      revision: this.revision,
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
        undo: mutable && undoHistory(state),
        redo: mutable && redoHistory(state),
        insertText: mutable,
        paste: mutable,
        replace: mutable,
        replaceSource: mutable,
        insertImages: formatted && !!this.options.images,
        insertPaths: mutable,
        insertFootnote: formatted,
        editReferenceDefinition:
          formatted && referenceDefinitions(state.doc).size > 0,
        format,
        table: tables,
      },
    }
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

  private policyPlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('inkkitInputPolicy'),
        filterTransaction: (tr) =>
          this.loading ||
          this.writable ||
          (!tr.docChanged && !tr.storedMarksSet),
        props: {
          editable: () => this.writable && !this.literalSurface,
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

  get editingMode(): EditingMode {
    this.assertAlive()
    return this.literalSurface ? 'source' : 'formatted'
  }

  private currentText(
    doc = this.editor.ctx.get(editorViewCtx).state.doc,
  ): string {
    const provenance = doc.attrs[sourceAttribute] as SourceProvenance | null
    if (this.formatType === 'txt')
      return provenance?.text ?? this.originalSource
    let preservation = this.preservation
    if (provenance) {
      preservation = this.sourcePreservations.get(provenance)
      if (!preservation) {
        preservation = new Preservation(this.editor.ctx, provenance.text)
        this.sourcePreservations.set(provenance, preservation)
      }
    }
    return preservation!.serialize(cleanSourceDoc(doc))
  }

  setEditingMode(mode: EditingMode, expectedGeneration?: number): boolean {
    this.assertCurrent(expectedGeneration)
    if (mode !== 'source' && mode !== 'formatted')
      throw new RangeError('Editing mode must be source or formatted')
    if (this.formatType === 'txt' || this.mode === mode) return false
    const view = this.editor.ctx.get(editorViewCtx)
    const focused = this.literalSurface
      ? this.plain.ownerDocument.activeElement === this.plain
      : view.hasFocus()
    const container = this.viewportContainer ?? this.root
    const top = container.scrollTop,
      left = container.scrollLeft
    const text = this.snapshot().text
    this.mode = mode
    this.outlineEpoch += 1
    this.plainSearch = ''
    this.literalMatch = undefined
    if (mode === 'source') {
      this.plain.value = text
      this.plain.setSelectionRange(
        this.plain.value.length,
        this.plain.value.length,
      )
    }
    const suppressed = this.reportingSuppressed
    this.reportingSuppressed = true
    try {
      this.updateSurface()
    } finally {
      this.reportingSuppressed = suppressed
    }
    if (focused) {
      if (this.literalSurface) this.plain.focus({ preventScroll: true })
      else view.focus()
    }
    container.scrollTop = top
    container.scrollLeft = left
    this.events.stateChanged(
      this.literalSurface
        ? { marks: [], block: { type: 'paragraph' }, quoted: false }
        : caretState(this.editor.ctx.get(editorViewCtx).state),
    )
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
  }

  replaceSource(text: string, expectedGeneration?: number): boolean {
    this.assertMutation(expectedGeneration)
    return this.applySource(text, true)
  }

  private applySource(
    text: string,
    isolated: boolean,
    from?: number,
    to?: number,
  ): boolean {
    if (!this.writable)
      throw new InkKitError('read-only', 'The editor is read-only')
    if (typeof text !== 'string') throw new TypeError('Source must be a string')
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
      parsed =
        this.formatType === 'txt'
          ? view.state.schema.topNodeType.create(
              null,
              view.state.schema.nodes.paragraph!.create(
                null,
                text ? view.state.schema.text(text) : undefined,
              ),
            )
          : this.editor.ctx.get(parserCtx)(text)
      if (this.formatType === 'md')
        this.sourcePreservations.set(
          provenance,
          new Preservation(this.editor.ctx, text),
        )
    } catch (error) {
      throw new InkKitError(
        'preservation',
        error instanceof Error ? error.message : 'Cannot read Markdown source',
      )
    }
    if (this.literalSurface) {
      const previous: SourceProvenance = Object.freeze({
        text: this.currentText(),
        format: this.formatType,
        from: this.beforePlainInput?.from ?? this.plain.selectionStart,
        to: this.beforePlainInput?.to ?? this.plain.selectionEnd,
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
    tr.setSelection(Selection.atEnd(tr.doc))
    if (isolated) tr = closeHistory(tr)
    view.dispatch(tr)
    if (isolated)
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
    return true
  }

  undo(expectedGeneration?: number): boolean {
    this.assertMutation(expectedGeneration)
    const view = this.editor.ctx.get(editorViewCtx)
    return undoHistory(view.state, view.dispatch)
  }

  redo(expectedGeneration?: number): boolean {
    this.assertMutation(expectedGeneration)
    const view = this.editor.ctx.get(editorViewCtx)
    return redoHistory(view.state, view.dispatch)
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

  snapshot(expectedGeneration?: number): DocumentSnapshot {
    this.assertCurrent(expectedGeneration)
    let text: string
    try {
      text = this.currentText()
    } catch (error) {
      throw new InkKitError(
        'preservation',
        error instanceof Error ? error.message : 'Cannot preserve Markdown',
      )
    }
    return {
      documentId: this.documentId,
      generation: this.generation,
      revision: this.revision,
      format: this.formatType,
      text,
      dirty: text !== this.originalSource,
    }
  }

  async printableSnapshot(
    expectedGeneration?: number,
  ): Promise<PrintableDocument> {
    const snapshot = this.snapshot(expectedGeneration)
    const epoch = this.documentEpoch
    const state = this.editor.ctx.get(editorViewCtx).state
    let output: Awaited<ReturnType<typeof printableMarkdown>>
    try {
      if (
        snapshot.format === 'md' &&
        !this.options.images &&
        hasAuthoredImagesInLiterals(state.doc.content, (source) =>
          this.editor.ctx.get(remarkCtx).parse(source),
        )
      )
        throw new InkKitError(
          'image-unavailable',
          'No image adapter is configured for the authored images.',
        )
      output =
        snapshot.format === 'txt'
          ? printableText(snapshot.text)
          : await printableMarkdown(
              state.doc.content,
              state.schema,
              this.options.images,
              this.context(),
            )
    } finally {
      this.assertCurrent(snapshot.generation)
      if (
        snapshot.documentId !== this.documentId ||
        epoch !== this.documentEpoch ||
        snapshot.revision !== this.revision
      )
        throw new InkKitError(
          'stale-document',
          'Document changed while preparing printable content',
        )
    }
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

  async clipboardSnapshot(all = true): Promise<ClipboardOutput> {
    const snapshot = this.snapshot()
    const epoch = this.documentEpoch
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
        text,
        html: pre.outerHTML,
        markdown: text,
        images: [],
        diagrams: [],
      }
    }
    const { doc, schema, selection } = this.editor.ctx.get(editorViewCtx).state
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
      throw new InkKitError(
        'preservation',
        error instanceof Error
          ? error.message
          : 'Cannot copy the selected Markdown',
      )
    }
    const result = await portableClipboard(
      all || selectedDoc ? content : selectionContent(doc, content),
      schema,
      markdown,
      this.options.images,
      this.context(),
      completeDiagrams,
    )
    const metadata = referenceMetadata(
      this.editor.ctx,
      selectedDoc ?? doc,
      content,
    )
    if (metadata != null)
      result.html = withReferenceMetadata(result.html, metadata)
    this.assertCurrent(snapshot.generation)
    if (
      snapshot.documentId !== this.documentId ||
      epoch !== this.documentEpoch ||
      snapshot.revision !== this.revision
    )
      throw new InkKitError('stale-document', 'Document changed')
    if (result.images.some((image) => image.error))
      this.events.error?.(
        new InkKitError(
          'image-unavailable',
          'Some copied images were unavailable; their descriptions were retained',
        ),
      )
    if (result.diagrams?.some((diagram) => diagram.error))
      this.events.error?.(
        new InkKitError(
          'diagram-unavailable',
          'Some diagrams could not be exported; their source was retained',
        ),
      )
    return result
  }

  async paste(input: ClipboardInput): Promise<void> {
    this.assertMutation()
    if (this.literalSurface || input.plainText) {
      this.pasteAsPlainText(
        this.mode === 'source' && this.formatType === 'md'
          ? (input.markdown ?? input.text)
          : input.text,
      )
      return
    }
    await this.pasteController.paste(input)
  }

  setCommentsVisible(visible: boolean): void {
    this.assertAlive()
    setCommentVisibility(this.editor.ctx.get(editorViewCtx), visible)
  }

  pasteAsPlainText(text: string): void {
    this.assertMutation()
    if (this.literalSurface) {
      this.replaceLiteralSelection(text, true, this.formatType === 'md')
    } else {
      const view = this.editor.ctx.get(editorViewCtx)
      if (view.state.selection.$from.parent.type.spec.code) {
        view.dispatch(
          view.state.tr
            .insertText(text.replace(/\r\n?/g, '\n'))
            .scrollIntoView(),
        )
      } else {
        const { schema } = view.state
        const children: ProseNode[] = []
        text
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .forEach((line, index) => {
            if (index)
              children.push(
                schema.nodes.hardbreak!.create({
                  isHTML:
                    index ===
                      text.replace(/\r\n?/g, '\n').split('\n').length - 1 &&
                    line === '',
                }),
              )
            if (line) children.push(schema.text(line))
          })
        if (!children.length) {
          view.dispatch(view.state.tr.deleteSelection())
          return
        }
        const paragraph = schema.nodes.paragraph!.create(null, children)
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(Fragment.from(paragraph), 1, 1))
            .scrollIntoView(),
        )
      }
    }
  }

  table(command: TableCommand, options?: TableOptions): boolean {
    this.assertMutation()
    if (this.literalSurface) return false
    return tableCommand(this.editor.ctx, command, options)
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.ready = false
    this.pasteController.destroy()
    if (this.clickHandler)
      this.root.removeEventListener('click', this.clickHandler)
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
              return this.navigateFootnote(
                event.shiftKey ? 'reference' : 'definition',
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
        if (node.type.name === 'image' || isMermaid(node)) portable = true
      })
      const cut = event.type === 'cut' && this.writable
      const policyEpoch = this.policyEpoch
      const epoch = this.documentEpoch
      if (portable && this.events.clipboard) {
        void this.clipboardSnapshot(false)
          .then(async (content) => {
            if (
              cut &&
              (content.images.some((image) => image.error) ||
                content.diagrams?.some((diagram) => diagram.error))
            )
              throw new InkKitError(
                'image-unavailable',
                'The selected content could not be cut safely',
              )
            await this.events.clipboard!(content)
            if (cut) {
              this.assertMutation(snapshot.generation)
              if (
                epoch !== this.documentEpoch ||
                policyEpoch !== this.policyEpoch ||
                snapshot.revision !== this.revision
              )
                throw new InkKitError(
                  'stale-document',
                  'Document changed before cutting',
                )
              this.plain.setSelectionRange(from, to)
              this.replaceLiteralSelection('')
            }
          })
          .catch((error) => this.events.error?.(error))
      } else {
        const output = clipboardContent(parsed.content, parsed.type.schema)
        if (!event.clipboardData) return
        event.clipboardData.setData('text/plain', output.text)
        event.clipboardData.setData('text/html', output.html)
        if (portable) {
          this.events.error?.(
            new InkKitError(
              'image-unavailable',
              'The host must provide a clipboard handler for portable images and diagrams',
            ),
          )
          return
        }
        if (cut) this.replaceLiteralSelection('')
      }
    } catch (error) {
      this.events.error?.(
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  }

  static async mount(
    root: HTMLElement,
    events: EditorEvents,
    options: EditorOptions = {},
  ): Promise<InkKitEditor> {
    const instance = new InkKitEditor(events, options)
    instance.root = root
    instance.ownsRootClass = !root.classList.contains('inkkit-root')
    root.classList.add('inkkit-root')
    instance.pasteController = new PasteController({
      ctx: () => instance.editor.ctx,
      context: () => instance.context(),
      adapter: options.images,
      onError: (error) =>
        events.error?.(
          error instanceof Error ? error : new Error(String(error)),
        ),
      literalText: () => instance.literalSurface,
      editable: () => instance.writable && !instance.literalSurface,
      onPendingChanged: () => instance.publishCommandState(),
    })
    instance.editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.update(labelsCtx.key, () => ({
          ...defaultLabels,
          ...options.labels,
        }))
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
          handleScrollToSelection: () => {
            if (!instance.loading && instance.ready)
              instance.revealCurrentSelection()
            return true
          },
        }))
      })
      .use(labelsCtx)
      .use(
        caretStatePlugin(
          events,
          () => !instance.loading && !instance.literalSurface,
        ),
      )
      .use(instance.pasteController.plugin)
      .use(visibleClipboard)
      .use(instance.keymapPlugin)
      .use(createDialect(Boolean(options.images)))
      .use(tablePlugins)
      .use(instance.changePlugin)
      .use(history)
      .use(clipboard)
      .use(cursor)
      .use(taskListPlugin)
      .use(quoteBackspace)
      .use(listItemBackspace)
      .use(listItemShiftTab)
      .use(dropControlCharacters)
      .use(codeCopyPlugin((text) => events.copy(text)))
      .use(placeholderPlugin)
      .use(highlightPlugin)
      .use(mermaidPreview((error) => events.error?.(error)))
      .use(selectionPlugin)
      .use($prose(() => search()))
      .use(instance.policyPlugin)
      .use(options.images ? imageView(options.images) : [])
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
        )
      } catch (error) {
        events.error?.(
          error instanceof Error ? error : new Error(String(error)),
        )
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
          markdown: event.clipboardData.getData('text/markdown') || undefined,
        })
        .catch((error) => events.error?.(error))
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
        events.error?.(
          error instanceof Error ? error : new Error(String(error)),
        )
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
      if (anchor && event.metaKey) {
        event.preventDefault()
        events.openLink(anchor.getAttribute('href') ?? '')
      }
    }
    root.addEventListener('click', instance.clickHandler)
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
        if (node.type.name === 'image' || isMermaid(node)) hasImages = true
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
          event.clipboardData.setData('text/plain', output.text)
          const metadata = referenceMetadata(
            instance.editor.ctx,
            view.state.doc,
            valid,
          )
          event.clipboardData.setData(
            'text/html',
            metadata != null
              ? withReferenceMetadata(output.html, metadata)
              : output.html,
          )
          if (event.type === 'cut' && instance.writable)
            view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
        } catch (error) {
          events.error?.(
            error instanceof Error ? error : new Error(String(error)),
          )
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (events.clipboard) {
        const epoch = instance.documentEpoch,
          revision = instance.revision
        const { from, to } = view.state.selection
        const cut = event.type === 'cut' && instance.writable
        const policyEpoch = instance.policyEpoch
        void instance
          .clipboardSnapshot(false)
          .then(async (content) => {
            if (
              cut &&
              (content.images.some((image) => image.error) ||
                content.diagrams?.some((diagram) => diagram.error))
            )
              throw new InkKitError(
                'image-unavailable',
                'The selected content could not be cut safely',
              )
            await events.clipboard!(content)
            if (cut) {
              instance.assertMutation()
              if (
                epoch !== instance.documentEpoch ||
                policyEpoch !== instance.policyEpoch ||
                revision !== instance.revision
              )
                throw new InkKitError(
                  'stale-document',
                  'Document changed before cutting',
                )
              view.dispatch(
                view.state.tr.deleteRange(from, to).scrollIntoView(),
              )
            }
          })
          .catch((error) =>
            events.error?.(
              error instanceof Error ? error : new Error(String(error)),
            ),
          )
      } else {
        const container = document.createElement('div')
        container.textContent = clipboardText(expanded)
        event.clipboardData?.setData('text/plain', container.textContent ?? '')
        event.clipboardData?.setData('text/html', container.outerHTML)
        events.error?.(
          new InkKitError(
            'image-unavailable',
            'The host must provide a clipboard handler for portable images and diagrams',
          ),
        )
      }
    }
    root.addEventListener('copy', instance.copyHandler, true)
    root.addEventListener('cut', instance.copyHandler, true)
    instance.applyInputPolicy()
    instance.setKeymap(options.keymap ?? {})
    return instance
  }

  loadDocument(input: DocumentInput): void {
    this.assertAlive()
    const container = this.viewportContainer ?? this.root
    const top = container.scrollTop,
      left = container.scrollLeft
    const focused = this.literalSurface
      ? this.plain.ownerDocument.activeElement === this.plain
      : this.editor.ctx.get(editorViewCtx).hasFocus()
    this.ready = false
    this.pasteController.cancelPending()
    this.documentEpoch += 1
    this.outlineEpoch += 1
    this.sourcePreservations = new WeakMap()
    this.mode = 'formatted'
    this.plainComposing = false
    this.beforePlainInput = undefined
    this.plainSearch = ''
    this.literalMatch = undefined
    this.documentId = input.documentId
    this.formatType = input.format
    this.revision = 0
    this.plain.value = input.text
    this.plain.setSelectionRange(
      this.plain.value.length,
      this.plain.value.length,
    )
    this.load(input.format === 'txt' ? '' : input.text, input.generation)
    this.originalSource = input.text
    this.lastMarkdown = input.text
    this.updateSurface()
    this.ready = true
    if (focused) {
      if (this.literalSurface) this.plain.focus({ preventScroll: true })
      else this.editor.ctx.get(editorViewCtx).focus()
    }
    container.scrollTop = top
    container.scrollLeft = left
    this.events.stateChanged(
      this.literalSurface
        ? { marks: [], block: { type: 'paragraph' }, quoted: false }
        : caretState(this.editor.ctx.get(editorViewCtx).state),
    )
    this.publishCommandState()
  }

  reloadDocument(input: DocumentInput): void {
    this.assertAlive()
    const view = this.editor.ctx.get(editorViewCtx)
    const wasLiteral = this.literalSurface
    const previousMode = this.editingMode
    const previousFormat = this.formatType
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
      else
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.between(
              view.state.doc.resolve(Math.min(at, view.state.doc.content.size)),
              view.state.doc.resolve(
                Math.min(end, view.state.doc.content.size),
              ),
            ),
          ),
        )
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

  setViewport(options: ViewportOptions): void {
    this.assertAlive()
    const container = options.scrollContainer ?? this.root
    if (container !== this.root && !container.contains(this.root))
      throw new RangeError(
        'The scroll container must be the editor root or an ancestor',
      )
    const insets = { top: 0, right: 0, bottom: 0, left: 0, ...options.insets }
    if (
      Object.values(insets).some(
        (value) => !Number.isFinite(value) || value < 0,
      )
    )
      throw new RangeError(
        'Viewport insets must be finite non-negative CSS pixel values',
      )
    this.viewportContainer = container
    this.viewportInsets = insets
  }

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
    const key = `${this.documentEpoch}:${this.revision}:${this.outlineEpoch}:${this.editingMode}`
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

  textSnapshot(expectedGeneration?: number): ReadableTextSnapshot {
    this.assertCurrent(expectedGeneration)
    const scope = this.readableScope()
    const selection = this.editor.ctx.get(editorViewCtx).state.selection
    return Object.freeze({
      snapshotId: scope.id,
      documentId: this.documentId,
      generation: this.generation,
      revision: this.revision,
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
    options: { focus?: boolean; reveal?: boolean } = {},
  ): void {
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
    if (options.focus) {
      if (this.literalSurface) this.plain.focus({ preventScroll: true })
      else this.editor.ctx.get(editorViewCtx).focus()
    }
    if (options.reveal) this.revealTextRange(range)
    this.publishCommandState()
  }

  replaceTextRange(range: TextRange, text: string): boolean {
    const projection = this.validateTextRange(range)
    this.assertMutation()
    if (typeof text !== 'string')
      throw new TypeError('Replacement must be a string')
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
    return replaceFormattedRange(
      this.editor.ctx.get(editorViewCtx),
      from,
      to,
      text,
      (doc) => {
        this.currentText(doc)
      },
    )
  }

  textRangeRects(range: TextRange): readonly TextRect[] {
    const projection = this.validateTextRange(range)
    const rects = this.literalSurface
      ? literalRects(this.plain, range.from, range.to)
      : formattedRects(
          this.editor.ctx.get(editorViewCtx),
          projection,
          range.from,
          range.to,
        )
    return Object.freeze(rects.map((rect) => Object.freeze(rect)))
  }

  visibleTextRanges(snapshotId: string): readonly TextRange[] {
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
    this.revealRects(this.textRangeRects(range))
  }

  private revealRects(rects: readonly TextRect[]): void {
    if (!rects.length) return
    const rect = rects[0]!
    const viewport = this.viewport().rect
    const vertical =
      rect.top < viewport.top
        ? rect.top - viewport.top
        : rect.bottom > viewport.bottom
          ? rect.bottom - viewport.bottom
          : 0
    const horizontal =
      rect.left < viewport.left
        ? rect.left - viewport.left
        : rect.right > viewport.right
          ? rect.right - viewport.right
          : 0
    let remainingTop = vertical,
      remainingLeft = horizontal
    if (this.literalSurface) {
      const top = this.plain.scrollTop,
        left = this.plain.scrollLeft
      this.plain.scrollTop += vertical
      this.plain.scrollLeft += horizontal
      remainingTop -= this.plain.scrollTop - top
      remainingLeft -= this.plain.scrollLeft - left
    }
    let container: HTMLElement | null = this.viewportContainer ?? this.root
    const document = this.root.ownerDocument
    while (
      container &&
      container !== document.body &&
      container !== document.documentElement
    ) {
      const top = container.scrollTop,
        left = container.scrollLeft
      container.scrollTop += remainingTop
      container.scrollLeft += remainingLeft
      remainingTop -= container.scrollTop - top
      remainingLeft -= container.scrollLeft - left
      container = container.parentElement
    }
    if (remainingTop || remainingLeft)
      document.defaultView!.scrollBy(remainingLeft, remainingTop)
  }

  private revealCurrentSelection(): void {
    if (this.loading || !this.ready) return
    if (this.literalSurface) {
      this.revealLiteralSelection()
      return
    }
    const view = this.editor.ctx.get(editorViewCtx)
    const projection = this.readableScope().projection
    const offset = projectionOffset(projection, view.state.selection.head)
    if (this.composing || this.pasteController.pending) {
      this.revealRects(formattedRects(view, projection, offset, offset))
      return
    }
    this.revealTextRange({
      snapshotId: this.readableScope().id,
      from: offset,
      to: offset,
    })
  }

  private revealLiteralSelection(): void {
    this.revealRects(
      literalRects(
        this.plain,
        this.plain.selectionStart,
        this.plain.selectionStart,
      ),
    )
  }

  private load(markdown: string, generation: number): void {
    this.generation = generation
    this.originalSource = markdown
    this.loading = true
    try {
      this.editor.action(replaceAll(markdown, true))
    } finally {
      this.loading = false
    }
    this.preservation = new Preservation(this.editor.ctx, markdown)
    this.lastMarkdown = markdown
    const view = this.editor.ctx.get(editorViewCtx)
    // A caret at the end, where writing carries on; at the start it would sit in a first-line heading and
    // show its marks. The last place text can go, so a document ending in a rule takes a caret above it
    // rather than selecting the rule itself.
    const { doc } = view.state
    const end =
      Selection.findFrom(doc.resolve(doc.content.size), -1, true) ??
      Selection.atEnd(doc)
    view.dispatch(
      setSearchState(
        view.state.tr.setSelection(end),
        new SearchQuery({ search: '' }),
      ),
    )
  }

  find(text: string, expectedGeneration?: number): void {
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
          revision: this.revision,
          epoch: this.documentEpoch,
        }
      } else if (this.plainSearch)
        this.plain.setSelectionRange(
          this.plain.selectionEnd,
          this.plain.selectionEnd,
        )
      this.plainSearch = text
      this.revealLiteralSelection()
      return
    }
    findFormatted(this.editor.ctx.get(editorViewCtx), text)
  }

  replace(
    search: string,
    replacement: string,
    expectedGeneration?: number,
  ): boolean {
    this.assertMutation(expectedGeneration)
    return this.replaceMatches(search, replacement, false) > 0
  }

  replaceAll(
    search: string,
    replacement: string,
    expectedGeneration?: number,
  ): number {
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
        remembered.revision === this.revision &&
        remembered.epoch === this.documentEpoch &&
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
    return replaceFormatted(
      this.editor.ctx.get(editorViewCtx),
      search,
      replacement,
      (doc) => {
        this.currentText(doc)
      },
      all,
    )
  }

  private outlineContext(): OutlineContext {
    return {
      documentId: this.documentId,
      generation: this.generation,
      revision: this.revision,
      epoch: this.outlineEpoch,
      mode: this.editingMode,
    }
  }

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

  navigateHeading(heading: Heading): boolean {
    this.assertCurrent()
    if (!heading || typeof heading !== 'object')
      throw new InkKitError(
        'stale-document',
        'The heading is no longer current',
      )
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

  /** Buffered native typing follows the same input rules as direct typing. */
  insertText(text: string, generation: number): boolean {
    this.assertAlive()
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

  /** Let existing keymaps handle buffered editing commands before native fallback. */
  keyDown(
    key: string,
    code: string,
    metaKey: boolean,
    ctrlKey: boolean,
    altKey: boolean,
    shiftKey: boolean,
    generation: number,
  ): boolean {
    this.assertAlive()
    if (
      (this.literalSurface
        ? this.plainComposing
        : this.editor.ctx.get(editorViewCtx).composing) &&
      generation === this.generation
    )
      return false
    this.assertCurrent(generation)
    const configuredEvent = new KeyboardEvent('keydown', {
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
      this.readOnlyKeys(this.editor.ctx.get(editorViewCtx), configuredEvent)
    }
    if (this.literalSurface) {
      if (this.literalKeys(this.editor.ctx.get(editorViewCtx), configuredEvent))
        return true
      if (
        !this.writable &&
        ['Enter', 'Tab', 'Backspace', 'Delete'].includes(key)
      )
        throw new InkKitError('read-only', 'The editor is read-only')
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
    if (view.composing) return false
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
    return Boolean(
      view.someProp('handleKeyDown', (handler) => handler(view, event)),
    )
  }

  focus(): void {
    this.assertAlive()
    if (!this.ready)
      throw new InkKitError('not-ready', 'No document has been loaded')
    if (this.literalSurface) this.plain.focus()
    else this.editor.ctx.get(editorViewCtx).focus()
  }

  /** Binds keys, in ProseMirror's names, to the formatting each shortcut runs. Walked in the table's
   *  order, so a key given to two shortcuts lands the same way every time. */
  setKeymap(keymap: Keymap): void {
    this.assertAlive()
    this.configuredKeys = {
      undo: ['Mod-z'],
      redo: ['Mod-y', 'Shift-Mod-z'],
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
          return this[name]()
        }
      }
    }
    Object.assign(bindings, historyBindings)
    for (const [name, command] of Object.entries(shortcutCommands)) {
      for (const key of keymap[name] ?? []) {
        bindings[key] = () => {
          if (!this.ready || !this.commandState().commands.format[command[0]])
            return true
          this.format(...command)
          return true
        }
      }
    }
    for (const command of tableCommands) {
      const name = 'table' + command[0]!.toUpperCase() + command.slice(1)
      for (const key of this.configuredKeys[name] ?? [])
        bindings[key] = () => {
          if (!this.ready || !this.commandState().commands.table[command])
            return false
          return this.table(command)
        }
    }
    this.readOnlyKeys = keydownHandler(
      Object.fromEntries(
        Object.keys(bindings).map((key) => [
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
  insertPaths(paths: string[], x: number, y: number): void {
    this.assertMutation()
    if (paths.length === 0) return
    if (this.literalSurface) {
      this.pasteAsPlainText(paths.join('\n\n'))
      return
    }
    const { schema } = this.editor.ctx.get(editorViewCtx).state
    this.insertBlocks(
      paths.map((path) =>
        schema.nodes.paragraph!.create(null, schema.text(path)),
      ),
      x,
      y,
    )
  }

  insertImages(
    images: { path: string; alt: string; title?: string }[],
    x?: number,
    y?: number,
  ): void {
    this.assertMutation()
    if (!images.length) return
    if (!this.options.images || this.literalSurface)
      throw new InkKitError(
        'image-unavailable',
        'This editor has no image adapter',
      )
    const view = this.editor.ctx.get(editorViewCtx)
    const { schema } = view.state
    const nodes = images.map((image) =>
      schema.nodes.image!.create({
        src: image.path,
        alt: image.alt,
        title: image.title ?? '',
      }),
    )
    if (x != null && y != null)
      this.insertBlocks(
        nodes.map((node) => schema.nodes.paragraph!.create(null, node)),
        x,
        y,
      )
    else
      view.dispatch(
        view.state.tr
          .replaceSelectionWith(schema.nodes.paragraph!.create(null, nodes))
          .scrollIntoView(),
      )
  }

  private insertBlocks(blocks: ProseNode[], x: number, y: number): void {
    const view = this.editor.ctx.get(editorViewCtx)
    const { state } = view
    const $pos = state.doc.resolve(
      view.posAtCoords({ left: x, top: y })?.pos ?? state.selection.from,
    )
    const tr = state.tr
    let at: number
    if (
      $pos.depth === 1 &&
      $pos.parent.isTextblock &&
      $pos.parent.content.size === 0
    ) {
      at = $pos.before(1)
      tr.replaceWith(at, $pos.after(1), blocks)
    } else {
      at = $pos.depth > 0 ? $pos.after(1) : $pos.pos
      tr.insert(at, blocks)
    }
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

  format(command: FormatCommand, arg?: string | number): void {
    this.assertMutation()
    if (this.literalSurface) return
    const run = (cmd: Parameters<typeof callCommand>[0], payload?: unknown) =>
      this.editor.action(callCommand(cmd, payload))
    const state = caretState(this.editor.ctx.get(editorViewCtx).state)
    switch (command) {
      case 'heading': {
        const level = Number(arg ?? 1)
        if (state.block.type === 'heading' && state.block.level === level)
          run(turnIntoTextCommand.key)
        else run(wrapInHeadingCommand.key, level)
        break
      }
      case 'paragraph':
        run(turnIntoTextCommand.key)
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
        if (state.block.type === 'codeBlock') run(turnIntoTextCommand.key)
        else run(createCodeBlockCommand.key, typeof arg === 'string' ? arg : '')
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
      case 'link': {
        const view = this.editor.ctx.get(editorViewCtx)
        const reference =
          view.state.selection.$from
            .marks()
            .find(
              (mark) => mark.type.name === 'link' && mark.attrs.identifier,
            ) ??
          view.state.doc
            .nodeAt(view.state.selection.from)
            ?.marks.find(
              (mark) => mark.type.name === 'link' && mark.attrs.identifier,
            )
        if (reference && typeof arg === 'string') {
          this.editReferenceDefinition(String(reference.attrs.identifier), arg)
          break
        }
        const payload = typeof arg === 'string' ? { href: arg } : {}
        const toggle = () => run(toggleLinkCommand.key, payload)
        if (
          !state.marks.includes('link') ||
          !this.withMarkRunSelected(linkSchema.type(this.editor.ctx), toggle)
        )
          toggle()
        break
      }
    }
    this.focus()
  }

  editReferenceDefinition(
    label: string,
    destination: string,
    title?: string,
  ): boolean {
    this.assertMutation()
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
    view.dispatch(
      view.state.tr.setNodeMarkup(definition.pos, undefined, {
        ...definition.node.attrs,
        url: destination,
        title: title ?? definition.node.attrs.title,
      }),
    )
    return true
  }

  insertFootnote(label?: string): void {
    this.assertMutation()
    if (this.literalSurface) return
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
    if (!label || /[\s\[\]\\]/.test(label) || label.length > 999)
      throw new Error(
        'A footnote label must be 1–999 characters without whitespace, brackets or backslashes',
      )
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
  }

  navigateFootnote(target: 'definition' | 'reference'): boolean {
    this.assertCurrent()
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
}
