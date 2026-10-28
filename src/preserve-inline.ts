import { matchingTextEdges } from './text-edges'
import { linkForm } from './link-form'
import { type SourceNode, type Gutters } from './preserve-types'
import {
  signature,
  formatting,
  inlineParents,
  inlineText,
  lf,
} from './preserve-shape'
import { regutter } from './preserve-list'

// The text Markdown inline source reads as, with the source offset of each of
// its characters; undefined where it holds more than escapes and entities, or
// line endings when `lines` is set. A line ending reads as LF without the
// spaces and tabs before it or the quote markers and indentation after it,
// which paragraph text leaves out; the offset before it is where those spaces
// start, so text typed at the end of a line goes before them.
export function decodedOffsets(
  raw: string,
  lines = false,
): { decoded: string; offsets: number[] } | undefined {
  const offsets = [0]
  let decoded = ''
  for (let index = 0; index < raw.length;) {
    const rest = raw.slice(index)
    // Only a run of spaces and tabs from its start can lead to a line
    // ending, which keeps a long run linear.
    const line =
      /[ \t]/.test(raw[index - 1] ?? '') && /[ \t]/.test(raw[index]!)
        ? undefined
        : /^[ \t]*(?:\r\n?|\n)(?:[ \t]*>)*[ \t]*/.exec(rest)?.[0]
    let token =
      line ??
      /^\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.exec(rest)?.[0] ??
      /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);/.exec(rest)?.[0]
    let value = raw[index]!
    if (line) {
      if (!lines) return undefined
      value = '\n'
    } else if (token?.startsWith('\\')) value = token[1]!
    else if (token) {
      const element = document.createElement('textarea')
      element.innerHTML = token
      // A name that is no reference, such as `&am;`, is the characters it is
      // spelled with.
      if (element.value === token) token = undefined
      else value = element.value
    }
    index += token?.length ?? 1
    decoded += value
    for (let part = 0; part < value.length; part++) offsets.push(index)
  }
  return { decoded, offsets }
}

// GFM finds addresses after punctuation in a pass after parsing, which gives
// the address and the text split around it no position. Each such run of
// children is found in the source between its located neighbours.
export function locateChildren(node: SourceNode, text: string): void {
  const children = node.children
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (!children || start == null || end == null) return
  for (let index = 0; index < children.length;) {
    if (children[index]!.position?.start.offset != null) {
      index++
      continue
    }
    let last = index
    while (
      last < children.length &&
      children[last]!.position?.start.offset == null
    )
      last++
    const from = children[index - 1]?.position?.end.offset ?? start
    const to = children[last]?.position?.start.offset ?? end
    const run = children.slice(index, last)
    const values = run.map((child) => lf(inlineText(child)))
    const read = decodedOffsets(text.slice(from, to), true)
    const at = read?.decoded.indexOf(values.join(''))
    if (
      read &&
      at != null &&
      at >= 0 &&
      run.every((child) => child.type === 'text' || child.type === 'link')
    ) {
      let offset = at
      run.forEach((child, part) => {
        const childStart = from + read.offsets[offset]!
        offset += values[part]!.length
        const childEnd = from + read.offsets[offset]!
        child.position = {
          start: { offset: childStart },
          end: { offset: childEnd },
        } as SourceNode['position']
        child.children?.forEach((inner) => {
          inner.position = child.position
        })
      })
    }
    index = last
  }
}

