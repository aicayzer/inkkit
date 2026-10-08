import { $node, $remark, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Nodes, Root, LinkReference } from 'mdast'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
import { gfmFootnote } from 'micromark-extension-gfm-footnote'
import {
  gfmFootnoteFromMarkdown,
  gfmFootnoteToMarkdown,
} from 'mdast-util-gfm-footnote'
import type { Processor } from 'unified'
import { defaultHandlers, type Handle } from 'mdast-util-to-markdown'

export function normaliseLabel(label: string): string {
  return normalizeIdentifier(label).toLowerCase()
}

export interface LocatedDefinition {
  node: ProseNode
  pos: number
}

function definitions(doc: ProseNode, type: string) {
  const found = new Map<string, LocatedDefinition>()
  doc.descendants((node, pos) => {
    if (node.type.name !== type) return true
    const identifier = normaliseLabel(String(node.attrs.identifier))
    if (!found.has(identifier)) found.set(identifier, { node, pos })
    return false
  })
  return found
}

export const referenceDefinitions = (doc: ProseNode) =>
  definitions(doc, 'reference_definition')
export const footnoteDefinitions = (doc: ProseNode) =>
  definitions(doc, 'footnote_definition')

function contentShape(value: unknown): string {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) => !['position', 'data', 'marker', 'isMark'].includes(key),
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, clean(value)]),
      )
    return value
  }
  return JSON.stringify(clean(value))
}

const labelPlaceholder = 'inkkit-authored-label'
const authoredLinkReference: Handle & { peek?: Handle } = (
  untyped,
  parent,
  state,
  info,
) => {
  const node = untyped as LinkReference & { referenceContent?: string }
  const full = defaultHandlers.linkReference(
    {
      ...node,
      label: labelPlaceholder,
      identifier: labelPlaceholder,
      referenceType: 'full',
    },
    parent,
    state,
    info,
  )
  const display = full.slice(1, -labelPlaceholder.length - 3)
  const unchanged =
    node.referenceContent != null &&
    node.referenceContent === contentShape(node.children)
  if (
    node.referenceType !== 'full' &&
    (unchanged || normaliseLabel(display) === normaliseLabel(node.identifier))
  )
    return `[${unchanged ? node.label : display}]${node.referenceType === 'collapsed' ? '[]' : ''}`
  // Raw entity and escape spelling participates in reference matching.
  return (
    full.slice(0, -labelPlaceholder.length - 2) +
    `[${node.label ?? node.identifier}]`
  )
}
authoredLinkReference.peek = () => '['

const authoredDefinition: Handle = (node, parent, state, info) =>
  defaultHandlers
    .definition(
      { ...node, label: labelPlaceholder, identifier: labelPlaceholder },
      parent,
      state,
      info,
    )
    .replace(
      `[${labelPlaceholder}]:`,
      `[${String(node.label ?? node.identifier)}]:`,
    )

const footnoteHandlers = gfmFootnoteToMarkdown().handlers!
const authoredFootnoteReference: Handle & { peek?: Handle } = (node) =>
  `[^${String(node.label ?? node.identifier)}]`
authoredFootnoteReference.peek = () => '['
const authoredFootnoteDefinition: Handle = (node, parent, state, info) =>
  footnoteHandlers.footnoteDefinition!(
    { ...node, label: labelPlaceholder, identifier: labelPlaceholder },
    parent,
    state,
    info,
  ).replace(
    `[^${labelPlaceholder}]:`,
    `[^${String(node.label ?? node.identifier)}]:`,
  )

