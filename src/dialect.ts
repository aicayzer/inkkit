import { editorViewCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  commonmark,
  docSchema,
  hardbreakSchema,
  imageSchema,
  paragraphSchema,
  remarkInlineLinkPlugin,
} from '@milkdown/kit/preset/commonmark'
import {
  extendListItemSchemaForTask,
  strikethroughAttr,
  strikethroughInputRule,
  strikethroughKeymap,
  strikethroughSchema,
  toggleStrikethroughCommand,
  wrapInTaskListInputRule,
  tableSchema,
  tableHeaderRowSchema,
  tableHeaderSchema,
  tableRowSchema,
  tableCellSchema,
  tableEditingPlugin,
  tableKeymap,
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  insertTableCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  selectRowCommand,
  selectColCommand,
  deleteSelectedCellsCommand,
  setAlignCommand,
  exitTable,
} from '@milkdown/kit/preset/gfm'
import { $node, $prose, $remark } from '@milkdown/kit/utils'
import { keymap } from '@milkdown/kit/prose/keymap'
import { autolinkInputRule } from './autolink'
import { isScriptAddress } from './link-safety'
import { sourceAttribute } from './source'
import {
  linkedSyntax,
  wikiLinkSchema,
  namedFileMarkdown,
  fileReference,
} from './linked-syntax'
import {
  normalizeTableAlignment,
  normalizeTableColumnAlignment,
} from './table-alignment'
import {
  preservingCodeBlocks,
  remarkCodeFences,
  fencedCodeHandler,
} from './code-fences'
import { literalBlock, createLiteralPreservation } from './literals'
import {
  imageAttrs,
  imageBlockName,
  imageBlocks,
  markdownImageAttrs,
  readParagraph,
} from './image-blocks'
import { references, remarkReferencesPlugin } from './references'
import { callouts, remarkCalloutsPlugin } from './callouts'
import { inlineHighlight } from './inline-highlight'
import { comments, remarkCommentsPlugin } from './comments'
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { gfmTable } from 'micromark-extension-gfm-table'
import type { Link, Nodes, Parents, PhrasingContent } from 'mdast'
import {
  defaultHandlers,
  type Options as StringifyOptions,
} from 'mdast-util-to-markdown'
import {
  gfmAutolinkLiteralFromMarkdown,
  gfmAutolinkLiteralToMarkdown,
} from 'mdast-util-gfm-autolink-literal'
import {
  gfmStrikethroughFromMarkdown,
  gfmStrikethroughToMarkdown,
} from 'mdast-util-gfm-strikethrough'
import {
  gfmTaskListItemFromMarkdown,
  gfmTaskListItemToMarkdown,
} from 'mdast-util-gfm-task-list-item'
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item'
import type { Processor } from 'unified'

const bareURL = /^https?:\/\/[^\s<>]+$/
// The literal form stops at these, so a URL ending in one would come back shorter than it went out.
const endsInPunctuation = /[.,;:!?]$/
// What may sit against a bare URL without the reader running the two together.
const beforeURL = /(^|[\s([*_~])$/
const afterURL = /^([\s.,;:!?)\]}<]|$)/

function balanced(url: string): boolean {
  let open = 0
  for (const character of url) {
    if (character === '(') open += 1
    else if (character === ')') open -= 1
    if (open < 0) return false
  }
  return open === 0
}

function textAt(
  parent: Parents | undefined,
  node: Link,
  offset: number,
): PhrasingContent | undefined {
  const children = parent?.children as PhrasingContent[] | undefined
  const index = children?.indexOf(node as PhrasingContent) ?? -1
  return index < 0 ? undefined : children?.[index + offset]
}

/** A link whose text is its own URL is written as the bare URL, the way it was typed. Only where reading
 *  it back gives the same link again: nothing may run into it at either end. */
function writesBare(
  node: Link,
  parent: Parents | undefined,
  inCell: boolean,
): boolean {
  const [child, ...rest] = node.children
  if (
    node.title ||
    rest.length > 0 ||
    child?.type !== 'text' ||
    child.value !== node.url
  )
    return false
  if (
    !bareURL.test(node.url) ||
    endsInPunctuation.test(node.url) ||
    !balanced(node.url)
  )
    return false
  const before = textAt(parent, node, -1)
  if (before && (before.type !== 'text' || !beforeURL.test(before.value)))
    return false
  const after = textAt(parent, node, 1)
  if (after && (after.type !== 'text' || !afterURL.test(after.value)))
    return false
  // Spaces that end a cell are written as character references, which a bare URL would run into.
  return !(
    inCell &&
    after?.type === 'text' &&
    /^[ \t]+$/.test(after.value) &&
    parent?.children.at(-1) === after
  )
}

