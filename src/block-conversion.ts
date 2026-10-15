import type { Ctx } from '@milkdown/kit/ctx'
import { parserCtx, serializerCtx } from '@milkdown/kit/core'
import { InputRule, undoInputRule } from '@milkdown/kit/prose/inputrules'
import {
  Fragment,
  type Attrs,
  type Node as ProseNode,
  type NodeType,
  type ResolvedPos,
} from '@milkdown/kit/prose/model'
import {
  TextSelection,
  type Command,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { $ctx, $inputRule, $shortcut } from '@milkdown/kit/utils'
import { mac } from './modifier'

// ProseMirror changes a block's type by removing whatever the new type cannot
// hold, so a paragraph turned into code loses its comments, footnote
// references, line breaks, images and formatting, and code turned into a
// paragraph loses its line breaks. Here a code block holds the Markdown source
// of the paragraph or heading it came from, and code becomes a paragraph or
// heading whose text is the code's characters, line by line.

/**
 * Finds the authored Markdown of the textblocks at `positions`, in document
 * order: for each, the source text its inline content was read from, which
 * on a continuation line still starts with any marker of the quote or list
 * around it. A block left out uses InkKit's own form of its content. The
 * editor provides one that reads the document's preserved source.
 */
export type AuthoredSources = (
  doc: ProseNode,
  positions: readonly number[],
) => ReadonlyMap<number, string>

export const authoredSourcesCtx = $ctx<
  AuthoredSources | null,
  'inkkitAuthoredSources'
>(null, 'inkkitAuthoredSources')

/** The block types a conversion changes. Comment and literal blocks also hold code, but keep their own syntax. */
const isCode = (type: NodeType) => type.name === 'code_block'
const isText = (type: NodeType) =>
  type.name === 'paragraph' || type.name === 'heading'
const convertible = (type: NodeType) => isCode(type) || isText(type)
const keepsSyntax = (type: NodeType) =>
  type.name === 'comment_block' || type.name === 'literal_markdown'

/** The Markdown of a textblock's inline content, as InkKit writes it. */
export function writtenInlineSource(ctx: Ctx, node: ProseNode): string {
  if (!node.content.size) return ''
  const { schema } = node.type
  const doc = schema.topNodeType.create(null, [
    schema.nodes.paragraph!.create(null, node.content),
  ])
  return ctx.get(serializerCtx)(doc).replace(/\n$/, '')
}

/** Whether `text` is the Markdown of exactly `node`'s inline content: it reads back as one paragraph holding the same content. */
function isInlineSource(ctx: Ctx, node: ProseNode, text: string): boolean {
  try {
    const doc = ctx.get(parserCtx)(text)
    return (
      doc.childCount === 1 &&
      doc.firstChild!.type.name === 'paragraph' &&
      doc.firstChild!.content.eq(node.content)
    )
  } catch {
    return false
  }
}

/**
 * Removes from each continuation line the markers that the quotes, callouts
 * and list items around the block at `pos` add to it.
 */
function withoutContainers(doc: ProseNode, pos: number, text: string): string {
  const $pos = doc.resolve(pos)
  let prefix = ''
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const name = $pos.node(depth).type.name
    if (name === 'blockquote' || name === 'inkkit_callout')
      prefix += '(?:[ \\t]{0,3}>[ \\t]?)?'
    else if (name === 'list_item' || name === 'footnote_definition')
      prefix += '[ \\t]*'
  }
  if (!prefix) return text
  const marker = new RegExp(`^${prefix}`)
  return text
    .split('\n')
    .map((line, index) => (index ? line.replace(marker, '') : line))
    .join('\n')
}

/** The Markdown source of the inline content of each textblock at `positions`. */
export function inlineSources(
  ctx: Ctx,
  doc: ProseNode,
  positions: readonly number[],
): Map<number, string> {
  const filled = positions.filter((pos) => doc.nodeAt(pos)!.content.size)
  const authored =
    filled.length && ctx.isInjected(authoredSourcesCtx.key)
      ? ctx.get(authoredSourcesCtx.key)?.(doc, filled)
      : undefined
  const sources = new Map<number, string>()
  for (const pos of positions) {
    const node = doc.nodeAt(pos)!
    const found = authored?.get(pos)
    const text =
      found === undefined
        ? undefined
        : withoutContainers(doc, pos, found.replace(/\r\n?/g, '\n'))
    sources.set(
      pos,
      !node.content.size
        ? ''
        : text !== undefined && isInlineSource(ctx, node, text)
          ? text
          : writtenInlineSource(ctx, node),
    )
  }
  return sources
}