// The text a run of text, breaks and links written bare or in angle
// brackets reads as, with the offset in `text` of each character and the
// range of each link, or undefined for any other run.
function runOffsets(
  nodes: readonly SourceNode[],
  text: string,
  from: number,
  to: number,
):
  | {
      decoded: string
      offsets: number[]
      links: Array<[number, number]>
      breaks: Set<number>
    }
  | undefined {
  let decoded = ''
  const offsets = [from]
  const links: Array<[number, number]> = []
  const breaks = new Set<number>()
  let at = from
  let afterBreak = false
  for (const node of nodes) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start == null || end == null) return undefined
    // Container indentation belongs to the break, before the following text.
    if (afterBreak && start >= at && /^[ \t>]*$/.test(text.slice(at, start))) {
      at = start
      offsets[offsets.length - 1] = start
    }
    if (start !== at) return undefined
    const raw = text.slice(start, end)
    if (node.type === 'link') {
      const label = inlineText(node)
      const angle = raw === `<${label}>`
      if (raw !== label && !angle) return undefined
      links.push([decoded.length, decoded.length + label.length])
      decoded += label
      // An edit widens to whole links, so only their ends are used.
      for (let index = 1; index <= label.length; index++)
        offsets.push(
          index === label.length ? end : start + index + Number(angle),
        )
    } else if (node.type === 'text') {
      const read = decodedOffsets(raw, true)
      if (!read || read.decoded !== lf(node.value ?? '')) return undefined
      decoded += read.decoded
      offsets.push(...read.offsets.slice(1).map((offset) => start + offset))
    } else if (node.type === 'break') {
      breaks.add(decoded.length)
      decoded += '\n'
      offsets.push(end)
    } else return undefined
    afterBreak = node.type === 'break'
    at = end
  }
  return at === to ? { decoded, offsets, links, breaks } : undefined
}

// A run of text, breaks and addresses keeps its source outside the edit.
// The edit, widened to the addresses it touches before or after, is written
// as the canonical writer writes it, since escapes kept beside a new address
// could stop it reading as one.
export function retainRun(
  before: readonly SourceNode[],
  after: readonly SourceNode[],
  source: string,
  canonical: string,
  [from, to]: [number, number],
  [newFrom, newTo]: [number, number],
): string | undefined {
  const old = runOffsets(before, source, from, to)
  const now = runOffsets(after, canonical, newFrom, newTo)
  if (!old || !now) return undefined
  const a = old.decoded
  const b = now.decoded
  let prefix = 0
  while (
    prefix < a.length &&
    prefix < b.length &&
    a[prefix] === b[prefix] &&
    old.breaks.has(prefix) === now.breaks.has(prefix)
  )
    prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix] &&
    old.breaks.has(a.length - 1 - suffix) ===
      now.breaks.has(b.length - 1 - suffix)
  )
    suffix++
  for (let widened = true; widened;) {
    widened = false
    for (const [links, length] of [
      [old.links, a.length],
      [now.links, b.length],
    ] as const)
      for (const [start, end] of links)
        if (start <= length - suffix && end >= prefix) {
          if (start < prefix) {
            prefix = start
            widened = true
          }
          if (length - end < suffix) {
            suffix = length - end
            widened = true
          }
        }
  }
  return (
    source.slice(from, old.offsets[prefix]) +
    canonical.slice(now.offsets[prefix], now.offsets[b.length - suffix]) +
    (now.breaks.has(b.length - suffix - 1)
      ? retainBoundaryText(
          source.slice(old.offsets[a.length - suffix], to),
          canonical.slice(now.offsets[b.length - suffix], newTo),
          true,
        )
      : source.slice(old.offsets[a.length - suffix], to))
  )
}

