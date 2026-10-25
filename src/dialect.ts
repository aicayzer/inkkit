import {
  SerializerReady,
  editorViewCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  commonmark,
  docSchema,
  hardbreakClearMarkPlugin,
  hardbreakSchema,
  hardbreakKeymap,
  headingSchema,
  imageSchema,
  paragraphSchema,
  remarkInlineLinkPlugin,
  syncHeadingIdPlugin,
  createCodeBlockInputRule,
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
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { closeHistory } from '@milkdown/kit/prose/history'
import { $node, $prose, $remark } from '@milkdown/kit/utils'
import { keymap } from '@milkdown/kit/prose/keymap'
import { autolinkLiterals } from './autolink'
import { storedInlineCode } from './inline-code'
import { followsText, remarkLinkForms, type LinkForm } from './link-form'
import { isScriptAddress } from './link-safety'
import { sourceAttribute } from './source'
import { htmlBreakAt } from './hard-break'
import { ownStarts } from './source-tree'
import {
  linkedSyntax,
  wikiLinkComposition,
  wikiLinkInputRule,
  wikiLinkSchema,
  namedFileMarkdown,
  fileFields,
  authoredFileSource,
  remarkFileSources,
  setImageWriter,
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
import { checkedParser } from './parser'
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
import { smartPunctuation } from './smart-punctuation'
import { comments, remarkCommentsPlugin } from './comments'
import { hiddenCommentEditing } from './hidden-comments'
import {
  codeBlockInputRule,
  authoredSourcesCtx,
  joinKeepingSourceKeymap,
} from './block-conversion'
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

// The literal form stops at these, so an address ending in one would come back shorter than it went out.
const endsInPunctuation = /[.,;:!?*_~]$/
// What may sit against a bare address without the reader running the two together.
// GFM reads an address after a space or any punctuation but `/`.
const beforeURL = /(^|[\s\p{P}\p{S}])$/u
// Text GFM leaves off the end of an address and the writer does not escape:
// what follows an address up to a space must be only these.
const trailing = /^["'.,;:!?)\]]*$/

function balanced(url: string): boolean {
  let open = 0
  for (const character of url) {
    if (character === '(') open += 1
    else if (character === ')') open -= 1
    if (open < 0) return false
  }
  return open === 0
}

// Formatting a bare address can sit inside. Its delimiters are punctuation,
// which may come before an address, and those of emphasis and strikethrough
// are also characters an address does not end with, so what follows them
// decides whether the address runs on.
const wrappers = new Set(['emphasis', 'strong', 'delete', 'highlight'])
const transparent = new Set(['emphasis', 'strong', 'delete'])
const blocks = new Set(['paragraph', 'heading', 'tableCell'])

/** A bare address is written bare only where reading it back gives the same link: nothing may run into it at
 *  either end. `ancestors` runs from the root to the link's parent. */
function writesBare(node: Link, index: number, ancestors: Parents[]): boolean {
  const [child, ...rest] = node.children
  if (
    node.title ||
    rest.length > 0 ||
    child?.type !== 'text' ||
    !followsText(child.value, node.url) ||
    /[\s<>]/.test(child.value) ||
    endsInPunctuation.test(child.value) ||
    !balanced(child.value)
  )
    return false
  // Spaces at either end of a block are written as character references,
  // which a bare address would run into or follow without a space.
  const edge = (parent: Parents, text: PhrasingContent, at: 0 | -1) =>
    blocks.has(parent.type) &&
    text.type === 'text' &&
    /^[ \t]+$/.test(text.value) &&
    parent.children.at(at) === text
  const follows = (parent: Parents, text: PhrasingContent): boolean => {
    if (text.type !== 'text') return false
    const run = /^\S*/.exec(text.value)![0]
    // Edge spaces become character references even after punctuation. The
    // reader would then include that punctuation in a bare address. An email
    // address stops at the reference, so it stays bare.
    if (
      !node.url.startsWith('mailto:') &&
      blocks.has(parent.type) &&
      parent.children.at(-1) === text &&
      /^[ \t]+$/.test(text.value.slice(run.length))
    )
      return false
    return (
      trailing.test(run) &&
      (run.length < text.value.length ||
        (blocks.has(parent.type) && parent.children.at(-1) === text))
    )
  }
  const side = (step: -1 | 1): boolean => {
    let current: Parents | Link = node
    for (let level = ancestors.length - 1; level >= 0; level--) {
      const parent = ancestors[level]!
      const children = parent.children as PhrasingContent[]
      const at =
        current === node ? index : children.indexOf(current as PhrasingContent)
      const sibling = children[at + step]
      if (sibling)
        return (
          sibling.type === 'text' &&
          !edge(parent, sibling, step < 0 ? 0 : -1) &&
          (step < 0
            ? beforeURL.test(sibling.value) && !sibling.value.endsWith('/')
            : follows(parent, sibling))
        )
      if (blocks.has(parent.type)) return true
      if (!wrappers.has(parent.type)) return false
      if (step < 0 || !transparent.has(parent.type)) return step < 0
      current = parent
    }
    return false
  }
  return side(-1) && side(1)
}

// Literal links that can be written bare, found once per document because
// what runs into an address can sit outside the formatting around it.
let bareLinks = new WeakSet<Link>()

const root: (typeof defaultHandlers)['root'] = (node, parent, state, info) => {
  bareLinks = new WeakSet()
  // Moving spaces out of formatting can leave empty text, and formatting
  // with nothing in it, written as bare delimiters that would join their
  // neighbours.
  const empty = (child: PhrasingContent): boolean =>
    (child.type === 'text' && child.value === '') ||
    (wrappers.has(child.type) &&
      'children' in child &&
      child.children.every(empty))
  const visit = (current: Parents, ancestors: Parents[]) => {
    if (current.children.some((child) => empty(child as PhrasingContent)))
      current.children = current.children.filter(
        (child) => !empty(child as PhrasingContent),
      ) as typeof current.children
    const children = current.children as PhrasingContent[]
    children.forEach((child, index) => {
      if (child.type === 'link' && formOf(child)) {
        const outside = formattedOutside(child)
        if (outside) child = children[index] = outside
      }
      if (
        child.type === 'link' &&
        formOf(child) === 'literal' &&
        writesBare(child, index, [...ancestors, current])
      )
        bareLinks.add(child)
      if ('children' in child) visit(child, [...ancestors, current])
    })
  }
  visit(node, [])
  bracketLinks = new WeakSet()
  keepFormattingClosed(node, true)
  return defaultHandlers.root(node, parent, state, info)
}

// Links written with brackets although written bare or in angle brackets
// elsewhere, because formatting around them could not close.
let bracketLinks = new WeakSet<Link>()

const spaceOrPunctuation = /^[\s\p{P}\p{S}]$/u

// Formatting written around a link in angle brackets opens before `<` and
// closes after `>`, which Markdown allows only beside a space or punctuation.
// Where a letter sits there instead, the formatting goes inside a link
// written with brackets.
function keepFormattingClosed(current: Parents, block: boolean): void {
  const children = current.children as PhrasingContent[]
  children.forEach((child, index) => {
    const chain: Array<PhrasingContent & { children: PhrasingContent[] }> = []
    let inner: PhrasingContent = child
    while (
      wrappers.has(inner.type) &&
      'children' in inner &&
      inner.children.length === 1
    ) {
      chain.push(inner as PhrasingContent & { children: PhrasingContent[] })
      inner = inner.children[0]!
    }
    if (chain.length && inner.type === 'link' && formOf(inner)) {
      const link = inner
      if (!bareLinks.has(link)) {
        // Beyond the block is a line end; other nodes end in punctuation.
        const outside = block ? ' ' : '.'
        const previous = children[index - 1]
        const next = children[index + 1]
        const before = !previous
          ? outside
          : previous.type === 'text'
            ? (previous.value.at(-1) ?? outside)
            : '.'
        const after = !next
          ? outside
          : next.type === 'text'
            ? (next.value[0] ?? outside)
            : '.'
        if (
          !spaceOrPunctuation.test(before) ||
          !spaceOrPunctuation.test(after)
        ) {
          let content: PhrasingContent[] = link.children
          for (const wrapper of [...chain].reverse())
            content = [{ ...wrapper, children: content } as PhrasingContent]
          const written: Link = {
            ...link,
            children: content as Link['children'],
          }
          bracketLinks.add(written)
          children[index] = written
          return
        }
      }
    }
    if ('children' in child) keepFormattingClosed(child, blocks.has(child.type))
  })
}

const formOf = (node: Link): LinkForm =>
  (node.data as { inkkitLinkForm?: LinkForm } | undefined)?.inkkitLinkForm ??
  null

// Formatting around a whole address is written outside it, as `*https://…*`,
// so that the address stays bare or in angle brackets. A bare address ends
// before `*`, `_` and `~`, but would run into other delimiters such as `==`.
function formattedOutside(node: Link): PhrasingContent | undefined {
  const literal = formOf(node) === 'literal'
  const wrappers: Array<PhrasingContent & { children: PhrasingContent[] }> = []
  let inner: PhrasingContent | undefined = node.children[0]
  while (
    node.children.length === 1 &&
    inner &&
    'children' in inner &&
    inner.type !== 'link' &&
    inner.children.length === 1 &&
    (!literal || ['emphasis', 'strong', 'delete'].includes(inner.type))
  ) {
    wrappers.push(inner as PhrasingContent & { children: PhrasingContent[] })
    inner = inner.children[0]
  }
  if (!wrappers.length || inner?.type !== 'text') return undefined
  let result: PhrasingContent = { ...node, children: [inner] }
  for (const wrapper of wrappers.reverse())
    result = { ...wrapper, children: [result] } as PhrasingContent
  return result
}

type Written = 'bare' | 'angle' | 'brackets'

function written(node: Link, inTable = false): Written {
  // A table pipe must be escaped. Bare and angle addresses read that escape
  // as part of the URL; explicit link labels and destinations decode it.
  if (inTable && node.url.includes('|')) return 'brackets'
  if (bracketLinks.has(node)) return 'brackets'
  const form = formOf(node)
  if (form === 'literal' && bareLinks.has(node)) return 'bare'
  // A link written with brackets keeps them, even when its label is its address.
  return form ? 'angle' : 'brackets'
}

// mdast-util-to-markdown writes a link whose label is its address in angle
// brackets unless `resourceLink` is set; an address that cannot be one, such
// as `www.` text, still gets brackets.
function withResourceLink<T>(
  state: { options: { resourceLink?: boolean | null } },
  resourceLink: boolean,
  write: () => T,
): T {
  const previous = state.options.resourceLink
  state.options.resourceLink = resourceLink
  try {
    return write()
  } finally {
    state.options.resourceLink = previous
  }
}

const link: (typeof defaultHandlers)['link'] = (node, parent, state, info) => {
  const form = written(node, state.stack.includes('tableCell'))
  if (form === 'bare') return (node.children[0] as { value: string }).value
  return withResourceLink(state, form === 'brackets', () =>
    defaultHandlers.link(node, parent, state, info),
  )
}
link.peek = (node, parent, state) => {
  const form = written(node, state.stack.includes('tableCell'))
  if (form === 'bare') return (node.children[0] as { value: string }).value[0]!
  return withResourceLink(state, form === 'brackets', () =>
    defaultHandlers.link.peek!(node, parent, state),
  )
}

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
  add('fromMarkdownExtensions', { transforms: [ownStarts] })
  add('toMarkdownExtensions', gfmStrikethroughToMarkdown())
  add('toMarkdownExtensions', gfmTaskListItemToMarkdown())
  add('toMarkdownExtensions', gfmAutolinkLiteralToMarkdown())
  add('toMarkdownExtensions', gfmTableToMarkdown())
  add('toMarkdownExtensions', {
    // Without these, a bare destination that starts with `<` reads back as a
    // bracketed one, and an entity in a definition, which is not phrasing,
    // reads back as the character it stands for.
    unsafe: [
      { character: '<', inConstruct: 'destinationRaw' },
      {
        character: '&',
        after: '[#A-Za-z]',
        inConstruct: [
          'destinationRaw',
          'destinationLiteral',
          'titleQuote',
          'titleApostrophe',
        ],
      },
    ],
    handlers: {
      break(node, parent, state, info) {
        const next = parent?.children[parent.children.indexOf(node) + 1]
        // A newline would promote the following inline HTML comment to a block.
        return next?.type === 'inkkitCommentInline' && next.syntax === 'html'
          ? '<br />'
          : defaultHandlers.break(node, parent, state, info)
      },
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
        // A list's bullet must differ from its rule; dashes can also attach
        // to preceding task text or a callout marker as a setext underline.
        if (parent && parent.type !== 'root') return value.replaceAll('-', '_')
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
  add('toMarkdownExtensions', {
    handlers: { link, root, code: fencedCodeHandler },
  })
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

// Reference links retain their authored form instead of expanding to inline links. The preset's
// heading ID plugin follows every heading edit with a second transaction that only rewrites the
// ID attribute, so one edit would count as two revisions; the heading schema's own ID fallback
// still names headings in the DOM, and saved Markdown never carries the attribute. InkKit's own
// rule makes code blocks from typed fences.
const commonmarkWithLiteralReferences = commonmark.filter(
  (plugin) =>
    !remarkInlineLinkPlugin.includes(plugin) &&
    plugin !== hardbreakClearMarkPlugin &&
    !hardbreakKeymap.some((part) => part === plugin) &&
    plugin !== syncHeadingIdPlugin &&
    plugin !== createCodeBlockInputRule,
)

// No line break takes inline code, which cannot hold one. This replaces the
// preset's plugin, which also cleared the marks of breaks inside newly
// formatted text and, doing so, reset their attributes, turning a soft break
// into a hard one, at positions read from the first step against the final
// document.
const breaksWithoutMarks = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('inkkitBreaksWithoutMarks'),
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const start = oldState.doc.content.findDiffStart(newState.doc.content)
        if (start == null) return null
        const end = oldState.doc.content.findDiffEnd(newState.doc.content)!.b
        const type = hardbreakSchema.type(ctx)
        const tr = newState.tr
        newState.doc.nodesBetween(start, Math.max(start, end), (node, pos) => {
          if (node.type !== type) return
          for (const mark of node.marks)
            if (mark.type.spec.code) tr.removeMark(pos, pos + 1, mark.type)
        })
        return tr.steps.length ? tr : null
      },
    }),
)

export const remarkLinkFormsPlugin = $remark(
  'inkkitLinkForms',
  () => remarkLinkForms,
)

const remarkFileSourcesPlugin = $remark(
  'inkkitFileSources',
  () => remarkFileSources,
)

// An image with no authored text is written as InkKit writes it alone.
const imageWriter: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SerializerReady)
  const schema = ctx.get(schemaCtx)
  setImageWriter(schema, (node) => {
    const block = node.isBlock
      ? node
      : schema.nodes.paragraph!.create(null, node)
    return ctx
      .get(serializerCtx)(schema.topNodeType.create(null, block))
      .replace(/\n+$/, '')
  })
}

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

