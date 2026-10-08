import { parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { serialize } from './dialect'
import { restoreCodeEndings, finalCodeEnding } from './code-fences'

interface Block {
  start: number
  end: number
  form: string
  ast: SourceNode
}

interface SourceNode {
  type: string
  value?: string
  children?: SourceNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
  [key: string]: unknown
}

function signature(node: SourceNode): string {
  return JSON.stringify(node, (key, value) =>
    ['position', 'data', 'url', 'title', 'marker'].includes(key)
      ? undefined
      : value,
  )
}

function ownShape(node: SourceNode): string {
  return JSON.stringify(node, (key, value) =>
    ['position', 'data', 'children', 'value', 'marker'].includes(key)
      ? undefined
      : value,
  )
}

function retainText(
  raw: string,
  before: string,
  after: string,
  quoteIndent = false,
): string {
  before = before.replace(/\r\n?/g, '\n')
  after = after.replace(/\r\n?/g, '\n')
  let prefix = 0
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++
  const offsets = [0]
  let decoded = ''
  for (let index = 0; index < raw.length;) {
    if (index > 0 && raw[index - 1] === '\n') {
      const gutter = (
        quoteIndent ? /^(?:[ \t]*>[ \t]*)+/ : /^(?:[ \t]*>[ \t]?)+/
      ).exec(raw.slice(index))
      if (gutter) {
        index += gutter[0].length
        offsets[offsets.length - 1] = index
        continue
      }
    }
    const escaped = /^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/.exec(
      raw.slice(index),
    )
    const entity = /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);/.exec(
      raw.slice(index),
    )
    let value: string
    let length: number
    if (escaped) {
      value = escaped[1]!
      length = escaped[0].length
    } else if (entity) {
      const element = document.createElement('textarea')
      element.innerHTML = entity[0]
      value = element.value
      length = entity[0].length
    } else if (raw.slice(index, index + 2) === '\r\n') {
      value = '\n'
      length = 2
    } else {
      value = raw[index]!
      length = 1
    }
    decoded += value
    index += length
    for (let part = 0; part < value.length; part++) offsets.push(index)
  }
  if (decoded !== before) {
    // Continuation indentation is excluded from a quoted paragraph's text.
    return quoteIndent ? after : retainText(raw, before, after, true)
  }
  const inserted = after
    .slice(prefix, after.length - suffix)
    .split('')
    .map((character, index) => {
      const at = prefix + index
      const delimiter =
        (character === '%' || character === '=') &&
        (after[at - 1] === character || after[at + 1] === character)
      return delimiter || /[\\`*_[\]<>]/.test(character)
        ? `\\${character}`
        : character
    })
    .join('')
  return (
    raw.slice(0, offsets[prefix]) +
    inserted +
    raw.slice(offsets[before.length - suffix])
  )
}

function retainBoundaryWhitespace(raw: string, canonical: string): string {
  // A middle-of-line space becomes indentation or trimmed text at a block edge.
  const token = '(?:[ \\t]|&#(?:[xX]0*(?:20|9)|0*(?:32|9));|&Tab;)'
  const decoded = (value: string): string =>
    (value.match(new RegExp(token, 'g')) ?? [])
      .map((value) =>
        value === '\t' || /(?:9;|Tab;)$/.test(value) ? '\t' : ' ',
      )
      .join('')
  const encode = (value: string): string =>
    value.replace(/[ \t]/g, (value) => (value === '\t' ? '&#x9;' : '&#x20;'))
  const start = /^[ \t]+/.exec(raw)?.[0]
  const rawStart = new RegExp(`^${token}+`).exec(raw)?.[0]
  const encodedStart = new RegExp(`^${token}+`).exec(canonical)?.[0]
  if (
    start &&
    rawStart &&
    encodedStart?.includes('&') &&
    decoded(rawStart) === decoded(encodedStart)
  )
    raw = encode(start) + raw.slice(start.length)
  const end = /[ \t]+$/.exec(raw)?.[0]
  const rawEnd = new RegExp(`${token}+$`).exec(raw)?.[0]
  const encodedEnd = new RegExp(`${token}+$`).exec(canonical)?.[0]
  if (
    end &&
    rawEnd &&
    encodedEnd?.includes('&') &&
    decoded(rawEnd) === decoded(encodedEnd)
  )
    raw = raw.slice(0, -end.length) + encode(end)
  return raw
}

// Patch changed leaves so an adjacent edit retains authored delimiters and labels.
function retainSource(
  before: SourceNode,
  after: SourceNode,
  source: string,
  canonical: string,
  lineEnding: string,
): string {
  const start = before.position?.start.offset
  const end = before.position?.end.offset
  const newStart = after.position?.start.offset
  const newEnd = after.position?.end.offset
  if (start == null || end == null || newStart == null || newEnd == null)
    throw new PreservationError('A source token has no location')
  const raw = source.slice(start, end)
  if (
    before.type === 'code' &&
    after.type === 'code' &&
    before.lang === after.lang
  ) {
    const opening = /^([ \t>]*)(`{3,}|~{3,})([^\r\n]*)(\r?\n)/.exec(raw)
    if (opening) {
      const lines = raw.slice(opening[0].length).split(/\r?\n/)
      const closing = /^([ \t>]*)(`{3,}|~{3,})([ \t]*)$/.exec(
        lines.at(-1) ?? '',
      )
      const originalLine =
        (before.value ?? '').replace(/\r\n?/g, '\n').split('\n')[0] ?? ''
      const first = lines[0] ?? ''
      const gutter = first.endsWith(originalLine)
        ? first.slice(0, first.length - originalLine.length)
        : opening[1]!
      const body = (after.value ?? '').replace(/\r\n?/g, '\n').split('\n')
      const character = opening[2]![0]!
      let length = opening[2]!.length
      for (const line of body) {
        const run = new RegExp(`^ {0,3}(${character}+)[ \\t]*$`).exec(line)
        if (run) length = Math.max(length, run[1]!.length + 1)
      }
      const fence = character.repeat(length)
      return (
        opening[1] +
        fence +
        opening[3] +
        lineEnding +
        body.map((line) => gutter + line).join(lineEnding) +
        (closing
          ? lineEnding +
            closing[1] +
            character.repeat(Math.max(length, closing[2]!.length)) +
            closing[3]
          : '')
      )
    }
  }
  if (
    before.type === 'definition' &&
    after.type === 'definition' &&
    before.label === after.label &&
    before.title === after.title
  ) {
    const destination =
      /^(\[[\s\S]*?\]:[ \t]*)(<[^>\n]*>|[^\s]+)([\s\S]*)$/.exec(raw)
    if (destination)
      return (
        destination[1] +
        (destination[2]!.startsWith('<')
          ? `<${after.url}>`
          : String(after.url)) +
        destination[3]
      )
  }
  if (before.type === 'text' && after.type === 'text')
    return retainBoundaryWhitespace(
      retainText(raw, before.value!, after.value!),
      canonical.slice(newStart, newEnd),
    )
  if (
    signature(before) === signature(after) &&
    ownShape(before) === ownShape(after)
  )
    return raw
  if (
    before.type === after.type &&
    ownShape(before) === ownShape(after) &&
    before.children &&
    after.children &&
    before.children.length === after.children.length
  ) {
    let output = '',
      previous = start
    before.children.forEach((child, index) => {
      const childStart = child.position?.start.offset,
        childEnd = child.position?.end.offset
      if (childStart == null || childEnd == null)
        throw new PreservationError('A source token has no location')
      output +=
        source.slice(previous, childStart) +
        retainSource(
          child,
          after.children![index]!,
          source,
          canonical,
          lineEnding,
        )
      previous = childEnd
    })
    return output + source.slice(previous, end)
  }
  if (
    before.type === after.type &&
    ownShape(before) === ownShape(after) &&
    before.children &&
    after.children
  ) {
    let prefix = 0,
      suffix = 0
    while (
      prefix < before.children.length &&
      prefix < after.children.length &&
      signature(before.children[prefix]!) === signature(after.children[prefix]!)
    )
      prefix++
    while (
      suffix < before.children.length - prefix &&
      suffix < after.children.length - prefix &&
      signature(before.children[before.children.length - 1 - suffix]!) ===
        signature(after.children[after.children.length - 1 - suffix]!)
    )
      suffix++
    const from = prefix
      ? before.children[prefix - 1]!.position?.end.offset
      : start
    const to = suffix
      ? before.children[before.children.length - suffix]!.position?.start.offset
      : end
    const newFrom = prefix
      ? after.children[prefix - 1]!.position?.end.offset
      : newStart
    const newTo = suffix
      ? after.children[after.children.length - suffix]!.position?.start.offset
      : newEnd
    if (from != null && to != null && newFrom != null && newTo != null)
      return retainBoundaryWhitespace(
        source.slice(start, from) +
          canonical.slice(newFrom, newTo).replaceAll('\n', lineEnding) +
          source.slice(to, end),
        canonical.slice(newStart, newEnd),
      )
  }
  return canonical.slice(newStart, newEnd).replaceAll('\n', lineEnding)
}

function positionalNode(tree: Root, transformed: SourceNode): SourceNode {
  return (
    (tree.children.find(
      (node) =>
        node.position?.start.offset === transformed.position?.start.offset &&
        node.position?.end.offset === transformed.position?.end.offset,
    ) as unknown as SourceNode | undefined) ?? transformed
  )
}

export class PreservationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PreservationError'
  }
}

function form(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
}

function blockForm(ctx: Ctx, node: ProseNode): string {
  // An empty document is empty Markdown, but an empty block inside a document
  // is authored spacing and must remain a real block when read again.
  if (node.type.name === 'paragraph' && node.content.size === 0) return '<br />'
  return form(serialize(ctx, node.type.schema.topNodeType.create(null, [node])))
}

function semanticSignature(doc: ProseNode): string {
  const clean = (value: Record<string, unknown>): Record<string, unknown> => {
    const content = value.content as Record<string, unknown>[] | undefined
    if (!content) return value
    const tokens: Record<string, unknown>[] = []
    for (const child of content) {
      if (child.type !== 'text') {
        tokens.push(clean(child))
        continue
      }
      const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(child.text))!
      for (const [index, text] of parts.slice(1).entries()) {
        if (!text) continue
        const token = {
          ...child,
          text: text.replace(/\r\n?/g, '\n'),
          marks: index === 1 ? child.marks : undefined,
        }
        const previous = tokens.at(-1)
        if (
          previous?.type === 'text' &&
          JSON.stringify(previous.marks) === JSON.stringify(token.marks)
        )
          previous.text = String(previous.text) + text
        else tokens.push(token)
      }
    }
    return { ...value, content: tokens }
  }
  const json = JSON.parse(
    JSON.stringify(doc.toJSON(), (key, value) =>
      // Fresh list items default to loose even when their Markdown reopens tight.
      [
        'referenceContent',
        'referenceType',
        'listPlaceholder',
        'marker',
        'id',
        'label',
        'spread',
        'authoredFence',
      ].includes(key)
        ? undefined
        : value,
    ),
  ) as Record<string, unknown>
  return JSON.stringify(clean(json))
}

// Edit distance distinguishes replacements from insertions, so replacing a block
// retains its surrounding whitespace without assigning it a neighbour's source.
function correspondence(
  before: string[],
  after: string[],
): Array<number | undefined> {
  const result: Array<number | undefined> = new Array(after.length)
  let head = 0
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    result[head] = head
    head++
  }
  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > head &&
    endAfter > head &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    result[--endAfter] = --endBefore
  }
  const rows = endBefore - head + 1
  const columns = endAfter - head + 1
  if (rows * columns > 1_000_000)
    throw new PreservationError(
      'The edit changes too many blocks to preserve safely',
    )
  const costs = Array.from({ length: rows }, () => new Uint32Array(columns))
  for (let i = 0; i < rows; i++) costs[i]![0] = i
  for (let j = 0; j < columns; j++) costs[0]![j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      const change = before[head + i - 1] === after[head + j - 1] ? 0 : 1
      costs[i]![j] = Math.min(
        costs[i - 1]![j]! + 1,
        costs[i]![j - 1]! + 1,
        costs[i - 1]![j - 1]! + change,
      )
    }
  }
  let i = rows - 1
  let j = columns - 1
  while (i || j) {
    const change =
      i && j && before[head + i - 1] === after[head + j - 1] ? 0 : 1
    if (i && j && costs[i]![j] === costs[i - 1]![j - 1]! + change) {
      result[head + j - 1] = head + i - 1
      i--
      j--
    } else if (i && costs[i]![j] === costs[i - 1]![j]! + 1) i--
    else j--
  }
  return result
}

/** Retains the loaded source of blocks the edit leaves alone. */
export class Preservation {
  private readonly baseline: ProseNode
  private readonly blocks: Block[] = []
  private readonly lineEnding: string
  private readonly forms = new WeakMap<ProseNode, string>()

  constructor(
    private readonly ctx: Ctx,
    private readonly source: string,
  ) {
    try {
      const parse = ctx.get(parserCtx)
      this.baseline = parse(source)
      this.lineEnding =
        source.includes('\r\n') && !source.replaceAll('\r\n', '').includes('\n')
          ? '\r\n'
          : '\n'
      const processor = ctx.get(remarkCtx)
      const offset = source.startsWith('\uFEFF') ? 1 : 0
      const body = source.slice(offset)
      const rawTree = processor.parse(source) as Root
      const tree = processor.runSync(structuredClone(rawTree), {
        value: body,
      }) as Root
      for (const [index, node] of tree.children.entries()) {
        let start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start == null || end == null)
          throw new PreservationError('A source block has no location')
        start += offset
        const sourceEnd = end + offset
        const firstColumn = source.lastIndexOf('\n', start - 1) + 1
        if (/^[ \t]*$/.test(source.slice(firstColumn, start)))
          start = firstColumn
        const text = source.slice(start, sourceEnd)
        const parsed =
          this.baseline.childCount === tree.children.length
            ? this.baseline.type.create(null, [this.baseline.child(index)])
            : parse(text)
        this.blocks.push({
          start,
          end: sourceEnd,
          form:
            parsed.childCount === 1
              ? blockForm(ctx, parsed.firstChild!)
              : form(serialize(ctx, parsed)),
          ast: positionalNode(rawTree, node as unknown as SourceNode),
        })
      }
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot read Markdown for preservation', {
        cause,
      })
    }
  }

  serialize(doc: ProseNode): string {
    if (doc.eq(this.baseline)) return this.source
    try {
      const canonical = serialize(this.ctx, doc)
      if (canonical === '')
        return this.source.startsWith('\uFEFF') ? '\uFEFF' : ''
      const current: string[] = []
      doc.forEach((node) => {
        let fingerprint = this.forms.get(node)
        if (fingerprint == null) {
          fingerprint = blockForm(this.ctx, node)
          this.forms.set(node, fingerprint)
        }
        current.push(fingerprint)
      })
      const positions = correspondence(
        this.blocks.map((block) => block.form),
        current,
      )
      const processor = this.ctx.get(remarkCtx)
      const currentRawTree = processor.parse(canonical) as Root
      const currentTree = processor.runSync(structuredClone(currentRawTree), {
        value: canonical,
      }) as Root
      const body = this.source.replace(/^\uFEFF/, '')
      let output = ''
      let previous: number | undefined
      current.forEach((text, index) => {
        const position = positions[index]
        const block = position == null ? undefined : this.blocks[position]
        if (index === 0) {
          if (position === 0 && block)
            output += this.source.slice(0, block.start)
          else if (this.source.startsWith('\uFEFF')) output += '\uFEFF'
        } else if (previous != null && position === previous + 1 && block) {
          output += this.source.slice(this.blocks[previous]!.end, block.start)
        } else output += this.lineEnding.repeat(2)
        if (block && block.form === text)
          output += this.source.slice(block.start, block.end)
        else if (block && currentTree.children.length === current.length) {
          output += retainSource(
            block.ast,
            positionalNode(
              currentRawTree,
              currentTree.children[index] as unknown as SourceNode,
            ),
            body,
            canonical,
            this.lineEnding,
          )
        } else
          output += restoreCodeEndings(
            this.ctx,
            doc.type.create(null, [doc.child(index)]),
            text.replaceAll('\n', this.lineEnding),
          )
        previous = position
      })
      if (previous === this.blocks.length - 1 && this.blocks.length)
        output += this.source.slice(this.blocks[previous]!.end)
      else if (output) output += finalCodeEnding(doc) ?? this.lineEnding
      const parse = this.ctx.get(parserCtx)
      const reopened = parse(output)
      if (
        serialize(this.ctx, reopened).replace(/\r\n?/g, '\n') ===
          canonical.replace(/\r\n?/g, '\n') &&
        semanticSignature(reopened) === semanticSignature(doc)
      )
        return output
      throw new PreservationError(
        'The edited Markdown cannot be reopened without changing its content',
      )
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot preserve the edited Markdown', {
        cause,
      })
    }
  }
}
