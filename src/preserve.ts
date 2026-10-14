import { parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { serialize } from './dialect'
import { restoreCodeEndings, finalCodeEnding } from './code-fences'
import { sourceFrontmatter } from './literals'

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
    ['position', 'data', 'marker'].includes(key) ? undefined : value,
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
  inTable = false,
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
    return quoteIndent ? after : retainText(raw, before, after, true, inTable)
  }
  const inserted = after
    .slice(prefix, after.length - suffix)
    .split('')
    .map((character, index) => {
      const at = prefix + index
      const delimiter =
        (character === '%' || character === '=') &&
        (after[at - 1] === character || after[at + 1] === character)
      return delimiter ||
        /[\\`*_[\]<>]/.test(character) ||
        (inTable && character === '|')
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
  inTable = false,
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
      withEnding(
        retainText(raw, before.value!, after.value!, false, inTable),
        lineEnding,
      ),
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
    const retained = new Set<number>()
    before.children.forEach((child, index) => {
      const incoming = after.children![index]!
      const movedIndex =
        before.type === 'table' || before.type === 'tableRow'
          ? before.children!.findIndex(
              (candidate, candidateIndex) =>
                !retained.has(candidateIndex) &&
                signature(candidate) === signature(incoming) &&
                ownShape(candidate) === ownShape(incoming),
            )
          : -1
      const original = movedIndex < 0 ? child : before.children![movedIndex]!
      if (movedIndex >= 0) retained.add(movedIndex)
      const childStart = child.position?.start.offset,
        childEnd = child.position?.end.offset
      if (childStart == null || childEnd == null)
        throw new PreservationError('A source token has no location')
      let retainedSource = retainSource(
        original,
        incoming,
        source,
        canonical,
        lineEnding,
        inTable || before.type === 'tableCell',
      )
      if (before.type === 'tableRow' && movedIndex >= 0) {
        // Cell positions own different pipe boundaries at the row edges.
        const originalFrom = original.children?.[0]?.position?.start.offset
        const originalTo = original.children?.at(-1)?.position?.end.offset
        const from = child.children?.[0]?.position?.start.offset
        const to = child.children?.at(-1)?.position?.end.offset
        retainedSource =
          originalFrom != null &&
          originalTo != null &&
          from != null &&
          to != null
            ? source.slice(childStart, from) +
              source.slice(originalFrom, originalTo) +
              source.slice(to, childEnd)
            : withEnding(
                canonical.slice(
                  incoming.position!.start.offset!,
                  incoming.position!.end.offset!,
                ),
                lineEnding,
              )
      }
      output += source.slice(previous, childStart) + retainedSource
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
    // A cell's range includes its pipe and padding, which would hide a space
    // now at the edge of its content from the boundary check.
    const cell =
      before.type === 'tableCell' &&
      before.children.length > 0 &&
      after.children.length > 0
    const first = cell ? before.children[0]!.position?.start.offset : start
    const last = cell ? before.children.at(-1)!.position?.end.offset : end
    const newFirst = cell ? after.children[0]!.position?.start.offset : newStart
    const newLast = cell ? after.children.at(-1)!.position?.end.offset : newEnd
    const from = prefix
      ? before.children[prefix - 1]!.position?.end.offset
      : first
    const to = suffix
      ? before.children[before.children.length - suffix]!.position?.start.offset
      : last
    const newFrom = prefix
      ? after.children[prefix - 1]!.position?.end.offset
      : newFirst
    const newTo = suffix
      ? after.children[after.children.length - suffix]!.position?.start.offset
      : newLast
    if (
      first != null &&
      last != null &&
      newFirst != null &&
      newLast != null &&
      from != null &&
      to != null &&
      newFrom != null &&
      newTo != null
    )
      return (
        source.slice(start, first) +
        retainBoundaryWhitespace(
          source.slice(first, from) +
            withEnding(canonical.slice(newFrom, newTo), lineEnding) +
            source.slice(to, last),
          canonical.slice(newFirst, newLast),
        ) +
        source.slice(last, end)
      )
  }
  return withEnding(canonical.slice(newStart, newEnd), lineEnding)
}

// Canonical Markdown keeps authored CRLF inside literal blocks and code fences.
function withEnding(text: string, lineEnding: string): string {
  return lineEnding === '\n' ? text : text.replace(/\r?\n/g, lineEnding)
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
    if (value.type === 'inkkit_wiki_link' && value.attrs) {
      const {
        raw: _raw,
        inTable: _inTable,
        ...attrs
      } = value.attrs as Record<string, unknown>
      value = { ...value, attrs }
    }
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
        'inkkitFileRaw',
        'inkkitFileWidth',
        'inkkitFileInTable',
      ].includes(key)
        ? undefined
        : value,
    ),
  ) as Record<string, unknown>
  return JSON.stringify(clean(json))
}

// Milkdown derives heading DOM IDs; Markdown stores the level and content.
function withoutHeadingId(node: ProseNode): ProseNode {
  return node.type.name === 'heading' && node.attrs.id
    ? node.type.create({ ...node.attrs, id: '' }, node.content, node.marks)
    : node
}

const MATCHING_BUDGET = 1_000_000
const SIMILARITY_BUDGET = 4_000_000

interface Anchor {
  b: number
  a: number
}

// Unchanged blocks are anchored first, so a long document with many scattered
// edits is matched as many short gaps rather than one wide span.
export function correspondence(
  before: string[],
  after: string[],
  resemblance = true,
): Array<number | undefined> {
  const result: Array<number | undefined> = new Array(after.length)
  const work = {
    budget: MATCHING_BUDGET,
    similarity: resemblance ? SIMILARITY_BUDGET : 0,
  }
  const spans = [{ b: 0, a: 0, bEnd: before.length, aEnd: after.length }]
  for (let span = spans.pop(); span; span = spans.pop()) {
    let { b, a, bEnd, aEnd } = span
    while (b < bEnd && a < aEnd && before[b] === after[a]) result[a++] = b++
    while (b < bEnd && a < aEnd && before[bEnd - 1] === after[aEnd - 1])
      result[--aEnd] = --bEnd
    if (b === bEnd || a === aEnd) continue
    work.budget -= bEnd - b + (aEnd - a)
    if (work.budget < 0) throw tooManyBlocks()
    const anchors = uniqueAnchors(before, after, b, bEnd, a, aEnd)
    if (!anchors.length) {
      align(before, after, b, bEnd, a, aEnd, result, work)
      continue
    }
    for (const anchor of anchors) {
      result[anchor.a] = anchor.b
      spans.push({ b, a, bEnd: anchor.b, aEnd: anchor.a })
      b = anchor.b + 1
      a = anchor.a + 1
    }
    spans.push({ b, a, bEnd, aEnd })
  }
  return result
}

function tooManyBlocks(): PreservationError {
  return new PreservationError(
    'The edit changes too many blocks to preserve safely',
  )
}

// Blocks that occur exactly once on each side, in the longest subsequence whose
// order the two sides share. A repeated block is never an anchor: which copy it
// belongs to is not known until its neighbours are placed.
function uniqueAnchors(
  before: string[],
  after: string[],
  b: number,
  bEnd: number,
  a: number,
  aEnd: number,
): Anchor[] {
  const once = (list: string[], from: number, to: number) => {
    const at = new Map<string, number>()
    for (let i = from; i < to; i++) at.set(list[i]!, at.has(list[i]!) ? -1 : i)
    return at
  }
  const beforeAt = once(before, b, bEnd)
  const afterAt = once(after, a, aEnd)
  const pairs: Anchor[] = []
  for (let i = a; i < aEnd; i++) {
    const match = beforeAt.get(after[i]!)
    if (match != null && match >= 0 && afterAt.get(after[i]!) === i)
      pairs.push({ b: match, a: i })
  }
  // Patience sorting: tails[k] ends the best increasing subsequence of length k + 1.
  const tails: number[] = []
  const previous: number[] = new Array(pairs.length)
  for (const [index, pair] of pairs.entries()) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (pairs[tails[middle]!]!.b < pair.b) low = middle + 1
      else high = middle
    }
    previous[index] = low ? tails[low - 1]! : -1
    tails[low] = index
  }
  const anchors: Anchor[] = []
  let at = tails.length ? tails[tails.length - 1]! : -1
  while (at >= 0) {
    anchors.push(pairs[at]!)
    at = previous[at]!
  }
  return anchors.reverse()
}

// Replacing a block costs more than inserting or deleting one, so an unchanged
// block keeps its own copy rather than pairing with a deleted neighbour, and
// less than both, so an edited block still keeps its surrounding whitespace.
const INDEL = 2
const REPLACE = 3

function align(
  before: string[],
  after: string[],
  b: number,
  bEnd: number,
  a: number,
  aEnd: number,
  result: Array<number | undefined>,
  work: { budget: number; similarity: number },
): void {
  const rows = bEnd - b + 1
  const columns = aEnd - a + 1
  const offset = Math.abs(rows - columns)
  let width = Math.max(1, offset)
  for (;;) {
    const costs: Uint32Array[] = []
    const get = (i: number, j: number): number =>
      i < 0 || j < 0 || Math.abs(i - j) > width
        ? Infinity
        : (costs[i]?.[j - Math.max(0, i - width)] ?? Infinity)
    for (let i = 0; i < rows; i++) {
      const from = Math.max(0, i - width)
      const to = Math.min(columns - 1, i + width)
      work.budget -= to - from + 1
      if (work.budget < 0) throw tooManyBlocks()
      const row = new Uint32Array(to - from + 1)
      costs.push(row)
      for (let j = from; j <= to; j++) {
        const change = before[b + i - 1] === after[a + j - 1] ? 0 : REPLACE
        row[j - from] =
          i === 0
            ? j * INDEL
            : j === 0
              ? i * INDEL
              : Math.min(
                  get(i - 1, j) + INDEL,
                  get(i, j - 1) + INDEL,
                  get(i - 1, j - 1) + change,
                )
      }
    }
    // A path that leaves the band takes at least width + 1 insertions or
    // deletions away from the diagonal and width + 1 - offset back to its end,
    // so a path inside the band that costs no more is optimal. Widen only when
    // needed, charging every attempt to the same work budget.
    if (
      width < Math.max(rows, columns) - 1 &&
      get(rows - 1, columns - 1) > INDEL * (2 * (width + 1) - offset)
    ) {
      width *= 2
      continue
    }
    const unchanged: Anchor[] = []
    let i = rows - 1
    let j = columns - 1
    while (i || j) {
      const same = i && j && before[b + i - 1] === after[a + j - 1]
      if (i && j && get(i, j) === get(i - 1, j - 1) + (same ? 0 : REPLACE)) {
        result[a + j - 1] = b + i - 1
        if (same) unchanged.push({ b: b + i - 1, a: a + j - 1 })
        i--
        j--
      } else if (i && get(i, j) === get(i - 1, j) + INDEL) i--
      else j--
    }
    unchanged.push({ b: b - 1, a: a - 1 })
    unchanged.reverse().push({ b: bEnd, a: aEnd })
    for (let index = 1; index < unchanged.length; index++)
      pairSimilar(
        before,
        after,
        unchanged[index - 1]!.b + 1,
        unchanged[index]!.b,
        unchanged[index - 1]!.a + 1,
        unchanged[index]!.a,
        result,
        work,
      )
    return
  }
}

// Between unchanged blocks, edit distance prices every replacement alike, so
// it cannot tell which original an edited block came from. Pair each with the
// original it most resembles, keeping their order: typing in a block then keeps
// its own source even when a neighbour was inserted or deleted beside it.
function pairSimilar(
  before: string[],
  after: string[],
  b: number,
  bEnd: number,
  a: number,
  aEnd: number,
  result: Array<number | undefined>,
  work: { similarity: number },
): void {
  const removed = bEnd - b
  const added = aEnd - a
  if (!removed || !added || (removed === 1 && added === 1)) return
  // Resemblance decides; among equally resembling pairings, more pairs keep
  // more replaced blocks in place with their surrounding whitespace.
  const bonus = 1 / (Math.min(removed, added) + 1)
  // This is a refinement with its own budget of characters compared. When it
  // runs out, the alignment's pairing stands rather than the edit failing.
  if (removed * added > work.similarity) return
  const weights = new Float64Array(removed * added)
  for (let x = 0; x < removed; x++)
    for (let y = 0; y < added; y++) {
      const shared = similarity(before[b + x]!, after[a + y]!)
      work.similarity -= shared + 1
      if (work.similarity < 0) return
      weights[x * added + y] = shared + bonus
    }
  const best = Array.from(
    { length: removed + 1 },
    () => new Float64Array(added + 1),
  )
  for (let x = 1; x <= removed; x++)
    for (let y = 1; y <= added; y++)
      best[x]![y] = Math.max(
        best[x - 1]![y]!,
        best[x]![y - 1]!,
        best[x - 1]![y - 1]! + weights[(x - 1) * added + y - 1]!,
      )
  for (let index = a; index < aEnd; index++) result[index] = undefined
  for (let x = removed, y = added; x && y;) {
    if (
      best[x]![y] ===
      best[x - 1]![y - 1]! + weights[(x - 1) * added + y - 1]!
    ) {
      result[a + --y] = b + --x
    } else if (best[x]![y] === best[x - 1]![y]) x--
    else y--
  }
}

// Characters an edit left in place at the start and end of a block.
function similarity(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let prefix = 0
  while (prefix < limit && left[prefix] === right[prefix]) prefix++
  let suffix = 0
  while (
    suffix < limit - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++
  return prefix + suffix
}

/** Retains the loaded source of blocks the edit leaves alone. */
export class Preservation {
  private readonly baseline: ProseNode
  private readonly blocks: Block[] = []
  private readonly lineEnding: string
  private readonly originalForms = new Set<string>()
  private readonly forms = new WeakMap<ProseNode, string>()
  private readonly textBlockEdits = new WeakMap<
    ProseNode,
    { index: number; text: string }
  >()

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
      for (const block of this.blocks) this.originalForms.add(block.form)
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot read Markdown for preservation', {
        cause,
      })
    }
  }

  private retainBlock(
    block: Block,
    after: SourceNode,
    canonical: string,
  ): string {
    const offset = this.source.startsWith('\uFEFF') ? 1 : 0
    const start = block.ast.position?.start.offset
    if (start == null)
      throw new PreservationError('A source block has no location')
    return (
      this.source.slice(block.start, start + offset) +
      retainSource(
        block.ast,
        after,
        this.source.slice(offset),
        canonical,
        this.lineEnding,
      )
    )
  }

  private independentTextBlocks(doc: ProseNode): string | undefined {
    if (
      this.baseline.childCount !== this.blocks.length ||
      doc.childCount !== this.blocks.length ||
      !doc.sameMarkup(this.baseline)
    )
      return undefined
    let output = '',
      previous = 0
    for (let index = 0; index < doc.childCount; index++) {
      const node = doc.child(index)
      const before = this.baseline.child(index)
      const block = this.blocks[index]!
      if (node.eq(before)) continue
      let retained = this.textBlockEdits.get(node)
      if (retained?.index !== index) {
        const raw = this.source.slice(block.start, block.end)
        const expected = withoutHeadingId(node)
        // References and HTML/comments can depend on other blocks. Restrict
        // local validation to text blocks without these context-sensitive forms.
        const contextual = /[\[<]|%%/
        const textOnly = (block: ProseNode): boolean => {
          let valid = true
          block.forEach((child) => {
            if (!child.isText) valid = false
          })
          return valid
        }
        if (
          !['paragraph', 'heading'].includes(node.type.name) ||
          !expected.sameMarkup(withoutHeadingId(before)) ||
          !textOnly(node) ||
          !textOnly(before) ||
          contextual.test(raw) ||
          (index > 0 &&
            !/\r?\n[ \t]*\r?\n/.test(
              this.source.slice(this.blocks[index - 1]!.end, block.start),
            )) ||
          (index + 1 < this.blocks.length &&
            !/\r?\n[ \t]*\r?\n/.test(
              this.source.slice(block.end, this.blocks[index + 1]!.start),
            ))
        )
          return undefined
        const canonical = blockForm(this.ctx, node)
        if (
          contextual.test(canonical) ||
          (canonical !== block.form && this.originalForms.has(canonical))
        )
          return undefined
        const tree = this.ctx.get(remarkCtx).parse(canonical) as Root
        if (tree.children.length !== 1) return undefined
        const text = this.retainBlock(
          block,
          tree.children[0] as unknown as SourceNode,
          canonical,
        )
        const reopened = this.ctx.get(parserCtx)(text)
        if (reopened.childCount !== 1) return undefined
        if (!withoutHeadingId(reopened.firstChild!).eq(expected))
          return undefined
        retained = { index, text }
        this.textBlockEdits.set(node, retained)
      }
      output += this.source.slice(previous, block.start) + retained.text
      previous = block.end
    }
    return output + this.source.slice(previous)
  }

  serialize(doc: ProseNode): string {
    if (doc.eq(this.baseline)) return this.source
    try {
      const independent = this.independentTextBlocks(doc)
      if (independent !== undefined) return independent
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
      const forms = this.blocks.map((block) => block.form)
      const resembling = correspondence(forms, current)
      const processor = this.ctx.get(remarkCtx)
      const currentRawTree = processor.parse(canonical) as Root
      const currentTree = processor.runSync(structuredClone(currentRawTree), {
        value: canonical,
      }) as Root
      const parse = this.ctx.get(parserCtx)
      const normalized = (text: string): string => text.replace(/\r\n?/g, '\n')
      const reconstruct = (
        positions: Array<number | undefined>,
      ): string | undefined => {
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
            output += this.retainBlock(
              block,
              positionalNode(
                currentRawTree,
                currentTree.children[index] as unknown as SourceNode,
              ),
              canonical,
            )
          } else
            output += restoreCodeEndings(
              this.ctx,
              doc.type.create(null, [doc.child(index)]),
              withEnding(text, this.lineEnding),
            )
          previous = position
        })
        if (previous === this.blocks.length - 1 && this.blocks.length)
          output += this.source.slice(this.blocks[previous]!.end)
        else if (output) output += finalCodeEnding(doc) ?? this.lineEnding
        // A `---` rule that opens the file reads back as front matter when
        // another `---` line follows, whether it is new or moved there.
        const bom = output.startsWith('\uFEFF') ? 1 : 0
        if (
          doc.firstChild?.type.name === 'hr' &&
          sourceFrontmatter(output.slice(bom))?.startsWith('---')
        )
          output = output.slice(0, bom) + '***' + output.slice(bom + 3)
        const reopened = parse(output)
        if (semanticSignature(reopened) === semanticSignature(doc)) {
          const actual = normalized(serialize(this.ctx, reopened))
          if (actual === normalized(canonical)) return output
          // Parsing may normalize loose-list spacing. Compare both reconstructed
          // source and intended canonical source after that same normalization.
          if (actual === normalized(serialize(this.ctx, parse(canonical))))
            return output
        }
        return undefined
      }
      // Pairing by resemblance can leave a block in canonical form beside an
      // authored neighbour it then merges with, such as two lists. The
      // alignment's own pairing does not depend on resemblance, so try it too.
      const output =
        reconstruct(resembling) ??
        (() => {
          const aligned = correspondence(forms, current, false)
          // Unmatched blocks are holes, which every() would skip.
          return current.every(
            (_, index) => aligned[index] === resembling[index],
          )
            ? undefined
            : reconstruct(aligned)
        })()
      if (output !== undefined) return output
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
