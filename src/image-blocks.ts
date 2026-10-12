import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import {
  Fragment,
  type Node as ProseNode,
  type NodeType,
} from '@milkdown/kit/prose/model'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import type { ParserState } from '@milkdown/kit/transformer'
import { $nodeSchema, $prose } from '@milkdown/kit/utils'

export const imageBlockName = 'image_block'

/** Attributes shared by an inline image and a standalone image block. */
export const imageAttrs = {
  src: { default: '', validate: 'string' },
  alt: { default: '', validate: 'string' },
  title: { default: '', validate: 'string' },
  inkkitFileRaw: { default: null },
  inkkitFileTarget: { default: null },
  inkkitFileFragment: { default: null },
  inkkitFileWidth: { default: null },
  inkkitFileInTable: { default: false },
}

interface MarkdownImage {
  type: string
  url?: unknown
  alt?: unknown
  title?: unknown
  inkkitFileRaw?: unknown
  inkkitFileTarget?: unknown
  inkkitFileFragment?: unknown
  inkkitFileWidth?: unknown
  inkkitFileInTable?: unknown
  children?: MarkdownImage[]
}

// Remark represents a missing title as null; the image schema accepts strings.
export function markdownImageAttrs(node: MarkdownImage) {
  return {
    src: String(node.url ?? ''),
    alt: String(node.alt ?? ''),
    title: String(node.title ?? ''),
    inkkitFileRaw: node.inkkitFileRaw ?? null,
    inkkitFileTarget: node.inkkitFileTarget ?? null,
    inkkitFileFragment: node.inkkitFileFragment ?? null,
    inkkitFileWidth: node.inkkitFileWidth ?? null,
    inkkitFileInTable: node.inkkitFileInTable ?? false,
  }
}

/** Whether a node displays an authored image, inline or as its own block. */
export function isImage(node: ProseNode): boolean {
  return node.type.name === 'image' || node.type.name === imageBlockName
}

export function isImageBlock(node: ProseNode | null | undefined): boolean {
  return node?.type.name === imageBlockName
}

function accepts(parent: ProseNode, index: number, type: NodeType): boolean {
  return parent.canReplaceWith(index, index + 1, type)
}

/** Reads a Markdown paragraph holding one image and nothing else as an image block, where the
 *  enclosing block accepts one. Returns false when the paragraph stays a paragraph. */
export function openImageBlock(
  state: ParserState,
  node: MarkdownImage,
): boolean {
  const type = state.schema.nodes[imageBlockName]
  const parent = state.top() as
    { type: NodeType; content: ProseNode[] } | undefined
  const image = node.children?.length === 1 ? node.children[0] : undefined
  if (
    !type ||
    !parent ||
    image?.type !== 'image' ||
    !parent.type.contentMatch
      .matchFragment(Fragment.fromArray(parent.content))
      ?.matchType(type)
  )
    return false
  state.addNode(type, markdownImageAttrs(image))
  return true
}

// A standalone image is a block with no inside, so no edit can put text beside it. In Markdown it
// remains a paragraph holding the image, which is how it is read and written.
export const imageBlockSchema = $nodeSchema(imageBlockName, () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  marks: '',
  attrs: imageAttrs,
  toDOM: (node) => [
    'p',
    { class: 'inkkit-image-block' },
    [
      'img',
      {
        src: String(node.attrs.src),
        alt: String(node.attrs.alt),
        title: String(node.attrs.title),
      },
    ],
  ],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: {
    match: (node) => node.type.name === imageBlockName,
    runner: (state, node) => {
      state.openNode('paragraph')
      state.next(node.type.schema.nodes.image!.create(node.attrs))
      state.closeNode()
    },
  },
}))

/** Positions in the current document that the given transactions changed. */
function changedRanges(
  transactions: readonly Transaction[],
): [number, number][] {
  let ranges: [number, number][] = []
  for (const tr of transactions)
    for (const map of tr.mapping.maps) {
      ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)])
      map.forEach((_from, _to, start, end) => ranges.push([start, end]))
    }
  return ranges
}

// An edit can leave a paragraph holding only an image, which reading its Markdown again would give
// as an image block. The caret keeps its side of the image.
const normalise = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitImageBlockNormalise'),
      appendTransaction(transactions, _old, state) {
        const type = state.schema.nodes[imageBlockName]
        if (!type || !transactions.some((tr) => tr.docChanged)) return null
        const found = new Map<number, ProseNode>()
        const size = state.doc.content.size
        for (const [from, to] of changedRanges(transactions))
          state.doc.nodesBetween(
            Math.max(0, Math.min(from, size)),
            Math.max(0, Math.min(to, size)),
            (node, pos, parent, index) => {
              if (!node.isTextblock) return true
              if (
                node.type.name === 'paragraph' &&
                node.childCount === 1 &&
                node.firstChild!.type.name === 'image' &&
                parent &&
                accepts(parent, index, type)
              )
                found.set(pos, node)
              return false
            },
          )
        if (!found.size) return null
        const tr = state.tr
        const { head } = state.selection
        let caret: { pos: number; side: -1 | 1 } | undefined
        for (const [pos, node] of [...found].sort(([a], [b]) => b - a)) {
          const end = pos + node.nodeSize
          if (head > pos && head < end)
            caret = head > pos + 1 ? { pos: end, side: 1 } : { pos, side: -1 }
          tr.replaceWith(pos, end, type.create(node.firstChild!.attrs))
        }
        if (caret)
          tr.setSelection(
            new GapCursor(
              tr.doc.resolve(tr.mapping.map(caret.pos, caret.side)),
            ),
          )
        return tr
      },
    }),
)

