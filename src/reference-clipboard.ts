import type { Ctx } from '@milkdown/kit/ctx'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { serialize } from './dialect'
import { normaliseLabel } from './references'

function key(node: Node): string | undefined {
  if (node.type.name === 'reference_definition')
    return `link:${node.attrs.identifier}`
  if (node.type.name === 'footnote_definition')
    return `footnote:${node.attrs.identifier}`
  return undefined
}

function used(content: Fragment): Set<string> {
  const result = new Set<string>()
  content.descendants((node) => {
    if (node.type.name === 'footnote_reference')
      result.add(`footnote:${node.attrs.identifier}`)
    for (const mark of node.marks)
      if (mark.type.name === 'link' && mark.attrs.identifier)
        result.add(`link:${mark.attrs.identifier}`)
  })
  return result
}

export function selectionContent(doc: Node, content: Fragment): Fragment {
  const definitions = new Map<string, Node>()
  doc.descendants((node) => {
    const id = key(node)
    if (id && !definitions.has(id)) definitions.set(id, node)
  })
  const required = used(content)
  for (const id of required) {
    const definition = definitions.get(id)
    if (definition)
      for (const dependency of used(definition.content))
        required.add(dependency)
  }
  const complete = (node: Node): Node => {
    const id = key(node)
    if (id && required.has(id) && definitions.has(id))
      return definitions.get(id)!
    if (node.isText) return node
    const children: Node[] = []
    node.forEach((child) => children.push(complete(child)))
    return node.copy(Fragment.fromArray(children))
  }
  const selected: Node[] = []
  content.forEach((node) => selected.push(complete(node)))
  content = Fragment.fromArray(selected)
  const included = new Set<string>()
  content.descendants((node) => {
    const id = key(node)
    if (id) included.add(id)
  })
  const extra: Node[] = []
  for (const id of required) {
    if (included.has(id)) continue
    const definition = definitions.get(id)
    if (!definition) continue
    included.add(id)
    extra.push(definition)
    for (const dependency of used(definition.content)) required.add(dependency)
  }
  return content.append(Fragment.fromArray(extra))
}

export function selectionMarkdown(
  ctx: Ctx,
  doc: Node,
  content: Fragment,
): string {
  return serialize(ctx, doc.type.create(null, selectionContent(doc, content)))
}

export function referenceMetadata(
  ctx: Ctx,
  doc: Node,
  content: Fragment,
): string | undefined {
  let references = false,
    index = 0
  const rewrite = (node: Node): Node => {
    if (
      key(node) ||
      node.type.name === 'footnote_reference' ||
      node.marks.some(
        (mark) => mark.type.name === 'link' && mark.attrs.identifier,
      )
    )
      references = true
    if (node.type.name === 'image')
      return node.type.create(
        { ...node.attrs, src: `inkkit-clipboard-image:${index++}` },
        null,
        node.marks,
      )
    if (node.isText) return node
    const children: Node[] = []
    node.forEach((child) => children.push(rewrite(child)))
    return node.copy(Fragment.fromArray(children))
  }
  const valid = content.firstChild?.isInline
    ? Fragment.from(doc.type.schema.nodes.paragraph!.create(null, content))
    : content
  const copied = rewrite(doc.type.create(null, selectionContent(doc, valid)))
  return references ? serialize(ctx, copied) : undefined
}

function allLabels(doc: Node): Map<string, Set<string>> {
  const labels = new Map<string, Set<string>>([
    ['link', new Set()],
    ['footnote', new Set()],
  ])
  doc.descendants((node) => {
    if (isCode(node)) return false
    const id = key(node)
    if (id) {
      const separator = id.indexOf(':')
      labels.get(id.slice(0, separator))!.add(id.slice(separator + 1))
    }
    if (node.type.name === 'footnote_reference')
      labels.get('footnote')!.add(node.attrs.identifier)
    for (const mark of node.marks)
      if (mark.type.name === 'link' && mark.attrs.identifier)
        labels.get('link')!.add(mark.attrs.identifier)
    if (node.isText) {
      for (const match of node.text!.matchAll(rawReferences))
        labels
          .get(match[1]!.startsWith('^') ? 'footnote' : 'link')!
          .add(
            normaliseLabel(
              match[1]!.startsWith('^')
                ? match[1]!.slice(1)
                : match[2] || match[1]!,
            ),
          )
    }
  })
  return labels
}

const rawReferences = /(?<![\\!])\[([^\]]+)\](?:\[([^\]]*)\])?(?!\()/g
function isCode(node: Node): boolean {
  return (
    node.type.name === 'code_block' ||
    node.marks.some((mark) => mark.type.name === 'inlineCode')
  )
}

// Rename only the incoming document. Definitions belong to the insertion's undo transaction.
export function avoidReferenceCollisions(
  incoming: Node,
  destination: Node,
): Node {
  const occupied = allLabels(destination)
  const incomingLabels = allLabels(incoming)
  const replacements = new Map<string, string>()
  for (const [kind, labels] of incomingLabels) {
    const reserved = new Set([...occupied.get(kind)!, ...labels])
    for (const identifier of labels) {
      if (!occupied.get(kind)!.has(identifier)) continue
      let suffix = 2
      while (reserved.has(normaliseLabel(`${identifier}-${suffix}`))) suffix++
      const label = `${identifier}-${suffix}`
      reserved.add(normaliseLabel(label))
      replacements.set(`${kind}:${identifier}`, label)
    }
  }
  if (!replacements.size) return incoming
  const rewrite = (node: Node): Node => {
    if (isCode(node)) return node
    const kind = node.type.name.startsWith('footnote_') ? 'footnote' : 'link'
    const label = replacements.get(`${kind}:${node.attrs.identifier}`)
    const attrs = label
      ? { ...node.attrs, label, identifier: normaliseLabel(label) }
      : node.attrs
    const marks = node.marks.map((mark) => {
      const replacement = replacements.get(`link:${mark.attrs.identifier}`)
      return replacement && mark.type.name === 'link'
        ? mark.type.create({
            ...mark.attrs,
            label: replacement,
            identifier: normaliseLabel(replacement),
            referenceType: 'full',
          })
        : mark
    })
    if (node.isText) {
      const text = node.text!.replace(
        rawReferences,
        (raw, display: string, reference: string | undefined) => {
          const footnote = display.startsWith('^')
            ? display.slice(1)
            : undefined
          const replacement = replacements.get(
            `${footnote ? 'footnote' : 'link'}:${normaliseLabel(footnote ?? (reference || display))}`,
          )
          return replacement
            ? footnote
              ? `[^${replacement}]`
              : `[${display}][${replacement}]`
            : raw
        },
      )
      return node.type.schema.text(text, marks)
    }
    const children: Node[] = []
    node.forEach((child) => children.push(rewrite(child)))
    return node.type.create(attrs, children, marks)
  }
  return rewrite(incoming)
}

export function markdownFromHTML(html: string): string | undefined {
  const template = document.createElement('template')
  template.innerHTML = html
  const element = template.content.querySelector('[data-inkkit-markdown]')
  return element?.getAttribute('data-inkkit-markdown') ?? undefined
}

export function withReferenceMetadata(html: string, markdown: string): string {
  const container = document.createElement('div')
  container.setAttribute('data-inkkit-markdown', markdown)
  container.innerHTML = html
  return container.outerHTML
}
