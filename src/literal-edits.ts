import { parserCtx } from '@milkdown/kit/core'
import { exitCode } from '@milkdown/kit/prose/commands'
import { keymap } from '@milkdown/kit/prose/keymap'
import {
  Fragment,
  type Node as ProseNode,
  type ResolvedPos,
} from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { isWrittenEdit } from './comments'
import { literalSource } from './literals'

const isLiteral = (node: ProseNode) => node.type.name === 'literal_markdown'

// A literal block holds Markdown source, and a line ending at its end is not
// something Markdown can hold there. Enter at its end therefore starts an
// empty paragraph after it, as Enter does at the end of a paragraph.
export const literalEnter = $prose(() =>
  keymap({
    Enter: (state, dispatch) => {
      const { $head, empty } = state.selection
      if (
        !empty ||
        !isLiteral($head.parent) ||
        $head.parentOffset !== $head.parent.content.size
      )
        return false
      return exitCode(state, dispatch)
    },
  }),
)

// The literal blocks the edit from `before` to `after` changed. A literal
// block an edit only meets, such as one before a new paragraph, is left as
// it was loaded.
function changedLiterals(
  before: ProseNode,
  after: ProseNode,
): Array<{ node: ProseNode; pos: number }> {
  const start = before.content.findDiffStart(after.content)
  if (start == null) return []
  const end = before.content.findDiffEnd(after.content)!
  const collect = (doc: ProseNode, from: number, to: number) => {
    const found = new Map<number, ProseNode>()
    const around = ($pos: ResolvedPos) => {
      for (let depth = $pos.depth; depth > 0; depth--)
        if (isLiteral($pos.node(depth)))
          found.set($pos.before(depth), $pos.node(depth))
    }
    const low = Math.min(from, to)
    const high = Math.max(from, to)
    around(doc.resolve(low))
    around(doc.resolve(high))
    doc.nodesBetween(low, high, (node, pos) => {
      if (isLiteral(node)) found.set(pos, node)
      return !node.isTextblock
    })
    return found
  }
  const old = [...collect(before, start, end.a).values()]
  return [...collect(after, start, end.b)]
    .filter(([, node]) => !old.some((literal) => literal.eq(node)))
    .map(([pos, node]) => ({ node, pos }))
}

// Where the caret goes in `blocks` that replace a literal block, given the
// literal text before and after it. Formatting can change the text, so the
// caret is placed by the blocks and visible text the source before it reads
// as. A caret on a line that is now blank goes to the start of the next block.
function caretOffset(
  blocks: Fragment,
  head: string,
  rest: string,
  parse: (markdown: string) => ProseNode,
): number | undefined {
  let read: ProseNode
  try {
    read = parse(head)
  } catch {
    return undefined
  }
  const line = /\r?\n[ \t]*$/.test(head)
  const fresh =
    !read.childCount ||
    (line &&
      (/\n[ \t]*\r?\n[ \t]*$/.test(head) || /^[ \t]*(?:\r?\n|$)/.test(rest)))
  const index = fresh ? read.childCount : read.childCount - 1
  if (index >= blocks.childCount) return undefined
  let pos = 0
  for (let at = 0; at < index; at++) pos += blocks.child(at).nodeSize
  const block = blocks.child(index)
  if (!block.isTextblock) return undefined
  // Reading drops the line ending and spaces that end the text before the
  // caret, which the block still holds.
  let remaining = fresh
    ? 0
    : read.child(index).textContent.length +
      (line ? 1 : (/[ \t]+$/.exec(head)?.[0].length ?? 0))
  let offset = 0
  block.forEach((child) => {
    if (remaining <= 0) return
    const length = child.isText ? child.text!.length : 1
    const step = Math.min(length, remaining)
    offset += step
    remaining -= step
  })
  return pos + 1 + offset
}

// The blocks an edited literal block's text reads as, when that is no longer
// the literal block itself: the text that made it literal was removed, or a
// blank line now separates it into blocks. Undefined when it still reads as
// one literal block, or when the blocks would not hold all of its text.
function reread(
  node: ProseNode,
  parse: (markdown: string) => ProseNode,
): Fragment | undefined {
  const text = literalSource(node)
  // A paragraph's text does not open with spaces or line endings, or end with
  // line endings, so blocks read from such text would lose them.
  if (!text.trim() || /^\s/.test(text) || /[\r\n]$/.test(text)) return undefined
  let read: ProseNode
  try {
    read = parse(text)
  } catch {
    return undefined
  }
  if (read.childCount === 1 && isLiteral(read.firstChild!)) return undefined
  let content = read.content
  // Spaces at the end of a paragraph are text the person typed, such as the
  // space before the next word.
  const trailing = /[ \t]+$/.exec(text)?.[0]
  if (trailing) {
    const last = read.lastChild!
    if (read.childCount !== 1 || last.type.name !== 'paragraph')
      return undefined
    content = Fragment.from(
      last.copy(
        last.content.append(Fragment.from(read.type.schema.text(trailing))),
      ),
    )
  }
  return content
}

// Reads an edited literal block again when its text no longer needs to be
// literal, and replaces it with the blocks it reads as, in the same undo step
// as the edit. Saving then keeps the authored text of every other block, and
// what cannot be reopened as the document is still refused.
export const literalReread = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('literalReread'),
      appendTransaction(transactions, before, after) {
        if (
          !transactions.some(
            (tr) =>
              tr.docChanged &&
              isWrittenEdit(tr) &&
              tr.getMeta('addToHistory') !== false,
          )
        )
          return null
        const parse = ctx.get(parserCtx)
        const first = before.doc.firstChild
        const frontMatter =
          first != null &&
          isLiteral(first) &&
          /^(?:---|\+\+\+)[ \t]*\r?\n/.test(first.textContent)
        let tr: Transaction | undefined
        const literals = changedLiterals(before.doc, after.doc).sort(
          (left, right) => right.pos - left.pos,
        )
        for (const { node, pos } of literals) {
          // Front matter is read from the start of the file, and stays as
          // written while a person edits it, its delimiters included.
          if (pos === 0 && frontMatter) continue
          const blocks = reread(node, parse)
          if (!blocks) continue
          const $pos = after.doc.resolve(pos)
          const index = $pos.index()
          if (!$pos.parent.canReplace(index, index + 1, blocks)) continue
          tr ??= after.tr
          const { head } = after.selection
          const inside = head > pos && head < pos + node.nodeSize
          tr.replaceWith(pos, pos + node.nodeSize, blocks)
          if (inside) {
            const source = literalSource(node)
            const typed = literalSource(node, head - pos - 1)
            const caret = caretOffset(
              blocks,
              typed,
              source.slice(typed.length),
              parse,
            )
            const target = Math.min(
              pos + (caret ?? blocks.size),
              tr.doc.content.size,
            )
            tr.setSelection(TextSelection.near(tr.doc.resolve(target), -1))
          }
        }
        return tr ?? null
      },
    }),
)