export function retainText(
  raw: string,
  before: string,
  after: string,
  inTable = false,
  // The canonical text, used for text inserted against a link, and whether a
  // link sits before and after this text.
  written?: string,
  beside: readonly [boolean, boolean] = [false, false],
  // The gutter of the paragraph's lines, which a line added to the text takes.
  // Read only when a line is added, since finding it scans the line.
  readGutters?: () => Gutters,
): string {
  let found: Gutters | undefined
  const gutters = () => (found ??= readGutters?.())
  const guttered = (text: string) =>
    text.includes('\n') ? regutter(text, gutters()) : text
  before = lf(before)
  after = lf(after)
  let { prefix, suffix } = matchingTextEdges(before, after)
  const read = decodedOffsets(raw, true)
  if (read?.decoded !== before) return after
  const { offsets } = read
  // A marker becomes structural only when the following space arrives. Its
  // required escape can therefore fall in the unchanged prefix of this edit.
  const lineStart = after.lastIndexOf('\n', prefix - 1) + 1
  if (lineStart > 0 && written !== undefined) {
    const canonical = decodedOffsets(written, true)
    if (canonical?.decoded === after) {
      const opening = written.slice(canonical.offsets[lineStart])
      const marker = /^(?:\d+)?\\[#+.\->)]/.exec(opening)?.[0]
      if (
        marker &&
        prefix - lineStart <= decodedOffsets(marker)!.decoded.length
      ) {
        prefix = lineStart
        return (
          raw.slice(0, offsets[prefix]) +
          guttered(
            written.slice(
              canonical.offsets[prefix],
              canonical.offsets[after.length - suffix],
            ),
          ) +
          raw.slice(offsets[before.length - suffix])
        )
      }
    }
  }
  // Text written against a link is written as the canonical writer writes
  // it, which knows what a bare address would run into.
  if (
    written !== undefined &&
    ((beside[0] && prefix === 0) || (beside[1] && suffix === 0))
  ) {
    const writtenOffsets = decodedOffsets(written)
    if (writtenOffsets && writtenOffsets.decoded === after)
      return (
        raw.slice(0, offsets[prefix]) +
        guttered(
          written.slice(
            writtenOffsets.offsets[prefix],
            writtenOffsets.offsets[after.length - suffix],
          ),
        ) +
        raw.slice(offsets[before.length - suffix])
      )
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
        : character === '\n'
          ? character + (gutters()?.[0] ?? '')
          : character
    })
    .join('')
  return escapeReferences(
    raw.slice(0, offsets[prefix]),
    inserted,
    raw.slice(offsets[before.length - suffix]),
  )
}

const characterReference = /&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]*);/g

// Text typed beside other text can complete a character reference, such as
// `&amp` and `;`, which would read back as the character it stands for. The
// semicolon of a reference that the typed text takes part in is escaped, so
// the text stays the characters typed and the text before it is left alone.
function escapeReferences(
  head: string,
  inserted: string,
  tail: string,
): string {
  const text = head + inserted + tail
  const from = head.length
  const to = from + inserted.length
  let output = '',
    at = 0
  for (const match of text.matchAll(characterReference)) {
    const start = match.index
    const end = start + match[0].length
    // A reference the typed text is not part of keeps its spelling, and so
    // does one whose `&` is escaped.
    if (
      start >= to ||
      end <= from ||
      (/\\*$/.exec(text.slice(0, start))![0].length & 1) === 1
    )
      continue
    output += text.slice(at, end - 1) + '\\'
    at = end - 1
  }
  return output + text.slice(at)
}