// The preset drops a terminal heading break, including an explicit HTML
// break that can reopen. Keep the content and each break's own source form.
const headingsWithBreaks = headingSchema.extendSchema((base) => (ctx) => {
  const schema = base(ctx)
  return {
    ...schema,
    attrs: { ...schema.attrs, form: { default: 'atx' } },
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner(state, node, type) {
        // ATX headings occupy one source line; setext headings include an underline.
        const position = node.position
        state.openNode(type, {
          level: node.depth,
          form:
            position && position.end.line > position.start.line
              ? 'setext'
              : 'atx',
        })
        state.next(node.children)
        state.closeNode()
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, node) {
        state.openNode('heading', undefined, {
          depth: node.attrs.level,
        })
        state.next(node.content)
        state.closeNode()
      },
    },
  }
})

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
        if (raw == null) {
          state.addNode('image', undefined, undefined, {
            url: node.attrs.src,
            alt: node.attrs.alt,
            title: node.attrs.title || null,
            inkkitFileSource: authoredFileSource(node),
            inkkitFileInTable: node.attrs.inkkitFileInTable,
          })
          return
        }
        state.addNode('image', undefined, undefined, {
          url: node.attrs.src,
          alt: node.attrs.alt,
          title: node.attrs.title || null,
          inkkitFileRaw: raw,
          inkkitFileTarget: node.attrs.inkkitFileTarget,
          inkkitFileFragment: node.attrs.inkkitFileFragment,
          inkkitFileWidth: fileFields(node).width ?? null,
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

// Each break is its own undo step. Never replace an earlier break with a
// paragraph, as the preset does on the second press (even away from its end).
const breakKeymap = $prose(() =>
  keymap({
    'Shift-Enter': (state, dispatch, view) => {
      const { $from } = state.selection
      if (
        !(state.selection instanceof TextSelection) ||
        $from.parent.type.spec.code
      )
        return false
      const isHTML = htmlBreakAt($from)
      if (dispatch) {
        dispatch(
          closeHistory(state.tr)
            .replaceSelectionWith(
              state.schema.nodes.hardbreak!.create({ isHTML }),
              false,
            )
            .scrollIntoView(),
        )
        // Keep subsequent typing out of this break's history event too.
        if (view)
          dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
      }
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

// Replaces the preset's table schema, so a node view for tables keys on this
// one's node; the preset's own id is never set.
export const tableNode = tableSchema.extendSchema((previous) => (ctx) => ({
  ...previous(ctx),
  content: 'table_header_row table_row*',
}))

export const tables: MilkdownPlugin[] = [
  tableNode,
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
    breakKeymap,
    remarkCodeFences,
    remarkReferencesPlugin,
    remarkLinkFormsPlugin,
    remarkFileSourcesPlugin,
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
    wikiLinks ? [wikiLinkSchema, wikiLinkInputRule] : [],
    wikiLinks || files ? wikiLinkComposition : [],
    callouts,
    comments,
    hiddenCommentEditing,
    inlineHighlight,
    preservingCodeBlocks,
    authoredSourcesCtx,
    codeBlockInputRule,
    joinKeepingSourceKeymap,
    preserveSpacerParagraphs,
    visibleSoftbreaks,
    headingsWithBreaks,
    normalizedImages,
    imageBlocks,
    autolinkLiterals,
    storedInlineCode,
    breaksWithoutMarks,
    listItems,
    strikethroughAttr,
    strikethroughSchema,
    strikethroughInputRule,
    strikethroughKeymap,
    toggleStrikethroughCommand,
    wrapInTaskListInputRule,
    smartPunctuation,
    remarkDialectPlugin,
    tables,
    literalBlock,
    checkedParser,
    imageWriter,
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