const link: (typeof defaultHandlers)['link'] = (node, parent, state, info) =>
  writesBare(node, parent, state.stack.includes('tableCell'))
    ? node.url
    : defaultHandlers.link(node, parent, state, info)
link.peek = (node, parent, state) =>
  writesBare(node, parent, state.stack.includes('tableCell'))
    ? node.url[0]!
    : defaultHandlers.link.peek(node, parent, state)

function remarkDialect(this: Processor) {
  const data = this.data() as Record<string, unknown[] | undefined>
  const add = (key: string, value: unknown) => {
    const list = (data[key] ??= [])
    list.push(value)
  }
  add('micromarkExtensions', gfmStrikethrough())
  add('micromarkExtensions', gfmTaskListItem())
  add('micromarkExtensions', gfmAutolinkLiteral())
  add('micromarkExtensions', gfmTable())
  add('fromMarkdownExtensions', gfmStrikethroughFromMarkdown())
  add('fromMarkdownExtensions', gfmTaskListItemFromMarkdown())
  add('fromMarkdownExtensions', gfmAutolinkLiteralFromMarkdown())
  add('fromMarkdownExtensions', gfmTableFromMarkdown())
  add('toMarkdownExtensions', gfmStrikethroughToMarkdown())
  add('toMarkdownExtensions', gfmTaskListItemToMarkdown())
  add('toMarkdownExtensions', gfmAutolinkLiteralToMarkdown())
  add('toMarkdownExtensions', gfmTableToMarkdown())
  add('toMarkdownExtensions', {
    handlers: {
      text(node, parent, state, info) {
        const value = defaultHandlers.text(node, parent, state, info)
        // GFM trims spaces and tabs at the edges of a cell on reopening, so
        // only the start of its first node and the end of its last need
        // encoding. Inside a mark or link, delimiters stand before the pipe.
        if (
          !state.stack.includes('tableCell') ||
          (parent?.type !== 'paragraph' && parent?.type !== 'tableCell')
        )
          return value
        const siblings = parent.children
        const encode = (spaces: string) =>
          spaces.replaceAll(' ', '&#x20;').replaceAll('\t', '&#x9;')
        return value
          .replace(/^[ \t]+/, (spaces) =>
            siblings[0] === node ? encode(spaces) : spaces,
          )
          .replace(/[ \t]+$/, (spaces) =>
            siblings.at(-1) === node ? encode(spaces) : spaces,
          )
      },
      thematicBreak(node, parent, state) {
        const value = defaultHandlers.thematicBreak(node, parent, state)
        // A document opening with `---` reads back as front matter when
        // another `---` line follows.
        return parent?.type === 'root' &&
          parent.children.length > 1 &&
          parent.children[0] === node
          ? value.replaceAll('-', '*')
          : value
      },
    },
  } satisfies StringifyOptions)
  add('toMarkdownExtensions', { handlers: { link, code: fencedCodeHandler } })
  return padShortRows
}

// GFM reads a row with fewer cells than its header as ending in empty cells.
// The editor holds them from the start; otherwise table editing adds them
// after the first edit, and again after every Undo.
function padShortRows(node: Nodes): void {
  if (node.type === 'table') {
    const width = node.children[0]?.children.length ?? 0
    for (const row of node.children)
      while (row.children.length < width)
        row.children.push({ type: 'tableCell', children: [] })
  }
  if ('children' in node) node.children.forEach(padShortRows)
}

export const remarkDialectPlugin = $remark('remarkDialect', () => remarkDialect)

// Reference links retain their authored form instead of expanding to inline links.
const commonmarkWithLiteralReferences = commonmark.filter(
  (plugin) => !remarkInlineLinkPlugin.includes(plugin),
)

// The preset drops the final empty paragraph, which makes trailing spacers shrink on each reload.
const preserveSpacerParagraphs = paragraphSchema.extendSchema(
  (base) => (ctx) => {
    const schema = base(ctx)
    return {
      ...schema,
      parseMarkdown: {
        ...schema.parseMarkdown,
        runner(state, node, type) {
          readParagraph(state, node, type)
        },
      },
      toMarkdown: {
        ...schema.toMarkdown,
        runner(state, node) {
          if (node.lastChild?.type.name === 'hardbreak') {
            state.openNode('paragraph')
            state.next(
              node.content.cut(0, node.content.size - node.lastChild.nodeSize),
            )
            state.addNode('html', undefined, '<br />')
            state.closeNode()
            return
          }
          if (node.content.size > 0)
            return schema.toMarkdown.runner(state, node)
          state.openNode('paragraph')
          state.addNode('html', undefined, '<br />')
          state.closeNode()
        },
      },
    }
  },
)

