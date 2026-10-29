import {
  type Editor,
  editorViewCtx,
  commandsCtx,
  type CmdKey,
} from '@milkdown/kit/core'
import {
  NodeRange,
  type MarkType,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import {
  type EditorState,
  type Command,
  TextSelection,
} from '@milkdown/kit/prose/state'
import { findWrapping, liftTarget } from '@milkdown/kit/prose/transform'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { callCommand } from '@milkdown/kit/utils'
import {
  blockquoteSchema,
  codeBlockSchema,
  headingSchema,
  inlineCodeSchema,
  paragraphSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { toggleHighlightCommand } from './inline-highlight'
import {
  toggleSubscriptCommand,
  toggleSuperscriptCommand,
  toggleUnderlineCommand,
} from './inline-html-marks'
import { setTextblockType } from './block-conversion'
import { taskAtCaret, toggleTask, toggleTaskList } from './tasks'
import {
  innermostListDepth,
  outermostListDepth,
  liftItem,
  liftQuote,
} from './editor-input'
import { caretState, textBounds, quoted } from './editor-selection'
import type { FormatCommand, FormatOptions } from './editor'
import type { FormatHandler } from './formats'

type CommandEditor = Pick<Editor, 'ctx' | 'action'>

function headingLevel(command: FormatCommand): number | undefined {
  const match = /^heading([1-6])$/.exec(command)
  return match ? Number(match[1]) : undefined
}

/** What an RTF document cannot hold: headings, code blocks, quotes, tasks and highlight. Every
 *  other command is available as in Markdown, and alignment only here. */
const unavailableInRichText: readonly FormatCommand[] = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'paragraph',
  'highlight',
  'codeBlock',
  'quote',
  'taskList',
  'toggleTask',
]

const alignments = {
  alignLeft: null,
  alignCenter: 'center',
  alignRight: 'right',
  alignJustify: 'justify',
} as const

type AlignCommand = keyof typeof alignments

function isAlignCommand(command: FormatCommand): command is AlignCommand {
  return command in alignments
}

/** Calls `found` for each paragraph the selection touches that can take an alignment, which
 *  those in table cells cannot, until it returns false. */
function eachAlignable(
  state: EditorState,
  found: (node: ProseNode, pos: number) => boolean,
): void {
  const { from, to } = state.selection
  let going = true
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!going || node.type.name === 'table') return false
    if (node.type.name === 'paragraph') going = found(node, pos)
    return going && !node.isTextblock
  })
}

function canAlign(state: EditorState): boolean {
  let any = false
  eachAlignable(state, () => {
    any = true
    return false
  })
  return any
}

/** The alignment of the paragraph that holds the start of the selection. */
export function caretAlignment(
  state: EditorState,
): 'left' | 'center' | 'right' | 'justify' {
  const { parent } = state.selection.$from
  return parent.type.name === 'paragraph' && parent.attrs.align
    ? (parent.attrs.align as 'center' | 'right' | 'justify')
    : 'left'
}

export function formatAvailability(
  editor: CommandEditor,
  state: EditorState,
  formatted: boolean,
  handler: FormatHandler,
): Record<FormatCommand, boolean> {
  const available = markdownAvailability(editor, state, formatted)
  const rich = handler.richText
  if (!rich) return available
  for (const command of unavailableInRichText) available[command] = false
  // A link's run never keeps underline in RTF, so underline does nothing on link text.
  if (available.underline && rich.inLink(state)) available.underline = false
  const align = formatted && canAlign(state)
  available.alignLeft = available.alignCenter = align
  available.alignRight = available.alignJustify = align
  return available
}

function markdownAvailability(
  editor: CommandEditor,
  state: EditorState,
  formatted: boolean,
): Record<FormatCommand, boolean> {
  const manager = editor.ctx.get(commandsCtx)
  const check = <T>(key: CmdKey<T>, payload?: T): boolean =>
    formatted && manager.get(key)(payload)(state)
  const canBecome = (
    type: 'paragraph' | 'heading' | 'codeBlock',
    level?: number,
  ): boolean => formatted && textblockType(editor, type, level)(state)
  const heading = (level: number) =>
    canBecome('heading', level) || canBecome('paragraph')
  return {
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
    underline: check(toggleUnderlineCommand.key),
    superscript: check(toggleSuperscriptCommand.key),
    subscript: check(toggleSubscriptCommand.key),
    code:
      formatted &&
      (state.selection.empty
        ? state.selection.$from.parent.inlineContent &&
          state.selection.$from.parent.type.allowsMarkType(
            inlineCodeSchema.type(editor.ctx),
          )
        : check(toggleInlineCodeCommand.key)),
    codeBlock: canBecome('codeBlock') || canBecome('paragraph'),
    quote: formatted && canQuote(editor, state),
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
    toggleTask: formatted && taskAtCaret(state) != null,
    alignLeft: false,
    alignCenter: false,
    alignRight: false,
    alignJustify: false,
    link: check(toggleLinkCommand.key, {}),
  }
}

