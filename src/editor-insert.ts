import type { EditorView } from '@milkdown/kit/prose/view'
import { closeHistory } from '@milkdown/kit/prose/history'
import {
  Fragment,
  Slice,
  type Node as ProseNode,
  type Schema,
} from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { ImageInsertion } from './editor'
import type { ClientPoint } from './types'
import { literalTextNodes } from './literal-text'
import { hiddenCommentExit, insertAfterHiddenComment } from './hidden-comments'
import { replacementMarks } from './text-input'
import { htmlBreakAt } from './hard-break'
import { imagePlacement } from './image-blocks'
import { blockDropRange } from './drop-placement'

export function insertPlainText(view: EditorView, text: string): void {
  const inHiddenComment = hiddenCommentExit(view.state) !== undefined
  if (view.state.selection.$from.parent.type.spec.code && !inHiddenComment) {
    view.dispatch(
      view.state.tr.insertText(text.replace(/\r\n?/g, '\n')).scrollIntoView(),
    )
  } else {
    const { schema } = view.state
    const { from, to } = view.state.selection
    const marks = replacementMarks(view.state, from, to)
    const isHTML = !inHiddenComment && htmlBreakAt(view.state.selection.$from)
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
      view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
  }
}

export function insertNativeText(view: EditorView, text: string): boolean {
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

export function insertPaths(
  view: EditorView,
  paths: string[],
  point: ClientPoint,
): void {
  const { schema } = view.state
  insertBlocks(
    view,
    paths.map((path) =>
      schema.nodes.paragraph!.create(null, schema.text(path)),
    ),
    point,
  )
}

export function insertImages(
  view: EditorView,
  images: ImageInsertion[],
  point: ClientPoint | undefined,
  focus: () => void,
): boolean {
  const placement = point ? undefined : imagePlacement(view.state)
  if (placement?.kind === 'inline') {
    insertInlineImages(view, images)
    return true
  }
  const blocks = imageBlocks(view.state.schema, images)
  if (point) {
    insertBlocks(view, blocks, point)
    focus()
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

export function appendImages(
  view: EditorView,
  images: ImageInsertion[],
  currentText: () => string,
): boolean {
  const { doc, tr } = view.state
  const blocks = imageBlocks(view.state.schema, images)
  // An empty document is one empty paragraph, which would save as `<br />` ahead of the images.
  const empty =
    doc.childCount === 1 &&
    doc.firstChild!.type.name === 'paragraph' &&
    doc.firstChild!.content.size === 0 &&
    currentText().trim() === ''
  if (empty) tr.replaceWith(0, doc.content.size, blocks)
  else tr.insert(doc.content.size, blocks)
  // A step of its own, so neither earlier nor later typing joins it.
  view.dispatch(closeHistory(tr))
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
  return true
}

// One paragraph per image: each is read back as a standalone image block where one fits.
function imageBlocks(schema: Schema, images: ImageInsertion[]): ProseNode[] {
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
function insertInlineImages(view: EditorView, images: ImageInsertion[]): void {
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

function insertBlocks(
  view: EditorView,
  blocks: ProseNode[],
  point: ClientPoint,
): void {
  const { from: at, to } = blockDropRange(view, point.clientX, point.clientY)
  const tr = view.state.tr.replaceWith(at, to, blocks)
  const end = at + blocks.reduce((size, node) => size + node.nodeSize, 0) - 1
  view.dispatch(
    tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView(),
  )
}
