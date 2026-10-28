import { fromMarkdown } from 'mdast-util-from-markdown'
import { mdxFromMarkdown } from 'mdast-util-mdx'
import { mdxjs } from 'micromark-extension-mdxjs'
import { gfmTable } from 'micromark-extension-gfm-table'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'

const identifier = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/
const explanatoryColumns = new Set([
  'meaning',
  'description',
  'where it appears',
  'true when',
])

function text(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  return (node.children ?? []).map(text).join('')
}

// Code, links, headings and child components cannot document their surrounding owner.
function prose(node) {
  if (node.type === 'text') return node.value
  if (
    [
      'paragraph',
      'list',
      'listItem',
      'emphasis',
      'strong',
      'tableCell',
    ].includes(node.type)
  )
    return (node.children ?? []).map(prose).join(' ')
  return ''
}

function substantive(value) {
  const words = value.match(/[\p{L}\p{N}]+/gu) ?? []
  return (
    words.length >= 3 &&
    !/^(?:todo|tbd|description|placeholder)[.!?\s]*$/i.test(value.trim())
  )
}

function attribute(node, name) {
  const found = node.attributes?.find((attribute) => attribute.name === name)
  if (!found || typeof found.value !== 'string')
    throw new Error(`${node.name} requires a literal ${name} attribute`)
  return found.value
}

function annotation(node) {
  if (node.type !== 'mdxFlowExpression') return undefined
  const match = /^\s*\/\*\s*@api(-scope)?\s+([^]*?)\s*\*\/\s*$/.exec(node.value)
  if (!match) {
    if (node.value.includes('@api')) throw new Error('Malformed API annotation')
    return undefined
  }
  const targets = match[2].trim().split(/\s+/)
  if (
    !targets.every((target) => identifier.test(target)) ||
    (match[1] && targets.length !== 1)
  )
    throw new Error('API annotations require qualified identifiers')
  return { scope: !!match[1], targets }
}

/** Parse descriptions, retaining their exact owner and source location. MDX is never evaluated. */
export function reference(source, file, required) {
  const frontmatter =
    /^(?:\uFEFF)?---\r?\n[^]*?\r?\n---(?:\r?\n|$)/.exec(source)?.[0] ?? ''
  const offset = frontmatter.split('\n').length - 1
  const tree = fromMarkdown(source.slice(frontmatter.length), {
    extensions: [mdxjs(), gfmTable()],
    mdastExtensions: [mdxFromMarkdown(), gfmTableFromMarkdown()],
  })
  const descriptions = []
  const errors = []
  const location = (node) =>
    `${file}:${(node.position?.start.line ?? 1) + offset}`
  const checkOwner = (owner, node) => {
    if (!required.has(owner))
      throw new Error(`${location(node)}: unknown API owner ${owner}`)
    return owner
  }
  const claim = (targets, nodes, node) => {
    for (const target of targets) {
      checkOwner(target, node)
      const body = nodes.map(prose).join(' ').trim()
      if (!substantive(body))
        errors.push(
          `${location(node)}: ${target} needs an explanatory description (not a signature, example, link or child field)`,
        )
      else
        descriptions.push({
          target,
          location: location(node),
          description: body,
        })
    }
  }
  const fields = (node, owner) => {
    if (!owner)
      throw new Error(`${location(node)}: field table has no API owner`)
    const rows = node.children
    const headers = rows[0].children.map((cell) =>
      text(cell).trim().toLowerCase(),
    )
    const description = headers.findIndex((header) =>
      explanatoryColumns.has(header),
    )
    if (description < 1)
      throw new Error(
        `${location(node)}: field table needs a Meaning, Description or Where it appears column`,
      )
    for (const row of rows.slice(1)) {
      const keys = row.children[0].children
        .filter((part) => part.type === 'inlineCode')
        .map((part) => part.value)
      const other = prose(row.children[0]).replace(/[\s,]/g, '')
      if (
        !keys.length ||
        other ||
        !keys.every((key) => /^[A-Za-z_]\w*$/.test(key))
      )
        throw new Error(
          `${location(row)}: field identity cell must list exact code-span names`,
        )
      claim(
        keys.map((key) => `${owner}.${key}`),
        [row.children[description]],
        row,
      )
    }
  }
  const walk = (nodes, inherited) => {
    let pending
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]
      const marker = annotation(node)
      if (marker) {
        if (pending)
          throw new Error(`${location(node)}: API annotation has no content`)
        pending = marker
        continue
      }
      // Ordinary comments and examples do not acquire or supply API ownership.
      if (node.type === 'mdxFlowExpression' || node.type === 'code') {
        if (pending)
          throw new Error(
            `${location(node)}: API annotation cannot document code or a comment`,
          )
        continue
      }
      const attached = pending
      pending = undefined
      if (node.type === 'heading') {
        let end = index + 1
        while (
          end < nodes.length &&
          !(nodes[end].type === 'heading' && nodes[end].depth <= node.depth)
        )
          end++
        // An annotation immediately before the next heading belongs to that heading.
        if (end < nodes.length && end > index + 1 && annotation(nodes[end - 1]))
          end--
        const children = nodes.slice(index + 1, end)
        const exact = text(node)
        const targets =
          attached?.targets ?? (required.has(exact) ? [exact] : [])
        const owner =
          targets.length === 1 ? checkOwner(targets[0], node) : inherited
        if (targets.length && !attached?.scope) {
          const direct = []
          for (const child of children) {
            if (child.type === 'heading' || annotation(child)) break
            direct.push(child)
          }
          claim(targets, direct, node)
        }
        walk(children, owner)
        index = end - 1
        continue
      }
      const owner = attached?.scope
        ? checkOwner(attached.targets[0], node)
        : inherited
      if (node.type === 'mdxJsxFlowElement' && node.name === 'ResponseField') {
        const names = attribute(node, 'name')
          .split(',')
          .map((name) => name.trim())
        if (!names.every((name) => /^[A-Za-z_]\w*$/.test(name)))
          throw new Error(
            `${location(node)}: ResponseField requires exact field names`,
          )
        if (!owner && !attached)
          throw new Error(`${location(node)}: ResponseField has no API owner`)
        const targets =
          attached && !attached.scope
            ? attached.targets
            : names.map((name) => `${owner}.${name}`)
        claim(targets, node.children, node)
        walk(node.children, targets.length === 1 ? targets[0] : owner)
      } else if (
        node.type === 'mdxJsxFlowElement' &&
        node.name === 'Expandable'
      ) {
        const title = attribute(node, 'title')
        const nested = attached?.scope
          ? owner
          : required.has(title)
            ? title
            : owner
        if (!nested)
          throw new Error(`${location(node)}: Expandable has no API owner`)
        walk(node.children, nested)
      } else if (node.type === 'table' && attached?.scope) {
        fields(node, owner)
      } else {
        if (attached?.scope)
          throw new Error(
            `${location(node)}: API scope requires a heading, field, table or Expandable`,
          )
        if (attached) claim(attached.targets, [node], node)
        if (node.type === 'mdxJsxFlowElement') walk(node.children, owner)
      }
    }
    if (pending) throw new Error(`${file}: API annotation has no content`)
  }
  walk(tree.children, undefined)
  return { descriptions, errors }
}