export function retainBoundaryText(
  raw: string,
  canonical: string,
  afterBreak = false,
): string {
  // A new line can turn unchanged punctuation into a block opener. Take its
  // opening escapes from the writer, retaining the authored text after them.
  if (afterBreak) {
    const opening = /^(?:\d+)?(?:\\.)+/.exec(canonical)?.[0]
    const written = opening ? decodedOffsets(opening) : undefined
    const original = written ? decodedOffsets(raw, true) : undefined
    if (written && original?.decoded.startsWith(written.decoded))
      raw = opening + raw.slice(original.offsets[written.decoded.length])
  }
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
  // A callout header and its first body line share a Markdown text node.
  // Check each line after its quote markers, so a newly exposed body space
  // gets the same encoding as a space at the start of a paragraph.
  if (raw.includes('\n')) {
    const lines = raw.split(/(\r?\n)/)
    const written = canonical.split(/\r?\n/)
    if (lines.length === written.length * 2 - 1)
      return lines
        .map((line, index) => {
          if (index % 2) return line
          const canonicalLine = written[index / 2]!
          const gutter = (value: string) =>
            /^(?:[ \t]*>)*/.exec(value)?.[0] ?? ''
          const prefix = gutter(line)
          const canonicalPrefix = gutter(canonicalLine)
          if (
            prefix.replace(/[ \t]/g, '') !==
            canonicalPrefix.replace(/[ \t]/g, '')
          )
            return line
          const canonicalBody = canonicalLine.slice(canonicalPrefix.length)
          return (
            prefix +
            retainBoundaryText(line.slice(prefix.length), canonicalBody)
          )
        })
        .join('')
  }
  const rawStart = new RegExp(`^${token}+`).exec(raw)?.[0]
  const encodedStart = new RegExp(`^${token}+`).exec(canonical)?.[0]
  if (rawStart && encodedStart?.includes('&')) {
    // Only the tail from the first reference is content. The whitespace
    // before it can be container indentation, whose width differs in the
    // authored and canonical forms. Keep that prefix and entity spelling.
    const content = decoded(encodedStart.slice(encodedStart.indexOf('&')))
    const parts = rawStart.match(new RegExp(token, 'g'))!
    const from = parts.length - content.length
    if (from >= 0 && decoded(parts.slice(from).join('')) === content)
      raw =
        parts
          .map((part, index) => (index < from ? part : encode(part)))
          .join('') + raw.slice(rawStart.length)
  }
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

// The text an address could run into from one side: up to the first space,
// and whether the space is the last text of the block.
function edge(text: string): string {
  const run = /^\S*/.exec(text)![0]
  const rest = text.slice(run.length)
  return `${run}|${rest === '' ? 'end' : /^\s+$/.test(rest) ? 'space' : rest[0]}`
}

const reversed = (text: string) => [...text].reverse().join('')

// A bare address reads differently beside other text: a character written
// against it can join it, so it is written bare, in angle brackets or as a
// link depending on its neighbours; and whether formatting delimiters open
// or close depends on the characters beside them. An address whose own text
// changed, or an address or formatting that an edit reaches with no space
// between, takes the form the edited document writes. Every other node keeps
// its source.
export function rewrittenAddress(
  parent: string,
  before: readonly SourceNode[],
  beforeIndex: number,
  after: readonly SourceNode[],
  afterIndex: number,
  source: string,
  canonical: string,
): boolean {
  const old = before[beforeIndex]
  const now = after[afterIndex]
  if (!old || !now || !inlineParents.has(parent)) return false
  const links = (node: SourceNode, found: SourceNode[] = []) => {
    if (node.type === 'link') found.push(node)
    node.children?.forEach((child) => links(child, found))
    return found
  }
  const oldLinks = links(old)
  const address = oldLinks.some((link) => linkForm(link, source) !== null)
  if (!address && !formatting.has(old.type)) return false
  if (now.position?.start.offset == null) return false
  // The text beside the node, read away from it only as far as `edge` needs:
  // past the first space to the next other character.
  const beside = (nodes: readonly SourceNode[], from: number, step: 1 | -1) => {
    let text = ''
    for (let index = from; index >= 0 && index < nodes.length; index += step) {
      const part = inlineText(nodes[index]!)
      text += step > 0 ? part : reversed(part)
      if (/\s\S/.test(text)) break
    }
    return text
  }
  // Formatting whose content changed is compared child by child instead.
  if (old.type !== 'link' && signature(old) !== signature(now)) return false
  const following = [
    beside(before, beforeIndex + 1, 1),
    beside(after, afterIndex + 1, 1),
  ]
  const preceding = [
    beside(before, beforeIndex - 1, -1),
    beside(after, afterIndex - 1, -1),
  ]
  const slice = (node: SourceNode, from: string) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start == null || end == null ? undefined : from.slice(start, end)
  }
  // Delimiters open and close the same beside a space or punctuation, but
  // not always beside other text; where that changed, the formatting takes
  // the form the edited document writes.
  const kind = (text: string) => text === '' || /^[\s\p{P}\p{S}]/u.test(text)
  if (
    formatting.has(old.type) &&
    (kind(following[0]!) !== kind(following[1]!) ||
      kind(preceding[0]!) !== kind(preceding[1]!)) &&
    slice(old, source) !== slice(now, canonical)
  )
    return true
  if (
    !address ||
    (signature(old) === signature(now) &&
      edge(following[0]!) === edge(following[1]!) &&
      edge(preceding[0]!) === edge(preceding[1]!))
  )
    return false
  const nowLinks = links(now)
  if (oldLinks.length !== nowLinks.length) return true
  return oldLinks.some((link, index) => {
    if (linkForm(link, source) === null) return false
    const written = slice(link, source)
    return (
      written === undefined || written !== slice(nowLinks[index]!, canonical)
    )
  })
}