function remarkReferences(this: Processor) {
  const data = this.data() as Record<string, unknown[] | undefined>
  ;(data.micromarkExtensions ??= []).push(gfmFootnote())
  ;(data.fromMarkdownExtensions ??= []).push(gfmFootnoteFromMarkdown())
  ;(data.toMarkdownExtensions ??= []).push(gfmFootnoteToMarkdown())
  ;(data.toMarkdownExtensions ??= []).push({
    handlers: {
      linkReference: authoredLinkReference,
      definition: authoredDefinition,
      footnoteReference: authoredFootnoteReference,
      footnoteDefinition: authoredFootnoteDefinition,
    },
  })
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value).replace(/^\uFEFF/, '')
    const targets = new Map<string, { url: string; title?: string | null }>()
    const walk = (node: Nodes, visit: (node: Nodes) => void) => {
      visit(node)
      if ('children' in node)
        node.children.forEach((child) => walk(child, visit))
    }
    walk(tree, (node) => {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start != null && end != null) {
        const raw = source.slice(start, end)
        if (node.type === 'definition' || node.type === 'footnoteDefinition') {
          const label = /^\[((?:\\[\s\S]|[^\\[\]])*)\]:/.exec(raw)?.[1]
          if (label != null)
            node.label =
              node.type === 'footnoteDefinition' ? label.slice(1) : label
        } else if (node.type === 'footnoteReference')
          node.label = raw.slice(2, -1)
        else if (node.type === 'linkReference') {
          const label =
            node.referenceType === 'full'
              ? /\[((?:\\[\s\S]|[^\\[\]])*)\]$/.exec(raw)?.[1]
              : raw.slice(1, node.referenceType === 'collapsed' ? -3 : -1)
          if (label != null) node.label = label
          Object.assign(node, { referenceContent: contentShape(node.children) })
        }
      }
      if (node.type === 'definition' && !targets.has(node.identifier))
        targets.set(node.identifier, { url: node.url, title: node.title })
    })
    walk(tree, (node) => {
      if (node.type !== 'linkReference') return
      const target = targets.get(node.identifier)
      if (target) Object.assign(node, target)
    })
  }
}

export const remarkReferencesPlugin = $remark(
  'inkkitReferences',
  () => remarkReferences,
)

export const referenceLinks = linkSchema.extendSchema((base) => (ctx) => {
  const schema = base(ctx)
  return {
    ...schema,
    // Label formatting belongs inside a reference, where its source determines the identifier.
    priority: 40,
    attrs: {
      ...schema.attrs,
      label: { default: null },
      identifier: { default: null },
      referenceType: { default: null },
      referenceContent: { default: null },
    },
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs(dom) {
          const element = dom as HTMLElement
          return {
            href: element.getAttribute('href') ?? '',
            title: element.getAttribute('title'),
            label: element.getAttribute('data-inkkit-label'),
            identifier: element.getAttribute('data-inkkit-reference'),
            referenceType: element.getAttribute('data-inkkit-reference-type'),
            referenceContent: element.getAttribute(
              'data-inkkit-reference-content',
            ),
          }
        },
      },
    ],
    toDOM(mark) {
      const dom = schema.toDOM!(mark, false) as [
        string,
        Record<string, unknown>,
      ]
      const attrs = { ...dom[1] }
      delete attrs.label
      delete attrs.identifier
      delete attrs.referenceType
      delete attrs.referenceContent
      if (mark.attrs.identifier != null) {
        attrs['data-inkkit-reference'] = mark.attrs.identifier
        attrs['data-inkkit-label'] = mark.attrs.label
        attrs['data-inkkit-reference-type'] = mark.attrs.referenceType
        attrs['data-inkkit-reference-content'] = mark.attrs.referenceContent
      }
      return ['a', attrs] as [string, Record<string, unknown>]
    },
    parseMarkdown: {
      match: (node) => node.type === 'link' || node.type === 'linkReference',
      runner(state, node, type) {
        if (node.type === 'link')
          return schema.parseMarkdown.runner(state, node, type)
        state.openMark(type, {
          href: String(node.url ?? ''),
          title: node.title ?? null,
          label: String(node.label ?? node.identifier),
          identifier: String(node.identifier),
          referenceType: String(node.referenceType),
          referenceContent: node.referenceContent ?? null,
        })
        state.next(node.children)
        state.closeMark(type)
      },
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner(state, mark, node) {
        if (mark.attrs.identifier == null)
          return schema.toMarkdown.runner(state, mark, node)
        state.withMark(mark, 'linkReference', undefined, {
          identifier: mark.attrs.identifier,
          label: mark.attrs.label,
          referenceType: mark.attrs.referenceType,
          referenceContent: mark.attrs.referenceContent,
        })
      },
    },
  }
})

const associationAttrs = {
  label: { default: '' },
  identifier: { default: '' },
}