/** Replaces only the part of the textblock at `pos` that differs from `content`, so a caret elsewhere in it stays put. */
function replaceContent(tr: Transaction, pos: number, content: Fragment) {
  const current = tr.doc.nodeAt(pos)!.content
  const start = current.findDiffStart(content)
  if (start == null) return
  let { a, b } = current.findDiffEnd(content)!
  const overlap = start - Math.min(a, b)
  if (overlap > 0) {
    a += overlap
    b += overlap
  }
  tr.replaceWith(pos + 1 + start, pos + 1 + a, content.cut(start, b))
}

/** Changes the textblock at `pos` to `type`, keeping everything it holds; `source` is its inline source when it becomes code. */
function convert(
  tr: Transaction,
  pos: number,
  type: NodeType,
  attrs: Attrs | null,
  source: string | undefined,
) {
  const node = tr.doc.nodeAt(pos)!
  const { schema } = type
  if (isCode(type) && !isCode(node.type)) {
    const text = source ?? ''
    replaceContent(
      tr,
      pos,
      text ? Fragment.from(schema.text(text)) : Fragment.empty,
    )
    tr.setNodeMarkup(pos, type, attrs)
  } else if (isCode(node.type) && !isCode(type)) {
    tr.setNodeMarkup(pos, type, attrs)
    // A soft line break, so each line of code is a line of the paragraph.
    const breaks: Array<[number, number]> = []
    node.forEach((child, offset) => {
      for (const line of child.text?.matchAll(/\r\n?|\n/g) ?? [])
        breaks.push([pos + 1 + offset + line.index, line[0].length])
    })
    for (const [at, length] of breaks.reverse())
      tr.replaceWith(
        at,
        at + length,
        schema.nodes.hardbreak!.create({ isInline: true }),
      )
  } else {
    tr.setBlockType(pos + 1, pos + 1, type, attrs)
  }
}

function changeable(doc: ProseNode, pos: number, type: NodeType): boolean {
  const node = doc.nodeAt(pos)!
  if (!convertible(node.type) || !convertible(type)) return false
  const $pos = doc.resolve(pos)
  const index = $pos.index()
  return $pos.parent.canReplaceWith(index, index + 1, type)
}

/**
 * Changes the textblocks between `from` and `to` to `type`, keeping what they
 * hold: a code block holds the Markdown source of a paragraph or heading, and a
 * paragraph or heading made from code holds the code's characters and lines.
 * Returns whether any block could change.
 */
export function convertTextblocks(
  ctx: Ctx,
  tr: Transaction,
  from: number,
  to: number,
  type: NodeType,
  attrs: Attrs | null = null,
): boolean {
  const targets: number[] = []
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (
      !node.hasMarkup(type, attrs ?? undefined) &&
      changeable(tr.doc, pos, type)
    )
      targets.push(pos)
    return false
  })
  const sources = isCode(type)
    ? inlineSources(
        ctx,
        tr.doc,
        targets.filter((pos) => !isCode(tr.doc.nodeAt(pos)!.type)),
      )
    : undefined
  const start = tr.steps.length
  for (const pos of targets)
    convert(
      tr,
      tr.mapping.slice(start).map(pos, 1),
      type,
      attrs,
      sources?.get(pos),
    )
  return targets.length > 0
}

/** A command that changes the selected textblocks to `type`; see {@link convertTextblocks}. */
export function setTextblockType(
  ctx: Ctx,
  type: NodeType,
  attrs: Attrs | null = null,
): Command {
  return (state, dispatch) => {
    const tr = state.tr
    let applicable = false
    for (const { $from, $to } of state.selection.ranges) {
      if (!dispatch) {
        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          if (applicable || !node.isTextblock) return !applicable
          applicable =
            !node.hasMarkup(type, attrs ?? undefined) &&
            changeable(state.doc, pos, type)
          return false
        })
      } else if (convertTextblocks(ctx, tr, $from.pos, $to.pos, type, attrs))
        applicable = true
    }
    if (applicable && dispatch) dispatch(tr.scrollIntoView())
    return applicable
  }
}

