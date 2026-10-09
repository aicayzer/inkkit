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
import { $node, $remark } from '@milkdown/kit/utils'
import { autolinkInputRule } from './autolink'
import { sourceAttribute } from './source'
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
import { references, remarkReferencesPlugin } from './references'
import { callouts, remarkCalloutsPlugin } from './callouts'
import { inlineHighlight } from './inline-highlight'
import { comments, remarkCommentsPlugin } from './comments'
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { gfmTable } from 'micromark-extension-gfm-table'
import type { Link, Parents, PhrasingContent } from 'mdast'
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
function writesBare(node: Link, parent: Parents | undefined): boolean {
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
  return true
}

const link: (typeof defaultHandlers)['link'] = (node, parent, state, info) =>
  writesBare(node, parent)
    ? node.url
    : defaultHandlers.link(node, parent, state, info)
link.peek = (node, parent, state) =>
  writesBare(node, parent)
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
        // GFM trims literal whitespace at cell edges on reopening.
        return state.stack.includes('tableCell')
          ? value.replace(/^[ \t]+|[ \t]+$/g, (spaces) =>
              spaces.replaceAll(' ', '&#x20;').replaceAll('\t', '&#x9;'),
            )
          : value
      },
    },
  } satisfies StringifyOptions)
  add('toMarkdownExtensions', { handlers: { link, code: fencedCodeHandler } })
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

// Remark represents a missing title as null; the image schema accepts strings.
const normalizedImages = imageSchema.extendSchema((base) => (ctx) => {
  const schema = base(ctx)
  return {
    ...schema,
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs(dom) {
          return {
            src: dom.getAttribute('src') ?? '',
            alt: dom.getAttribute('alt') ?? '',
            title: dom.getAttribute('title') ?? '',
          }
        },
      },
    ],
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        state.addNode(type, {
          src: String(node.url ?? ''),
          alt: String(node.alt ?? ''),
          title: String(node.title ?? ''),
        })
      },
    },
  }
})

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

export function createDialect(images: boolean): MilkdownPlugin[] {
  return [
    remarkCodeFences,
    remarkReferencesPlugin,
    remarkCalloutsPlugin,
    remarkCommentsPlugin,
    // Protect unsupported inline HTML before the empty-line plugin consumes break nodes.
    createLiteralPreservation(images),
    commonmarkWithLiteralReferences,
    $node('doc', () => ({
      ...docSchema.schema,
      attrs: {
        ...docSchema.schema.attrs,
        [sourceAttribute]: { default: null },
      },
    })),
    references,
    callouts,
    comments,
    inlineHighlight,
    preservingCodeBlocks,
    preserveSpacerParagraphs,
    visibleSoftbreaks,
    normalizedImages,
    autolinkInputRule,
    extendListItemSchemaForTask,
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