// Soft Markdown breaks still serialize as a single newline. Display the actual
// line boundary rather than a space, so changing editor mode never joins lines.
const visibleSoftbreaks = hardbreakSchema.extendSchema((base) => (ctx) => {
  const schema = base(ctx)
  return {
    ...schema,
    attrs: { ...schema.attrs, isHTML: { default: false } },
    parseDOM: [
      {
        tag: 'br[data-type="softbreak"]',
        getAttrs: () => ({ isInline: true }),
      },
      {
        tag: 'br[data-type="hardbreak"]',
        getAttrs: () => ({ isInline: false }),
      },
      { tag: 'br', getAttrs: () => ({ isInline: false, isHTML: true }) },
    ],
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        if (
          (node.data as { inkkitHTMLBreak?: boolean } | undefined)
            ?.inkkitHTMLBreak
        )
          state.addNode(type, { isInline: false, isHTML: true })
        else schema.parseMarkdown.runner(state, node, type)
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        if (node.attrs.isHTML) state.addNode('html', undefined, '<br />')
        else schema.toMarkdown.runner(state, node)
      },
    },
    toDOM: (node) =>
      node.attrs.isInline
        ? ['br', { 'data-type': 'softbreak' }]
        : [
            'br',
            { 'data-type': node.attrs.isHTML ? 'htmlbreak' : 'hardbreak' },
          ],
  }
})

const normalizedImages = imageSchema.extendSchema((base) => (ctx) => {
  const schema = base(ctx)
  return {
    ...schema,
    attrs: imageAttrs,
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs(dom) {
          const src = dom.getAttribute('src') ?? ''
          if (isScriptAddress(src)) return false
          return {
            src,
            alt: dom.getAttribute('alt') ?? '',
            title: dom.getAttribute('title') ?? '',
          }
        },
      },
    ],
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        state.addNode(type, markdownImageAttrs(node))
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        const raw = namedFileMarkdown(
          node,
          Boolean(node.attrs.inkkitFileInTable),
        )
        if (raw == null) return schema.toMarkdown.runner(state, node)
        state.addNode('image', undefined, undefined, {
          url: node.attrs.src,
          alt: node.attrs.alt,
          title: node.attrs.title || null,
          inkkitFileRaw: raw,
          inkkitFileTarget: node.attrs.inkkitFileTarget,
          inkkitFileFragment: node.attrs.inkkitFileFragment,
          inkkitFileWidth: fileReference(node).width ?? null,
          inkkitFileInTable: node.attrs.inkkitFileInTable,
        })
      },
    },
  }
})

type CellToMarkdown = ReturnType<
  ReturnType<Parameters<typeof tableCellSchema.extendSchema>[0]>
>['toMarkdown']

// The preset drops a cell's final break, and a paragraph writes an empty one as
// the spacer `<br />`; either reads back differently, so a cell writes its
// paragraph's content directly.
function cellToMarkdown(base: CellToMarkdown): CellToMarkdown {
  return {
    ...base,
    runner(state, node) {
      if (node.childCount === 1 && node.firstChild!.type.name === 'paragraph')
        state.openNode('tableCell').next(node.firstChild!.content).closeNode()
      else base.runner(state, node)
    },
  }
}

// A cell cannot hold a line ending, so Shift-Enter there inserts the `<br />`
// a cell reads back. The preset's command would instead split the paragraph
// when it already ends in a break, which reshapes the table.
const cellBreakKeymap = $prose(() =>
  keymap({
    'Shift-Enter': (state, dispatch) => {
      const { $from } = state.selection
      if (!/^table_(cell|header)$/.test($from.node(-1)?.type.name ?? ''))
        return false
      dispatch?.(
        state.tr
          // A break inside a mark or link would be inline HTML there, which
          // a cell does not read back as a break.
          .replaceSelectionWith(
            state.schema.nodes.hardbreak!.create({ isHTML: true }),
            false,
          )
          .scrollIntoView(),
      )
      return true
    },
  }),
)

