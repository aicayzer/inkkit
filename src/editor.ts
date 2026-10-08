import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
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
import { history } from '@milkdown/kit/plugin/history'
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
import { createDialect, serialize, stringifyOptions } from './dialect'
import { Preservation } from './preserve'
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
import { tablePlugins, tableCommand, type TableCommand } from './tables'
import {
  InkKitError,
  type DocumentInput,
  type DocumentSnapshot,
  type DocumentContext,
  type ImageAdapter,
  type ClipboardInput,
  type ClipboardOutput,
} from './types'
import { highlightPlugin } from './highlight'
import { PasteController } from './paste'
import { selectionPlugin } from './selection'
import {
  search,
  SearchQuery,
  getSearchState,
  setSearchState,
} from 'prosemirror-search'
import { taskListPlugin, toggleTaskList } from './tasks'

export type Mark = 'bold' | 'italic' | 'strikethrough' | 'code' | 'link'

export type Block =
  | { type: 'paragraph' }
  | { type: 'heading'; level: number }
  | { type: 'codeBlock' }
  | { type: 'bulletList' }
  | { type: 'orderedList' }
  | { type: 'taskList' }

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
  | 'code'
  | 'codeBlock'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'link'

/** The bindings the app sets, by shortcut name; each runs a format command. */
export type Keymap = Record<string, string[]>

const shortcutCommands: Record<string, [FormatCommand, number?]> = {
  heading1: ['heading', 1],
  heading2: ['heading', 2],
  heading3: ['heading', 3],
  paragraph: ['paragraph'],
  bold: ['bold'],
  italic: ['italic'],
  strikethrough: ['strikethrough'],
  code: ['code'],
  codeBlock: ['codeBlock'],
  quote: ['quote'],
  bulletList: ['bulletList'],
  orderedList: ['orderedList'],
  taskList: ['taskList'],
}

export interface EditorEvents {
  changed(markdown: string, generation: number): void
  stateChanged(state: CaretState): void
  openLink(href: string): void
  copy(text: string): void
  error?(error: Error): void
  clipboard?(content: ClipboardOutput): void | Promise<void>
}