/** Sets the alignment of the paragraphs the selection touches. */
function align(editor: CommandEditor, command: AlignCommand): void {
  const view = editor.ctx.get(editorViewCtx)
  const value = alignments[command]
  const tr = view.state.tr
  eachAlignable(view.state, (node, pos) => {
    if (node.attrs.align !== value)
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: value })
    return true
  })
  if (tr.docChanged) view.dispatch(tr)
}

function canQuote(editor: CommandEditor, state: EditorState): boolean {
  const { $from, $to } = textBounds(state)
  if (quoted($from, $to)) {
    const range = $from.blockRange(
      $to,
      (node) => node.type.name === 'blockquote',
    )
    return !!range && liftTarget(range) != null
  }
  const type = blockquoteSchema.type(editor.ctx)
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

// Removing a mark at a caret only clears the stored mark, so the whole marked
// run is selected for the command and the caret put back after it.
function withMarkRunSelected(
  editor: CommandEditor,
  mark: MarkType,
  command: () => void,
): boolean {
  const view = editor.ctx.get(editorViewCtx)
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
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)))
  command()
  const caret = Math.min($pos.pos, view.state.doc.content.size)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)),
  )
  return true
}

// Milkdown's inline code command ignores a caret; a stored mark makes the
// next typed text code, the way bold and italic behave.
function toggleInlineCode(editor: CommandEditor): void {
  const view = editor.ctx.get(editorViewCtx)
  const type = inlineCodeSchema.type(editor.ctx)
  const run = () => {
    editor.action(callCommand(toggleInlineCodeCommand.key))
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
  else withMarkRunSelected(editor, type, run)
}

function list(
  editor: CommandEditor,
  kind: 'bulletList' | 'orderedList',
  itemPerBlock: boolean,
): void {
  const view = editor.ctx.get(editorViewCtx)
  const { state } = view
  const { $from } = textBounds(state)
  const wanted = kind === 'bulletList' ? 'bullet_list' : 'ordered_list'
  const depth = innermostListDepth($from)
  if (depth == null && itemPerBlock) {
    // An RTF list item holds one paragraph, so each selected paragraph becomes an item.
    const ordered = wanted === 'ordered_list'
    wrapInList(
      state.schema.nodes[wanted]!,
      ordered ? { order: 1, spread: false } : { spread: false },
    )(state, (tr) => {
      tr.doc.nodesBetween(
        tr.mapping.map(state.selection.from),
        tr.mapping.map(state.selection.to),
        (node, pos) => {
          if (node.type.name !== 'list_item') return true
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            listType: ordered ? 'ordered' : 'bullet',
            label: ordered ? '1.' : '•',
            spread: false,
          })
          return false
        },
      )
      view.dispatch(tr)
    })
    return
  }
  if (depth == null) {
    const command =
      kind === 'bulletList' ? wrapInBulletListCommand : wrapInOrderedListCommand
    editor.action(callCommand(command.key))
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

function quote(editor: CommandEditor): void {
  const view = editor.ctx.get(editorViewCtx)
  const type = blockquoteSchema.type(editor.ctx)
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

function unquote(editor: CommandEditor): void {
  const view = editor.ctx.get(editorViewCtx)
  const { $from, $to } = textBounds(view.state)
  const range = $from.blockRange($to, (node) => node.type.name === 'blockquote')
  if (!range) return
  const target = liftTarget(range)
  if (target == null) return
  view.dispatch(liftQuote(view.state, range, target))
}

/** Changes the selected textblocks' type, keeping everything they hold. */
function textblockType(
  editor: CommandEditor,
  type: 'paragraph' | 'heading' | 'codeBlock',
  attr?: string | number,
): Command {
  const ctx = editor.ctx
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

export function applyFormat(
  editor: CommandEditor,
  command: FormatCommand,
  checked: FormatOptions | undefined,
  link: (destination: string | undefined) => void,
  itemPerBlock = false,
): void {
  const view = editor.ctx.get(editorViewCtx)
  const run = (cmd: Parameters<typeof callCommand>[0], payload?: unknown) =>
    editor.action(callCommand(cmd, payload))
  const state = caretState(view.state)
  const become = (
    type: 'paragraph' | 'heading' | 'codeBlock',
    attr?: string | number,
  ) => textblockType(editor, type, attr)(view.state, view.dispatch)
  if (isAlignCommand(command)) {
    align(editor, command)
    return
  }
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
    case 'underline':
      run(toggleUnderlineCommand.key)
      break
    case 'superscript':
      run(toggleSuperscriptCommand.key)
      break
    case 'subscript':
      run(toggleSubscriptCommand.key)
      break
    case 'code':
      toggleInlineCode(editor)
      break
    case 'codeBlock':
      if (state.block.type === 'codeBlock') become('paragraph')
      else become('codeBlock', checked?.language ?? '')
      break
    case 'quote':
      if (state.quoted) unquote(editor)
      else quote(editor)
      break
    case 'bulletList':
    case 'orderedList':
      list(editor, command, itemPerBlock)
      break
    case 'taskList':
      toggleTaskList(editor.ctx)
      break
    case 'toggleTask':
      toggleTask(editor.ctx)
      break
    case 'link':
      link(checked?.destination)
      break
  }
}