// A list item that opens with a block, such as a code fence, is held with the
// empty first paragraph the schema requires. Written out, that paragraph would
// be a spacer `<br />` line; without it the item reads back the same.
const listItems = extendListItemSchemaForTask.extendSchema(
  (previous) => (ctx) => {
    const schema = previous(ctx)
    return {
      ...schema,
      toMarkdown: {
        ...schema.toMarkdown,
        runner(state, node) {
          const [first, second] = [node.firstChild, node.maybeChild(1)]
          // A task item's checkbox is written on its first line.
          if (
            node.attrs.checked == null &&
            first?.type.name === 'paragraph' &&
            first.content.size === 0 &&
            second &&
            second.type.name !== 'paragraph' &&
            // An image block reads back as a paragraph in that position.
            second.type.name !== imageBlockName
          )
            node = node.copy(node.content.cut(first.nodeSize))
          schema.toMarkdown.runner(state, node)
        },
      },
    }
  },
)

export const tables: MilkdownPlugin[] = [
  tableSchema.extendSchema((previous) => (ctx) => ({
    ...previous(ctx),
    content: 'table_header_row table_row*',
  })),
  tableHeaderRowSchema,
  tableHeaderSchema.extendSchema((previous) => (ctx) => {
    const schema = previous(ctx)
    return {
      ...schema,
      attrs: { ...schema.attrs, alignment: { default: null } },
      toMarkdown: cellToMarkdown(schema.toMarkdown),
      parseDOM: schema.parseDOM?.map((rule) =>
        'tag' in rule
          ? {
              ...rule,
              getAttrs(dom) {
                const attrs = rule.getAttrs?.(dom)
                if (attrs === false) return false
                return {
                  ...attrs,
                  alignment: normalizeTableAlignment(dom),
                }
              },
            }
          : rule,
      ),
    }
  }),
  tableRowSchema,
  tableCellSchema.extendSchema((previous) => (ctx) => {
    const schema = previous(ctx)
    return {
      ...schema,
      attrs: { ...schema.attrs, alignment: { default: null } },
      toMarkdown: cellToMarkdown(schema.toMarkdown),
      parseDOM: schema.parseDOM?.map((rule) =>
        'tag' in rule
          ? {
              ...rule,
              getAttrs(dom) {
                const attrs = rule.getAttrs?.(dom)
                if (attrs === false) return false
                return {
                  ...attrs,
                  alignment: normalizeTableColumnAlignment(dom),
                }
              },
            }
          : rule,
      ),
    }
  }),
  tableEditingPlugin,
  tableKeymap,
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  insertTableCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  selectRowCommand,
  selectColCommand,
  deleteSelectedCellsCommand,
  setAlignCommand,
  exitTable,
].flat()

export function createDialect(
  images: boolean,
  wikiLinks = false,
  files = false,
): MilkdownPlugin[] {
  return [
    cellBreakKeymap,
    remarkCodeFences,
    remarkReferencesPlugin,
    remarkCalloutsPlugin,
    remarkCommentsPlugin,
    wikiLinks || files ? linkedSyntax(wikiLinks, files) : [],
    // Protect unsupported inline HTML before the empty-line plugin consumes break nodes.
    createLiteralPreservation(images || files),
    commonmarkWithLiteralReferences,
    $node('doc', () => ({
      ...docSchema.schema,
      attrs: {
        ...docSchema.schema.attrs,
        [sourceAttribute]: { default: null },
      },
    })),
    references,
    wikiLinks ? wikiLinkSchema : [],
    callouts,
    comments,
    inlineHighlight,
    preservingCodeBlocks,
    preserveSpacerParagraphs,
    visibleSoftbreaks,
    normalizedImages,
    imageBlocks,
    autolinkInputRule,
    listItems,
    strikethroughAttr,
    strikethroughSchema,
    strikethroughInputRule,
    strikethroughKeymap,
    toggleStrikethroughCommand,
    wrapInTaskListInputRule,
    remarkDialectPlugin,
    tables,
    literalBlock,
  ].flat()
}

export const dialect = createDialect(false)

// One output form, so a document written back unchanged is byte-stable.
export const stringifyOptions: StringifyOptions = {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
}

// Milkdown preserves authored spacer paragraphs with standalone Markdown HTML breaks.
export function serialize(
  ctx: Ctx,
  doc: ProseNode = ctx.get(editorViewCtx).state.doc,
): string {
  if (
    doc.childCount === 1 &&
    doc.firstChild?.type.name === 'paragraph' &&
    doc.firstChild.content.size === 0
  )
    return ''
  return ctx.get(serializerCtx)(doc)
}