const markNames: Record<string, Mark> = {
  strong: 'bold',
  emphasis: 'italic',
  strike_through: 'strikethrough',
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
function caretStatePlugin(events: EditorEvents) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('caretState'),
        view: () => ({
          update(view, previous) {
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

export class InkKitEditor {
  private editor!: Editor
  private lastMarkdown = ''
  private baseline = ''
  private documentId = ''
  private formatType: 'md' | 'txt' = 'md'
  private revision = 0
  private documentEpoch = 0
  private operationSequence = 0
  private plainComposing = false
  private plainSearch = ''
  private ready = false
  private destroyed = false
  private preservation?: Preservation
  private pasteController!: PasteController
  private plain!: HTMLTextAreaElement
  private root!: HTMLElement
  private clickHandler?: (event: MouseEvent) => void
  private footnoteKeyHandler?: (event: KeyboardEvent) => void
  private copyHandler?: (event: ClipboardEvent) => void
  private originalSource = ''
  private generation = 0
  private loading = false
  private changePlugin = $prose(
    () =>
      new Plugin({
        key: new PluginKey('documentChanges'),
        view: () => ({
          update: (view, previous) => {
            if (this.loading || view.state.doc.eq(previous.doc)) return
            this.revision += 1
            let markdown: string
            try {
              markdown =
                this.preservation?.serialize(view.state.doc) ??
                serialize(this.editor.ctx, view.state.doc)
            } catch (error) {
              this.events.error?.(
                error instanceof Error ? error : new Error(String(error)),
              )
              return
            }
            if (markdown === this.lastMarkdown) return
            this.lastMarkdown = markdown
            this.events.changed(
              markdown === this.baseline ? this.originalSource : markdown,
              this.generation,
            )
          },
        }),
      }),
  )
  private keys: (view: EditorView, event: KeyboardEvent) => boolean = () =>
    false

  private constructor(
    private readonly events: EditorEvents,
    private readonly options: { images?: ImageAdapter },
  ) {}

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
      this.formatType === 'txt'
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

  private plainSource(): string {
    const normalized = this.originalSource.replace(/\r\n?/g, '\n')
    if (this.plain.value === normalized) return this.originalSource
    const crlf =
      this.originalSource.includes('\r\n') &&
      !this.originalSource.replaceAll('\r\n', '').includes('\n')
    return crlf ? this.plain.value.replaceAll('\n', '\r\n') : this.plain.value
  }

  snapshot(expectedGeneration?: number): DocumentSnapshot {
    this.assertCurrent(expectedGeneration)
    let text: string
    try {
      text =
        this.formatType === 'txt'
          ? this.plainSource()
          : this.preservation!.serialize(
              this.editor.ctx.get(editorViewCtx).state.doc,
            )
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

  async clipboardSnapshot(all = true): Promise<ClipboardOutput> {
    const snapshot = this.snapshot()
    const epoch = this.documentEpoch
    if (this.formatType === 'txt') {
      const text = all
        ? snapshot.text
        : this.plain.value.slice(
            this.plain.selectionStart,
            this.plain.selectionEnd,
          )
      const pre = document.createElement('pre')
      pre.textContent = text
      return { text, html: pre.outerHTML, markdown: text, images: [] }
    }
    const { doc, schema, selection } = this.editor.ctx.get(editorViewCtx).state
    const content = all ? doc.content : selection.content().content
    const valid = content.firstChild?.isInline
      ? Fragment.from(schema.nodes.paragraph!.create(null, content))
      : content
    let markdown: string
    try {
      markdown = all
        ? snapshot.text
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
      all ? content : selectionContent(doc, content),
      schema,
      markdown,
      this.options.images,
      this.context(),
    )
    const metadata = referenceMetadata(this.editor.ctx, doc, content)
    if (metadata != null)
      result.html = withReferenceMetadata(result.html, metadata)
    this.assertCurrent(snapshot.generation)
    if (snapshot.documentId !== this.documentId || epoch !== this.documentEpoch)
      throw new InkKitError('stale-document', 'Document changed')
    if (result.images.some((image) => image.error))
      this.events.error?.(
        new InkKitError(
          'image-unavailable',
          'Some copied images were unavailable; their descriptions were retained',
        ),
      )
    return result
  }

  async paste(input: ClipboardInput): Promise<void> {
    this.assertCurrent()
    if (this.formatType === 'txt' || input.plainText) {
      this.pasteAsPlainText(input.text)
      return
    }
    await this.pasteController.paste(input)
  }

  pasteAsPlainText(text: string): void {
    this.assertCurrent()
    if (this.formatType === 'txt') {
      this.plain.setRangeText(
        text,
        this.plain.selectionStart,
        this.plain.selectionEnd,
        'end',
      )
      this.plain.dispatchEvent(new Event('input'))
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

  table(
    command: TableCommand,
    options?: { rows?: number; columns?: number },
  ): boolean {
    this.assertCurrent()
    if (this.formatType === 'txt') return false
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

  static async mount(
    root: HTMLElement,
    events: EditorEvents,
    options: { images?: ImageAdapter } = {},
  ): Promise<InkKitEditor> {
    const instance = new InkKitEditor(events, options)
    instance.root = root
    instance.pasteController = new PasteController({
      ctx: () => instance.editor.ctx,
      context: () => instance.context(),
      adapter: options.images,
      onError: (error) =>
        events.error?.(
          error instanceof Error ? error : new Error(String(error)),
        ),
      literalText: () => instance.formatType === 'txt',
    })
    instance.editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
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
        unbind(strongKeymap)
        unbind(emphasisKeymap)
        unbind(inlineCodeKeymap)
        unbind(strikethroughKeymap)
        unbind(headingKeymap, ['DowngradeHeading'])
        unbind(paragraphKeymap)
        unbind(blockquoteKeymap)
        unbind(codeBlockKeymap)
        unbind(bulletListKeymap)
        unbind(orderedListKeymap)
        // The caret is kept above the fade under the formatting bar.
        ctx.update(editorViewOptionsCtx, (options) => ({
          ...options,
          scrollThreshold: { top: 8, right: 0, bottom: 24, left: 0 },
          scrollMargin: { top: 8, right: 0, bottom: 24, left: 0 },
        }))
      })
      .use(caretStatePlugin(events))
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
      .use(selectionPlugin)
      .use($prose(() => search()))
      .use(options.images ? imageView(options.images) : [])
      .create()
    instance.plain = document.createElement('textarea')
    instance.plain.className = 'inkkit-plain'
    instance.plain.setAttribute('aria-label', 'Plain text editor')
    instance.plain.hidden = true
    root.append(instance.plain)
    instance.plain.addEventListener('input', () => {
      instance.revision += 1
      events.changed(instance.plainSource(), instance.generation)
    })
    instance.plain.addEventListener('compositionstart', () => {
      instance.plainComposing = true
    })
    instance.plain.addEventListener('compositionend', () => {
      instance.plainComposing = false
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
      const view = instance.editor.ctx.get(editorViewCtx)
      const fragment = view.state.selection.content().content
      const expanded = selectionContent(view.state.doc, fragment)
      let hasImages = false
      expanded.descendants((node) => {
        if (node.type.name === 'image') hasImages = true
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
          if (event.type === 'cut')
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
        const cut = event.type === 'cut'
        void instance
          .clipboardSnapshot(false)
          .then(async (content) => {
            if (cut && content.images.some((image) => image.error))
              throw new InkKitError(
                'image-unavailable',
                'The selected images could not be cut safely',
              )
            await events.clipboard!(content)
            if (cut) {
              instance.assertCurrent()
              if (
                epoch !== instance.documentEpoch ||
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
            'The host must provide a clipboard handler to copy images',
          ),
        )
      }
    }
    root.addEventListener('copy', instance.copyHandler, true)
    root.addEventListener('cut', instance.copyHandler, true)
    return instance
  }

  loadDocument(input: DocumentInput): void {
    this.assertAlive()
    this.pasteController.cancelPending()
    this.documentEpoch += 1
    this.plainComposing = false
    this.plainSearch = ''
    this.documentId = input.documentId
    this.formatType = input.format
    this.revision = 0
    this.plain.hidden = input.format !== 'txt'
    this.editor.ctx.get(editorViewCtx).dom.parentElement!.hidden =
      input.format === 'txt'
    this.plain.value = input.text
    this.load(input.format === 'txt' ? '' : input.text, input.generation)
    this.originalSource = input.text
    this.ready = true
  }

  reloadDocument(input: DocumentInput): void {
    this.assertAlive()
    const view = this.editor.ctx.get(editorViewCtx)
    const at =
      this.formatType === 'txt'
        ? this.plain.selectionStart
        : view.state.selection.from
    const top = this.root.scrollTop
    this.loadDocument(input)
    if (input.format === 'txt')
      this.plain.setSelectionRange(
        Math.min(at, input.text.length),
        Math.min(at, input.text.length),
      )
    else
      view.dispatch(
        view.state.tr.setSelection(
          Selection.near(
            view.state.doc.resolve(Math.min(at, view.state.doc.content.size)),
          ),
        ),
      )
    this.root.scrollTop = top
  }

  private load(markdown: string, generation: number): void {
    // A loaded document only counts as changed once it is edited, so its
    // canonical form is the baseline, not the text as stored.
    this.generation = generation
    this.originalSource = markdown
    this.loading = true
    try {
      this.editor.action(replaceAll(markdown, true))
    } finally {
      this.loading = false
    }
    this.preservation = new Preservation(this.editor.ctx, markdown)
    this.baseline = serialize(this.editor.ctx)
    this.lastMarkdown = this.baseline
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
        view.state.tr.setSelection(end).scrollIntoView(),
        new SearchQuery({ search: '' }),
      ),
    )
    this.events.stateChanged(caretState(view.state))
  }

  find(text: string): void {
    this.assertCurrent()
    if (this.formatType === 'txt') {
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const matches = text
        ? [...this.plain.value.matchAll(new RegExp(escaped, 'giu'))]
        : []
      const from =
        this.plainSearch === text
          ? this.plain.selectionEnd
          : this.plain.selectionStart
      const match = matches.find((item) => item.index >= from) ?? matches[0]
      if (match)
        this.plain.setSelectionRange(match.index, match.index + match[0].length)
      else if (this.plainSearch)
        this.plain.setSelectionRange(
          this.plain.selectionEnd,
          this.plain.selectionEnd,
        )
      this.plainSearch = text
      return
    }
    const view = this.editor.ctx.get(editorViewCtx)
    const previous = getSearchState(view.state)?.query.search
    const query = new SearchQuery({ search: text, literal: true })
    let tr = setSearchState(view.state.tr, query)
    if (text) {
      const from =
        previous === text ? view.state.selection.to : view.state.selection.from
      const match =
        query.findNext(view.state, from) ?? query.findNext(view.state, 0)
      if (match)
        tr = tr
          .setSelection(TextSelection.create(tr.doc, match.from, match.to))
          .scrollIntoView()
      else tr = tr.setSelection(Selection.near(view.state.selection.$to))
    } else if (previous) {
      tr = tr.setSelection(Selection.near(view.state.selection.$to))
    }
    view.dispatch(tr)
  }

  /** Buffered native typing follows the same input rules as direct typing. */
  insertText(text: string, generation: number): boolean {
    this.assertAlive()
    if (
      (this.formatType === 'txt'
        ? this.plainComposing
        : this.editor.ctx.get(editorViewCtx).composing) &&
      generation === this.generation
    )
      return false
    this.assertCurrent(generation)
    if (this.formatType === 'txt') {
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
      (this.formatType === 'txt'
        ? this.plainComposing
        : this.editor.ctx.get(editorViewCtx).composing) &&
      generation === this.generation
    )
      return false
    this.assertCurrent(generation)
    if (this.formatType === 'txt') return false
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
    if (this.formatType === 'txt') this.plain.focus()
    else this.editor.ctx.get(editorViewCtx).focus()
  }

  /** Binds keys, in ProseMirror's names, to the formatting each shortcut runs. Walked in the table's
   *  order, so a key given to two shortcuts lands the same way every time. */
  setKeymap(keymap: Keymap): void {
    this.assertAlive()
    const bindings: Record<string, Command> = {}
    for (const [name, command] of Object.entries(shortcutCommands)) {
      for (const key of keymap[name] ?? []) {
        bindings[key] = () => {
          this.format(...command)
          return true
        }
      }
    }
    this.keys = keydownHandler(bindings)
  }

  /** Dropped files land as one paragraph per path at the drop point: in place of an empty block, after
   *  the top-level block otherwise, so a list or quote is not opened up by them. */
  insertPaths(paths: string[], x: number, y: number): void {
    this.assertCurrent()
    if (paths.length === 0) return
    if (this.formatType === 'txt') {
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
    this.assertCurrent()
    if (!images.length) return
    if (!this.options.images || this.formatType === 'txt')
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
    this.assertCurrent()
    if (this.formatType === 'txt') return
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
    this.assertCurrent()
    if (this.formatType === 'txt') return false
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
    this.assertCurrent()
    if (this.formatType === 'txt') return
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
    if (this.formatType === 'txt') return false
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