/** The image block a selection rests beside or selects, as the position for a new paragraph. */
function newParagraphAt(state: EditorState): number | undefined {
  const { selection } = state
  if (selection instanceof NodeSelection && isImageBlock(selection.node))
    return selection.to
  if (
    selection instanceof GapCursor &&
    (isImageBlock(selection.$head.nodeBefore) ||
      isImageBlock(selection.$head.nodeAfter))
  )
    return selection.head
  return undefined
}

/** Opens an empty paragraph beside a selected image block, or at a gap beside one. */
function openParagraph(state: EditorState): Transaction | undefined {
  const pos = newParagraphAt(state)
  const paragraph = state.schema.nodes.paragraph
  if (pos == null || !paragraph) return undefined
  const $pos = state.doc.resolve(pos)
  if (!accepts($pos.parent, $pos.index(), paragraph)) return undefined
  const tr = state.tr.insert(pos, paragraph.create())
  return tr.setSelection(TextSelection.create(tr.doc, pos + 1))
}

const enter: Command = (state, dispatch) => {
  const tr = openParagraph(state)
  if (!tr) return false
  dispatch?.(tr.scrollIntoView())
  return true
}

/** Backspace or Delete toward an image block selects it before anything is deleted; from a gap beside
 *  one toward text, the caret moves into the text. An empty paragraph next to one is removed. */
function towardImage(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { selection, doc } = state
    if (!selection.empty) return false
    const $head = selection.$head
    if (selection instanceof GapCursor) {
      const node = dir < 0 ? $head.nodeBefore : $head.nodeAfter
      const other = dir < 0 ? $head.nodeAfter : $head.nodeBefore
      if (!node || !(isImageBlock(other) || isImageBlock(node))) return false
      const next = isImageBlock(node)
        ? NodeSelection.create(doc, dir < 0 ? $head.pos - 1 : $head.pos)
        : Selection.findFrom($head, dir, true)
      if (!next) return false
      dispatch?.(state.tr.setSelection(next).scrollIntoView())
      return true
    }
    if (!$head.parent.isTextblock || $head.depth === 0) return false
    const atEdge =
      dir < 0
        ? $head.parentOffset === 0
        : $head.parentOffset === $head.parent.content.size
    if (!atEdge) return false
    const index = $head.index(-1) + dir
    const parent = $head.node(-1)
    const neighbour =
      index >= 0 && index < parent.childCount ? parent.child(index) : undefined
    if (!isImageBlock(neighbour)) return false
    const block = dir < 0 ? $head.before() - 1 : $head.after()
    if (!dispatch) return true
    if (
      $head.parent.content.size === 0 &&
      $head.parent.type.name === 'paragraph'
    ) {
      const tr = state.tr.delete($head.before(), $head.after())
      dispatch(
        tr
          .setSelection(new GapCursor(tr.doc.resolve($head.before())))
          .scrollIntoView(),
      )
      return true
    }
    dispatch(
      state.tr.setSelection(NodeSelection.create(doc, block)).scrollIntoView(),
    )
    return true
  }
}

const keys = keydownHandler({
  Enter: enter,
  'Shift-Enter': enter,
  Backspace: towardImage(-1),
  Delete: towardImage(1),
})

const interaction = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitImageBlocks'),
      props: {
        handleKeyDown: (view, event) =>
          !view.composing && view.editable && keys(view, event),
        handleTextInput(view, _from, _to, text) {
          const tr = openParagraph(view.state)
          if (!tr) return false
          view.dispatch(tr.insertText(text).scrollIntoView())
          return true
        },
        // A click beside an image card, not on it, puts the caret after the image.
        handleClickOn(view, _pos, node, nodePos, event, direct) {
          if (
            !direct ||
            !view.editable ||
            !isImageBlock(node) ||
            !(event.target instanceof Element) ||
            event.target.closest('.image')
          )
            return false
          view.dispatch(
            view.state.tr.setSelection(
              new GapCursor(view.state.doc.resolve(nodePos + node.nodeSize)),
            ),
          )
          return true
        },
        handleDOMEvents: {
          // ProseMirror replaces a selection when composition starts; a selected image is kept and
          // the composed text goes after it.
          compositionstart(view) {
            const { selection } = view.state
            if (
              view.editable &&
              selection instanceof NodeSelection &&
              isImageBlock(selection.node)
            )
              view.dispatch(
                view.state.tr.setSelection(
                  new GapCursor(view.state.doc.resolve(selection.to)),
                ),
              )
            return false
          },
          // Composed text needs a paragraph to land in before the browser writes it, as the gap
          // cursor plugin does for its own gaps.
          beforeinput(view, event) {
            if (event.inputType !== 'insertCompositionText' || !view.editable)
              return false
            const tr = openParagraph(view.state)
            if (tr) view.dispatch(tr)
            return false
          },
        },
      },
    }),
)

export const imageBlocks: MilkdownPlugin[] = [
  imageBlockSchema,
  normalise,
  interaction,
].flat()