export const referenceDefinition = $node('reference_definition', () => ({
  group: 'block',
  atom: true,
  defining: true,
  attrs: {
    ...associationAttrs,
    url: { default: '' },
    title: { default: null },
  },
  parseDOM: [
    {
      tag: '[data-inkkit-reference-definition]',
      getAttrs: (dom) => ({
        label: dom.getAttribute('data-inkkit-label') ?? '',
        identifier: dom.getAttribute('data-inkkit-reference-definition') ?? '',
        url: dom.getAttribute('data-inkkit-url') ?? '',
        title: dom.getAttribute('data-inkkit-title'),
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      class: 'inkkit-reference-definition',
      'data-inkkit-reference-definition': node.attrs.identifier,
      'data-inkkit-label': node.attrs.label,
      'data-inkkit-url': node.attrs.url,
      'data-inkkit-title': node.attrs.title,
    },
    `[${node.attrs.label}]: ${node.attrs.url}${node.attrs.title ? ` "${node.attrs.title}"` : ''}`,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'definition',
    runner(state, node, type) {
      state.addNode(type, {
        label: String(node.label ?? node.identifier),
        identifier: String(node.identifier),
        url: String(node.url),
        title: node.title ?? null,
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'reference_definition',
    runner: (state, node) => {
      state.addNode('definition', undefined, undefined, { ...node.attrs })
    },
  },
}))

export const footnoteReference = $node('footnote_reference', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  attrs: associationAttrs,
  parseDOM: [
    {
      tag: 'sup[data-inkkit-footnote-reference]',
      getAttrs: (dom) => ({
        label: dom.getAttribute('data-inkkit-label') ?? '',
        identifier: dom.getAttribute('data-inkkit-footnote-reference') ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'sup',
    {
      class: 'inkkit-footnote-reference',
      tabindex: '0',
      role: 'button',
      'aria-label': `Footnote ${node.attrs.label}`,
      'data-inkkit-footnote-reference': node.attrs.identifier,
      'data-inkkit-label': node.attrs.label,
    },
    String(node.attrs.label),
  ],
  parseMarkdown: {
    match: (node) => node.type === 'footnoteReference',
    runner(state, node, type) {
      state.addNode(type, {
        label: String(node.label ?? node.identifier),
        identifier: String(node.identifier),
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'footnote_reference',
    runner: (state, node) => {
      state.addNode('footnoteReference', undefined, undefined, {
        ...node.attrs,
      })
    },
  },
}))

export const footnoteDefinition = $node('footnote_definition', () => ({
  group: 'block',
  content: 'block+',
  defining: true,
  attrs: associationAttrs,
  parseDOM: [
    {
      tag: '[data-inkkit-footnote-definition]',
      getAttrs: (dom) => ({
        label: dom.getAttribute('data-inkkit-label') ?? '',
        identifier: dom.getAttribute('data-inkkit-footnote-definition') ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      class: 'inkkit-footnote-definition',
      'aria-label': `Footnote ${node.attrs.label}`,
      'data-inkkit-footnote-definition': node.attrs.identifier,
      'data-inkkit-label': node.attrs.label,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'footnoteDefinition',
    runner(state, node, type) {
      state.openNode(type, {
        label: String(node.label ?? node.identifier),
        identifier: String(node.identifier),
      })
      state.next(node.children)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'footnote_definition',
    runner(state, node) {
      state.openNode('footnoteDefinition', undefined, { ...node.attrs })
      state.next(node.content)
      state.closeNode()
    },
  },
}))

const resolvedReferenceTargets = $prose(
  () =>
    new Plugin({
      key: new PluginKey('inkkitReferenceTargets'),
      appendTransaction(transactions, _before, state) {
        if (!transactions.some((transaction) => transaction.docChanged))
          return null
        const targets = referenceDefinitions(state.doc)
        const tr = state.tr
        state.doc.descendants((node, pos) => {
          for (const mark of node.marks) {
            if (mark.type.name !== 'link' || mark.attrs.identifier == null)
              continue
            const target = targets.get(
              normaliseLabel(String(mark.attrs.identifier)),
            )?.node
            const href = String(target?.attrs.url ?? '')
            const title = target?.attrs.title ?? null
            if (mark.attrs.href === href && mark.attrs.title === title) continue
            tr.addMark(
              pos,
              pos + node.nodeSize,
              mark.type.create({ ...mark.attrs, href, title }),
            )
          }
        })
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null
      },
    }),
)

export const references = [
  referenceLinks,
  referenceDefinition,
  footnoteReference,
  footnoteDefinition,
  resolvedReferenceTargets,
].flat()
