import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import {
  Fragment,
  type Node as ProseNode,
  type NodeType,
  type ResolvedPos,
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
import { CellSelection } from '@milkdown/kit/prose/tables'
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

interface MarkdownParagraph {
  children?: unknown[]
  value?: unknown
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

const cellTypes = new Set(['table_cell', 'table_header'])

function cellDepth($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth--)
    if (cellTypes.has($pos.node(depth).type.name)) return depth
  return 0
}

export type ImagePlacement =
  { kind: 'blocks' } | { kind: 'inline' } | { kind: 'after'; pos: number }

/** Where `insertImages` puts images for a selection. `blocks` replaces the selection with one block per
 *  image. `inline` places them on the one line of a table cell, which cannot hold blocks. `after` puts
 *  them below the nearest block that takes a following paragraph, leaving the selection and its
 *  block as written: the selection is in source that cannot hold an image, such as code, a comment
 *  or an unsupported literal block, or it spans table cells. Nothing is ever split or discarded. */
export function imagePlacement(state: EditorState): ImagePlacement {
  const image = state.schema.nodes.image
  const paragraph = state.schema.nodes.paragraph
  const { selection } = state
  const { $from, $to } = selection
  const unfit =
    selection instanceof CellSelection ||
    [$from, $to].some(
      ({ parent }) =>
        parent.inlineContent &&
        !(image && parent.type.contentMatch.matchType(image)),
    )
  const from = cellDepth($from)
  const to = cellDepth($to)
  if (!unfit && !from && !to) return { kind: 'blocks' }
  if (!unfit && from && to && $from.sameParent($to)) return { kind: 'inline' }
  for (let depth = $to.depth; depth > 0; depth--) {
    const node = $to.node(depth)
    const parent = $to.node(depth - 1)
    if (node.isInline) continue
    const index = $to.index(depth - 1) + 1
    if (paragraph && parent.canReplaceWith(index, index, paragraph))
      return { kind: 'after', pos: $to.after(depth) }
  }
  return { kind: 'after', pos: state.doc.content.size }
}

/** The image a paragraph holds as its only content, without marks, which makes the paragraph a
 *  standalone image block. A linked or emphasised image stays inline so its marks are kept. */
export function standaloneImage(
  children: readonly ProseNode[],
): ProseNode | undefined {
  const [image] = children
  return children.length === 1 &&
    image!.type.name === 'image' &&
    !image!.marks.length
    ? image
    : undefined
}

/** Reads a Markdown paragraph, as an image block when it holds a standalone image and the enclosing
 *  block accepts one. */
export function readParagraph(
  state: ParserState,
  node: MarkdownParagraph,
  paragraph: NodeType,
): void {
  state.openNode(paragraph)
  if (node.children) state.next(node.children as never)
  else state.addText(String(node.value ?? ''))
  const type = state.schema.nodes[imageBlockName]
  const element = state.top() as { content: ProseNode[] }
  const image = standaloneImage(element.content)
  state.close()
  const parent = state.top() as
    { type: NodeType; content: ProseNode[] } | undefined
  const content = Fragment.fromArray(parent?.content ?? [])
  // A parent that must open with other content, such as a list item that
  // opens with a code fence, is filled in front of it when it closes.
  const filler = parent?.type.contentMatch.fillBefore(content)
  if (
    image &&
    type &&
    filler &&
    parent?.type.contentMatch
      .matchFragment(filler.append(content))
      ?.matchType(type)
  )
    state.addNode(type, image.attrs)
  else {
    state.openNode(paragraph)
    for (const child of element.content) state.top()!.push(child)
    state.closeNode()
  }
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

// An edit can leave a paragraph holding only an image, which reading its Markdown again would give
// as an image block. The caret keeps its side of the image.
const normalise = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitImageBlockNormalise'),
      appendTransaction(transactions, old, state) {
        const type = state.schema.nodes[imageBlockName]
        if (!type || !transactions.some((tr) => tr.docChanged)) return null
        // Compare the documents, as mark and attribute steps change no positions.
        const start = old.doc.content.findDiffStart(state.doc.content)
        const end = old.doc.content.findDiffEnd(state.doc.content)
        if (start == null || !end) return null
        const found = new Map<number, ProseNode>()
        state.doc.nodesBetween(
          Math.min(start, end.b),
          Math.max(start, end.b),
          (node, pos, parent, index) => {
            if (!node.isTextblock) return true
            const children: ProseNode[] = []
            node.forEach((child) => children.push(child))
            if (
              node.type.name === 'paragraph' &&
              standaloneImage(children) &&
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
    // An empty paragraph goes, unless its parent needs it, such as a list item's first line.
    if (
      $head.parent.content.size === 0 &&
      $head.parent.type.name === 'paragraph' &&
      parent.canReplace($head.index(-1), $head.index(-1) + 1)
    ) {
      const tr = state.tr.delete($head.before(), $head.after())
      dispatch?.(
        tr
          .setSelection(new GapCursor(tr.doc.resolve($head.before())))
          .scrollIntoView(),
      )
      return true
    }
    if (!dispatch) return true
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