/**
 * Replaces the preset's rule, so typing a fence at the start of a paragraph
 * keeps the rest of it as code source.
 */
export const codeBlockInputRule = $inputRule(
  (ctx) =>
    new InputRule(
      /^```(?<language>[a-z]*)?[\s\n]$/,
      (state, match, start, end) => {
        const type = codeBlockSchema.type(ctx)
        const $start = state.doc.resolve(start)
        if (
          !$start
            .node(-1)
            .canReplaceWith($start.index(-1), $start.indexAfter(-1), type)
        )
          return null
        const tr = state.tr.delete(start, end)
        convertTextblocks(ctx, tr, start, start, type, {
          language: match.groups?.language ?? '',
        })
        return tr
      },
    ),
)

/** The textblock edge the caret is at, when it is the start (`-1`) or end (`1`) of one. */
function caretAtEdge(
  selection: TextSelection | undefined,
  dir: -1 | 1,
): ResolvedPos | undefined {
  const $cursor = selection?.$cursor
  if (!$cursor?.parent.isTextblock) return undefined
  const offset = dir < 0 ? 0 : $cursor.parent.content.size
  return $cursor.parentOffset === offset ? $cursor : undefined
}

/**
 * Backspace and Delete join two textblocks by removing whatever the first
 * cannot hold. Where code and a paragraph or heading meet, the second is
 * first converted to the type of the first, so the join keeps all of it.
 */
function joinKeepingSource(ctx: Ctx, dir: -1 | 1): Command {
  return (state, dispatch) => {
    const selection =
      state.selection instanceof TextSelection ? state.selection : undefined
    const $edge = caretAtEdge(selection, dir)
    if (!$edge || $edge.depth < 1) return false
    const index = $edge.index($edge.depth - 1) + (dir < 0 ? -1 : 1)
    const parent = $edge.node($edge.depth - 1)
    if (index < 0 || index >= parent.childCount) return false
    const neighbour = parent.child(index)
    const pair = [neighbour.type, $edge.parent.type]
    if (
      !neighbour.isTextblock ||
      // An empty block is deleted rather than joined, and Backspace first
      // takes back a fence the person has just typed.
      !neighbour.content.size ||
      !$edge.parent.content.size ||
      (dir < 0 && undoInputRule(state)) ||
      // Backspace at the start of a heading first lowers it, as elsewhere.
      (dir < 0 && $edge.parent.type.name === 'heading')
    )
      return false
    // A comment or literal block written beside another kind of block keeps
    // its syntax: joining would move text into it or out of its delimiters.
    if (neighbour.type !== $edge.parent.type && pair.some(keepsSyntax))
      return true
    if (!pair.some(isCode) || !pair.some(isText)) return false
    const before = dir < 0 ? neighbour : $edge.parent
    // The boundary between the two blocks, and the second block's position.
    const cut = dir < 0 ? $edge.before() : $edge.after()
    if (!dispatch) return true
    const tr = state.tr
    convertTextblocks(ctx, tr, cut + 1, cut + 1, before.type, before.attrs)
    tr.join(cut)
    // The caret goes where the two blocks met.
    tr.setSelection(TextSelection.create(tr.doc, cut - 1))
    dispatch(tr.scrollIntoView())
    return true
  }
}

export const joinKeepingSourceKeymap = $shortcut((ctx) => {
  const keys = (names: string[], dir: -1 | 1) =>
    Object.fromEntries(
      names.map((key) => [
        key,
        { key, onRun: () => joinKeepingSource(ctx, dir), priority: 60 },
      ]),
    )
  // The keys ProseMirror's base keymap binds to joining backward and forward.
  return {
    ...keys(
      [
        'Backspace',
        'Mod-Backspace',
        'Shift-Backspace',
        ...(mac ? ['Ctrl-h', 'Alt-Backspace'] : []),
      ],
      -1,
    ),
    ...keys(
      [
        'Delete',
        'Mod-Delete',
        ...(mac ? ['Ctrl-d', 'Ctrl-Alt-Backspace', 'Alt-Delete', 'Alt-d'] : []),
      ],
      1,
    ),
  }
})
