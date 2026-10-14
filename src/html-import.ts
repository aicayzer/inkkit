import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  Fragment,
  Slice,
  type Mark,
  type Node,
  type Schema,
} from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import type { Nodes, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal'
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote'
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item'
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item'
import { commentSource, commentTextEndsEarly } from './comments'
import { imageBlockName } from './image-blocks'
import { serialize } from './dialect'
import { isSafeLinkTarget, isScriptAddress } from './link-safety'
import { semanticSignature } from './preserve'
import { singleLine } from './references'

// HTML can carry values that the Markdown writer saves as they are, so content
// imported from HTML is kept only where its saved Markdown reads back as the
// same structure in InkKit, and where no reading of it holds an address that
// HTML import refuses. InkKit's own syntax, such as wiki links, literal source
// and comments, is read differently by other apps, so the saved Markdown is
// also read as GitHub Flavored Markdown, as strict CommonMark, and as
// CommonMark with raw HTML turned off.

const standard = () => ({
  extensions: [
    gfmAutolinkLiteral(),
    gfmFootnote(),
    gfmStrikethrough(),
    gfmTable(),
    gfmTaskListItem(),
  ],
  mdastExtensions: [
    gfmAutolinkLiteralFromMarkdown(),
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  ],
})

// An app that turns raw HTML off reads the Markdown inside HTML as text.
const withoutRawHTML = {
  extensions: [{ disable: { null: ['htmlFlow', 'htmlText'] } }],
}

function standardTree(markdown: string): Root {
  return fromMarkdown(markdown, standard())
}

function safeAddresses(markdown: string): boolean {
  // A scheme needs a colon, written as itself or as a character reference.
  if (!/[:&]/.test(markdown)) return true
  const visit = (node: Nodes): boolean => {
    if (
      (node.type === 'link' || node.type === 'definition') &&
      !isSafeLinkTarget(node.url)
    )
      return false
    if (node.type === 'image' && isScriptAddress(node.url)) return false
    return !('children' in node) || node.children.every(visit)
  }
  return (
    visit(standardTree(markdown)) &&
    visit(fromMarkdown(markdown)) &&
    visit(fromMarkdown(markdown, withoutRawHTML))
  )
}

class Check {
  constructor(
    private readonly ctx: Ctx,
    readonly schema: Schema,
  ) {}

  private base?: EditorState

  /**
   * The document as the editor holds it once inserted, after the editor's
   * plugins have normalised it, such as a paragraph holding only an image
   * becoming an image block.
   */
  private settled(doc: Node): Node {
    this.base ??= EditorState.create({
      schema: this.schema,
      plugins: this.ctx.get(editorViewCtx).state.plugins,
    })
    const { state } = this.base.applyTransaction(
      this.base.tr.replaceWith(0, this.base.doc.content.size, doc.content),
    )
    return state === this.base ? doc : state.doc
  }

  /** Whether these blocks, saved and read back, give the same structure. */
  readsBack(blocks: readonly Node[]): boolean {
    return this.reading(blocks) === true
  }

  /**
   * The blocks in a form that reads back as itself: as they are, or as their
   * Markdown reads back when the only difference is a link that the reader
   * makes of text, such as a bare web address.
   */
  kept(blocks: readonly Node[]): Node[] | undefined {
    const reading = this.reading(blocks)
    if (reading === true) return [...blocks]
    if (!reading || !reading.autolinks) return undefined
    const children = reading.reread.children
    return this.readsBack(children) ? [...children] : undefined
  }

  private reading(
    blocks: readonly Node[],
  ): true | { reread: Node; autolinks: boolean } | undefined {
    try {
      const doc = this.schema.topNodeType.createChecked(null, blocks)
      const markdown = serialize(this.ctx, doc)
      const reread = this.ctx.get(parserCtx)(markdown)
      const read = semanticSignature(reread)
      if (
        read === semanticSignature(doc) ||
        read === this.settledSignature(doc)
      )
        return safeAddresses(markdown) || undefined
      return {
        reread,
        autolinks:
          semanticSignature(withoutAutolinks(reread)) ===
          this.settledSignature(doc),
      }
    } catch {
      return undefined
    }
  }

  private settledSignature(doc: Node): string {
    return semanticSignature(this.settled(doc))
  }

  /** Index of the first block that reads back differently in context. */
  firstDifference(blocks: readonly Node[]): number {
    try {
      const doc = this.schema.topNodeType.createChecked(null, blocks)
      const reread = this.ctx.get(parserCtx)(serialize(this.ctx, doc))
      const settled = this.settled(doc)
      const signature = (node: Node) =>
        semanticSignature(this.schema.topNodeType.create(null, node))
      for (let index = 0; index < settled.childCount; index++)
        if (
          index >= reread.childCount ||
          signature(settled.child(index)) !== signature(reread.child(index))
        )
          return index
    } catch {
      return 0
    }
    // The structure matches, so an address is unsafe only in context.
    return blocks.findIndex((block) => !isPlain(block))
  }
}

// An address that GitHub Flavored Markdown reads from text as a link.
function autolink(href: string, text: string): boolean {
  return [text, `http://${text}`, `mailto:${text}`].includes(href)
}

function withoutAutolinks(node: Node): Node {
  if (node.isText)
    return node.mark(
      node.marks.filter(
        (mark) =>
          mark.type.name !== 'link' ||
          !autolink(String(mark.attrs.href), node.text!),
      ),
    )
  if (node.isLeaf) return node
  return node.copy(Fragment.fromArray(node.children.map(withoutAutolinks)))
}

function isPlain(node: Node): boolean {
  if (node.type.name !== 'paragraph') return false
  let plain = true
  node.forEach((child) => {
    if (!child.isText || child.marks.length) plain = false
  })
  return plain
}

function leafText(node: Node): string {
  switch (node.type.name) {
    case 'image':
    case imageBlockName:
      return String(node.attrs.alt ?? '')
    case 'footnote_reference':
      return `[${String(node.attrs.label ?? '')}]`
    case 'inkkit_wiki_link':
      return String(node.attrs.label || node.attrs.target || '')
    case 'hardbreak':
      return '\n'
    case 'html':
      return String(node.attrs.value ?? '')
    default:
      return node.textContent
  }
}

function text(schema: Schema, value: string, marks?: readonly Mark[]) {
  return value ? [schema.text(value, marks)] : []
}

/** The node's text as plain paragraphs, one for each line that has text. */
function paragraphs(check: Check, node: Node): Node[] {
  const { schema } = check
  const source = node.isLeaf
    ? leafText(node)
    : node.textBetween(0, node.content.size, '\n', leafText)
  const result: Node[] = []
  for (const line of source.split(/\r\n?|\n/)) {
    const value = line.trim()
    if (!value) continue
    const paragraph = schema.nodes.paragraph!.create(null, schema.text(value))
    result.push(...(check.kept([paragraph]) ?? []))
  }
  return result
}

function codeBlock(schema: Schema, value: string): Node {
  return schema.nodes.code_block!.create(null, text(schema, value))
}

function literalSource(node: Node): string {
  let source = ''
  node.forEach((child) => {
    source += child.isText ? child.text : commentSource(child)
  })
  return source
}

/**
 * Whether other readers take the comment as InkKit does: its text must not end
 * it early, and GitHub Flavored Markdown, which has no `%%` comments, must
 * read the text of one as plain text.
 */
function commentHolds(node: Node): boolean {
  const body = node.textContent
  if (commentTextEndsEarly(String(node.attrs.syntax), body)) return false
  if (node.attrs.syntax === 'html') return true
  const source = commentSource(node)
  const { children } = standardTree(source)
  const paragraph = children[0]
  const only = paragraph?.type === 'paragraph' ? paragraph.children : []
  return (
    children.length === 1 &&
    only.length === 1 &&
    only[0]!.type === 'text' &&
    only[0].value === source
  )
}

function plainComment(check: Check, node: Node): Node[] {
  const { schema } = check
  const body = singleLine(node.textContent).trim()
  if (node.isInline) return text(schema, body)
  return [schema.nodes.paragraph!.create(null, text(schema, body))]
}

/**
 * Literal source and comments: InkKit shows their text, so they are kept only
 * where every reading agrees. A literal that does not read back as itself,
 * ending where it was written, becomes a code block with the same text. A
 * `%%` comment whose text other readers would take as Markdown becomes an HTML
 * comment, which they hide, and a comment that still does not hold becomes
 * plain text.
 */
function opaque(check: Check, node: Node): Node[] {
  const { schema } = check
  const name = node.type.name
  // A literal must also end where it was written, so a paragraph follows it.
  // One that holds only whitespace holds nothing.
  if (name === 'literal_markdown')
    return !literalSource(node).trim()
      ? []
      : check.readsBack([
            node,
            schema.nodes.paragraph!.create(null, schema.text('x')),
          ])
        ? [node]
        : [codeBlock(schema, literalSource(node))]
  if (name === 'comment_inline' || name === 'comment_block') {
    if (commentHolds(node)) return [node]
    if (node.attrs.syntax === 'obsidian') {
      const html = node.type.create(
        { ...node.attrs, syntax: 'html' },
        node.content,
      )
      if (commentHolds(html)) return [html]
    }
    return plainComment(check, node)
  }
  if (node.isLeaf || node.isText) return [node]
  const children: Node[] = []
  let changed = false
  node.forEach((child) => {
    const replaced = opaque(check, child)
    if (replaced.length !== 1 || replaced[0] !== child) changed = true
    children.push(...replaced)
  })
  if (!changed) return [node]
  const content = Fragment.fromArray(children)
  // A replacement the parent cannot hold turns the parent into text.
  return node.type.validContent(content)
    ? [node.copy(content)]
    : paragraphs(check, node)
}

function plainMarks(schema: Schema, marks: readonly Mark[]): readonly Mark[] {
  return marks.map((mark) =>
    mark.type === schema.marks.link
      ? mark.type.create({ href: mark.attrs.href, title: mark.attrs.title })
      : mark,
  )
}

/**
 * The block with InkKit's own metadata removed: inline nodes other than images
 * and line breaks become their text, links lose their reference, callouts
 * become quotes, definitions are dropped and code fences take default markers.
 */
function plainForm(check: Check, node: Node): Node[] {
  const { schema } = check
  const name = node.type.name
  if (node.isText)
    return [schema.text(node.text!, plainMarks(schema, node.marks))]
  if (name === 'comment_inline' || name === 'comment_block')
    return plainComment(check, node)
  if (node.isInline) {
    if (name === 'image' || name === 'hardbreak')
      return [node.mark(plainMarks(schema, node.marks))]
    return text(schema, leafText(node), plainMarks(schema, node.marks))
  }
  if (name === 'reference_definition') return []
  if (name === 'literal_markdown')
    return [codeBlock(schema, literalSource(node))]
  if (name === 'code_block')
    return [node.type.create({ language: node.attrs.language }, node.content)]
  const children: Node[] = []
  node.forEach((child) => children.push(...plainForm(check, child)))
  if (name === 'footnote_definition') return children
  if (name === 'inkkit_callout') {
    const title = String(node.attrs.title ?? '').trim()
    const quote = schema.nodes.blockquote!.createChecked(null, [
      ...(title
        ? [schema.nodes.paragraph!.create(null, schema.text(title))]
        : []),
      ...children,
    ])
    return [quote]
  }
  const content = Fragment.fromArray(children)
  return node.type.validContent(content)
    ? [node.type.create(node.attrs, content, node.marks)]
    : paragraphs(check, node)
}

function repair(check: Check, block: Node): Node[] {
  const kept = check.kept([block])
  if (kept) return kept
  try {
    const plain = check.kept(plainForm(check, block))
    if (plain) return plain
  } catch {
    /* A plain form that the schema refuses falls back to text. */
  }
  return paragraphs(check, block)
}

function blocks(check: Check, content: Fragment): Node[] {
  const result: Node[] = []
  content.forEach((node) => result.push(...opaque(check, node)))
  const kept = check.kept(result)
  if (kept) return kept
  let repaired = result.flatMap((node) => repair(check, node))
  // Blocks that read back alone can still merge with a neighbour. The first
  // block that differs takes its plain form, then becomes text, then goes.
  const simplified = new Set<Node>()
  for (
    let attempt = 0, limit = repaired.length * 3 + 1;
    attempt < limit && !check.readsBack(repaired);
    attempt++
  ) {
    const index = Math.max(0, check.firstDifference(repaired))
    const block = repaired[index]
    if (!block) return []
    let replacement: Node[]
    if (isPlain(block)) replacement = []
    else if (simplified.has(block)) replacement = paragraphs(check, block)
    else {
      try {
        replacement = plainForm(check, block)
      } catch {
        replacement = paragraphs(check, block)
      }
      for (const node of replacement) simplified.add(node)
    }
    repaired = [
      ...repaired.slice(0, index),
      ...replacement,
      ...repaired.slice(index + 1),
    ]
  }
  return check.kept(repaired) ?? []
}

function openDepth(content: Fragment, open: number, start: boolean): number {
  let depth = 0
  let node = start ? content.firstChild : content.lastChild
  // Code and preserved source are never opened, so their text is not joined
  // to the paragraph they are inserted beside.
  while (
    depth < open &&
    node &&
    node.isBlock &&
    !node.isLeaf &&
    !node.type.spec.code
  ) {
    depth++
    node = start ? node.firstChild : node.lastChild
  }
  return depth
}

/**
 * The slice's nodes as blocks a document holds, wrapped as insertion would
 * wrap them: inline nodes in a paragraph and list items in a list.
 */
export function topLevel(schema: Schema, content: Fragment): Node[] {
  const top = schema.topNodeType.contentMatch
  const result: Node[] = []
  let run: Node[] = []
  const close = () => {
    const type = run[0]?.type
    const wrapping = type
      ? type.isInline
        ? [schema.nodes.paragraph!]
        : top.findWrapping(type)
      : null
    if (wrapping?.length)
      result.push(
        wrapping.reduceRight<Node | Node[]>(
          (inner, wrapper) => wrapper.create(null, inner),
          run,
        ) as Node,
      )
    else result.push(...run)
    run = []
  }
  content.forEach((node) => {
    const previous = run[0]
    if (
      previous &&
      (node.isInline ? !previous.isInline : node.type !== previous.type)
    )
      close()
    if (node.isInline || !top.matchType(node.type)) run.push(node)
    else {
      close()
      result.push(node)
    }
  })
  close()
  return result
}

/**
 * Returns the slice with every part whose Markdown would read back as
 * different structure replaced by a form that reads back the same, keeping as
 * much of its text and formatting as possible.
 */
export function importableSlice(ctx: Ctx, slice: Slice): Slice {
  const first = slice.content.firstChild
  if (!first) return slice
  const check = new Check(ctx, first.type.schema)
  const inline = first.isInline
  const content = Fragment.fromArray(topLevel(check.schema, slice.content))
  const result = Fragment.fromArray(blocks(check, content))
  // Inline nodes beside blocks were wrapped, so that form is the one to
  // insert; other wrapping, such as list items in a list, is left to insertion.
  let inlineCount = 0
  slice.content.forEach((node) => {
    if (node.isInline) inlineCount++
  })
  const mixed = inlineCount > 0 && inlineCount < slice.content.childCount
  if (result.eq(content) && !mixed) {
    const start = openDepth(slice.content, slice.openStart, true)
    const end = openDepth(slice.content, slice.openEnd, false)
    return start === slice.openStart && end === slice.openEnd
      ? slice
      : new Slice(slice.content, start, end)
  }
  if (
    inline &&
    result.childCount === 1 &&
    result.firstChild!.type.name === 'paragraph'
  )
    return new Slice(result.firstChild!.content, 0, 0)
  const openStart = inline ? 1 : slice.openStart
  const openEnd = inline ? 1 : slice.openEnd
  return new Slice(
    result,
    openDepth(result, openStart, true),
    openDepth(result, openEnd, false),
  )
}
