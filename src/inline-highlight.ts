import { commandsCtx, remarkCtx } from '@milkdown/kit/core'
import { markRule } from '@milkdown/kit/prose'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import {
  $command,
  $inputRule,
  $markSchema,
  $remark,
  $useKeymap,
} from '@milkdown/kit/utils'
import { highlightMark } from 'micromark-extension-highlight-mark'
import {
  highlightMarkFromMarkdown,
  highlightMarkToMarkdown,
} from 'mdast-util-highlight-mark'
import type { Nodes, Root } from 'mdast'
import type { Attention, Handle } from 'mdast-util-to-markdown'
import type { Processor } from 'unified'

// The current serializer's attention handling encodes ambiguous whitespace and
// punctuation boundaries; the highlight provider predates that API.
const highlight: Handle & { attention?: Attention; peek?: Handle } = (
  node,
  _parent,
  state,
  info,
) => {
  const exit = state.enter('phrasing')
  const value = state.containerPhrasing(
    { type: 'root', children: [node] },
    info,
  )
  exit()
  return value
}
highlight.attention = () => ({
  construct: 'highlight',
  markers: ['='],
  sizes: [2],
})
highlight.peek = () => '='

function remarkInlineHighlight(this: Processor) {
  const data = this.data() as Record<string, unknown[] | undefined>
  ;(data.micromarkExtensions ??= []).push(highlightMark())
  ;(data.fromMarkdownExtensions ??= []).push(highlightMarkFromMarkdown)
  ;(data.toMarkdownExtensions ??= []).push({
    ...highlightMarkToMarkdown,
    handlers: { highlight },
  })
}

export const remarkInlineHighlightPlugin = $remark(
  'inkkitInlineHighlight',
  () => remarkInlineHighlight,
)

export const highlightSchema = $markSchema('highlight', () => ({
  priority: 45,
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner(state, node, type) {
      state.openMark(type)
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner(state, mark, node) {
      if (node.isText && /^\s*$/.test(node.text ?? '')) {
        return
      }
      state.withMark(mark, 'highlight')
    },
  },
}))

export const toggleHighlightCommand = $command(
  'ToggleHighlight',
  (ctx) => () => toggleMark(highlightSchema.type(ctx)),
)

export const highlightInputRule = $inputRule((ctx) => {
  const pattern = /==([^\n]+)==$/
  const rule = markRule(pattern, highlightSchema.type(ctx))
  const apply = (
    rule as InputRule & {
      handler: Exclude<ConstructorParameters<typeof InputRule>[1], string>
    }
  ).handler
  return new InputRule(pattern, (state, match, start, end) => {
    const parentStart = state.selection.$from.start()
    const prefix = state.selection.$from.parent.textBetween(
      0,
      start - parentStart,
    )
    const source = prefix + match[0]
    const tree = ctx.get(remarkCtx).parse(source) as Root
    let valid = false
    const walk = (node: Nodes) => {
      if (
        node.type === 'highlight' &&
        node.position?.start.offset === prefix.length &&
        node.position.end.offset === source.length
      )
        valid = true
      if ('children' in node) node.children.forEach(walk)
    }
    walk(tree)
    if (!valid) return null
    const { from, to } = state.selection
    const typed = match[0].slice(from - start)
    if (typed.length <= 1 && state.selection.empty)
      return apply(state, match, start, end)

    // Milkdown's mark rule expects only the final character to be absent.
    // Prepare buffered input without applying plugins or dispatching twice.
    const tr = state.tr.insertText(typed.slice(0, -1), from, to)
    const preparedEnd = from + typed.length - 1
    const prepared = EditorState.create({
      schema: state.schema,
      doc: tr.doc,
      selection: TextSelection.create(tr.doc, preparedEnd),
      storedMarks: state.storedMarks,
    })
    const transformed = apply(prepared, match, start, preparedEnd)
    if (!transformed) return null
    transformed.steps.forEach((step) => tr.step(step))
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        transformed.selection.from,
        transformed.selection.to,
      ),
    )
    tr.setStoredMarks(transformed.storedMarks)
    return tr
  })
})

export const highlightKeymap = $useKeymap('highlightKeymap', {
  ToggleHighlight: {
    shortcuts: ['Mod-Shift-h'],
    command: (ctx) => () =>
      ctx.get(commandsCtx).call(toggleHighlightCommand.key),
  },
})

export const inlineHighlight = [
  remarkInlineHighlightPlugin,
  highlightSchema,
  toggleHighlightCommand,
  highlightInputRule,
  highlightKeymap,
].flat()
