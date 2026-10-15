import { parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Mark, type Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { serialize } from './dialect'
import { semanticSignature } from './preserve'
import type { LinkForm } from './link-form'

interface Character {
  pos: number
  text: string
  link: Mark | undefined
  form: LinkForm
  marks: readonly Mark[]
}

// A text block's characters; undefined where an inline node breaks the text.
function characters(
  block: ProseNode,
  start: number,
): Array<Character | undefined> {
  const result: Array<Character | undefined> = []
  block.forEach((child, offset) => {
    if (!child.isText) {
      result.push(undefined)
      return
    }
    const link = child.marks.find((mark) => mark.type.name === 'link')
    const marks = child.marks.filter((mark) => mark !== link)
    const form = link ? ((link.attrs.form as LinkForm) ?? null) : null
    for (let index = 0; index < child.text!.length; index++)
      result.push({
        pos: start + offset + index,
        text: child.text![index]!,
        link,
        form,
        marks,
      })
  })
  return result
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) =>
  a.length === b.length && a.every((mark, index) => mark.eq(b[index]!))

type Found = Array<[number, number, string]>

// The links each text reads as when written as `sources`, as [start, end,
// href] within it. Undefined where a source does not read as its text.
function read(
  ctx: Ctx,
  sources: string[],
  texts: string[],
): Array<Found | undefined> {
  if (!texts.length) return []
  // A leading word puts each text after a space, where an address may start,
  // and keeps it a paragraph of its own.
  const reopened = ctx.get(parserCtx)(
    sources.map((source) => `x ${source}`).join('\n\n'),
  )
  if (reopened.childCount !== texts.length)
    return texts.length === 1
      ? [undefined]
      : texts.flatMap((text, index) => read(ctx, [sources[index]!], [text]))
  return texts.map((text, index) => {
    const paragraph = reopened.child(index)
    if (
      paragraph.type.name !== 'paragraph' ||
      paragraph.textContent !== `x ${text}`
    )
      return undefined
    const found: Found = []
    let valid = true
    paragraph.forEach((child, offset) => {
      if (!child.isText) valid = false
      const link = child.marks.find((mark) => mark.type.name === 'link')
      if (child.marks.length > (link ? 1 : 0)) valid = false
      if (link)
        found.push([offset - 2, offset - 2 + child.nodeSize, link.attrs.href])
    })
    return valid ? found : undefined
  })
}

// The links each text reads as once saved. Typed text is written with its
// brackets and backslashes escaped, which decides whether GFM reads an address
// while parsing or afterwards, so it is read as written, not as authored: text
// such as `[a](http://x.com` reads as plain text unescaped but as a link to the
// address escaped, and it is the escaped text that is saved. Undefined where
// the written text does not read as itself.
function literals(ctx: Ctx, texts: string[]): Array<Found | undefined> {
  // GFM reads an address only after `www.`, `http://` or `https://`, or
  // around `@`, so other text needs no reading.
  const possible = texts.map((text) => /www\.|https?:\/\/|@/i.test(text))
  const candidates = texts.filter((_, index) => possible[index])
  const found = read(
    ctx,
    candidates.map((text) => text.replace(/[\\`[\]<>]/g, '\\$&')),
    candidates,
  )
  return texts.map((_, index) => (possible[index] ? found.shift() : []))
}

// CommonMark reads an address in angle brackets as a link to it, or to
// `mailto:` it for an email address.
function angleHref(text: string): string | undefined {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>\u0000-\u001f]*$/.test(text))
    return text
  if (
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
      text,
    )
  )
    return `mailto:${text}`
  return undefined
}

interface Wanted {
  href: string
  form: LinkForm
}

// Where a link is wanted on each character of a block that an edit reaches:
// the runs that hold the changed characters `from` to `to`, or touch them
// with no space between. A run a space separates from the change is left as
// it is, since its text may come from character references or escapes the
// editor does not hold. Characters inside a link written with brackets are
// left as they are.
function wantedLinks(
  ctx: Ctx,
  chars: Array<Character | undefined>,
  from: number,
  to: number,
): Map<number, Wanted | null> {
  const wanted = new Map<number, Wanted | null>()
  // An address in angle brackets keeps them while it is still one. Text after
  // a space in it, or all of it once it is no longer one, is read as bare
  // text below.
  const released = new Set<number>()
  for (let index = 0; index < chars.length;) {
    const link = chars[index]?.form === 'angle' ? chars[index]!.link : undefined
    if (!link) {
      index++
      continue
    }
    let end = index + 1
    while (end < chars.length && chars[end]?.link?.eq(link)) end++
    if (end >= from && index <= to) {
      const text = chars
        .slice(index, end)
        .map((char) => char!.text)
        .join('')
      // Text typed onto the end of an address that ends the address, such as
      // a full stop, stays outside it.
      let address = /^\S*/.exec(text)![0]
      while (address && !angleHref(address)) address = address.slice(0, -1)
      const href = angleHref(address)
      for (let at = index; at < end; at++)
        if (href && at < index + address.length)
          wanted.set(at, { href, form: 'angle' })
        else released.add(at)
    }
    index = end
  }
  // Bare text: runs without whitespace and with the same formatting, where
  // an address could be read or could end. Inline code is written as it is,
  // so it holds no addresses.
  const free = (index: number) => {
    const char = chars[index]
    return (
      char !== undefined &&
      !char.marks.some((mark) => mark.type.spec.code) &&
      (released.has(index) ||
        (char.form !== 'angle' && !(char.link && !char.form)))
    )
  }
  const spans: Array<[number, number]> = []
  for (let index = 0; index < chars.length;) {
    const char = chars[index]
    if (!free(index) || /\s/.test(char!.text)) {
      // A space never belongs to an address that follows its text.
      if (free(index) && index >= from - 1 && index <= to && char!.link)
        wanted.set(index, null)
      index++
      continue
    }
    let end = index + 1
    while (
      end < chars.length &&
      free(end) &&
      !/\s/.test(chars[end]!.text) &&
      sameMarks(chars[end]!.marks, char!.marks)
    )
      end++
    if (end >= from && index <= to) spans.push([index, end])
    index = end
  }
  const found = literals(
    ctx,
    spans.map(([start, end]) =>
      chars
        .slice(start, end)
        .map((char) => char!.text)
        .join(''),
    ),
  )
  spans.forEach(([start, end], index) => {
    const links = found[index]
    if (!links) return
    for (let at = start; at < end; at++) wanted.set(at, null)
    for (const [linkStart, linkEnd, href] of links)
      for (let at = start + linkStart; at < start + linkEnd; at++)
        wanted.set(at, { href, form: 'literal' })
  })
  return wanted
}

const differs = (
  chars: Array<Character | undefined>,
  wanted: Map<number, Wanted | null>,
) =>
  [...wanted].some(([at, want]) => {
    const char = chars[at]!
    return want
      ? char.link?.attrs.href !== want.href || char.form !== want.form
      : char.link !== undefined
  })

interface Block {
  pos: number
  chars: Array<Character | undefined>
  wanted: Map<number, Wanted | null>
}

// Sets the wanted links: one step per run of characters that changes, or,
// where a block has many, one step that writes the block again, since each
// mark step rebuilds the whole block.
function linked(tr: Transaction, blocks: Block[]): Transaction {
  const type = tr.doc.type.schema.marks.link!
  const create = (want: Wanted) =>
    type.create({ href: want.href, form: want.form })
  for (const { pos, chars, wanted } of blocks) {
    const changes = [...wanted]
      .filter(([at, want]) => differs(chars, new Map([[at, want]])))
      .sort((a, b) => a[0] - b[0])
    const runs: Array<{ from: number; to: number; want: Wanted | null }> = []
    for (const [at, want] of changes) {
      const run = runs.at(-1)
      const char = chars[at]!
      if (
        run &&
        run.to === char.pos &&
        run.want?.href === want?.href &&
        run.want?.form === want?.form
      )
        run.to = char.pos + 1
      else runs.push({ from: char.pos, to: char.pos + 1, want })
    }
    if (runs.length <= 32) {
      for (const { from, to, want } of runs)
        if (want) tr.addMark(from, to, create(want))
        else tr.removeMark(from, to, type)
      continue
    }
    const block = tr.doc.nodeAt(pos)!
    const nodes: ProseNode[] = []
    let index = 0
    block.forEach((child) => {
      if (!child.isText) {
        nodes.push(child)
        index++
        return
      }
      const base = child.marks.filter((mark) => mark.type !== type)
      let text = ''
      let marks: readonly Mark[] | undefined
      for (const character of child.text!) {
        const want = wanted.get(index)
        const link =
          want === undefined
            ? child.marks.find((mark) => mark.type === type)
            : want && create(want)
        const next = link ? link.addToSet(base) : base
        if (marks && !Mark.sameSet(marks, next)) {
          nodes.push(tr.doc.type.schema.text(text, marks))
          text = ''
        }
        marks = next
        text += character
        index++
      }
      if (text) nodes.push(tr.doc.type.schema.text(text, marks))
    })
    const { from, to } = tr.selection
    tr.replaceWith(pos + 1, pos + 1 + block.content.size, nodes)
    if (from > pos && to <= pos + block.nodeSize)
      tr.setSelection(TextSelection.create(tr.doc, from, to))
  }
  return tr
}

// Whether a text block reads back with the same content once written, as
// the preservation check compares it.
function readsBack(ctx: Ctx, tr: Transaction, pos: number): boolean {
  const block = tr.doc.nodeAt(pos)!
  const doc = tr.doc.type.create(null, [
    tr.doc.type.schema.nodes.paragraph!.create(null, block.content),
  ])
  const reopened = ctx.get(parserCtx)(serialize(ctx, doc))
  return semanticSignature(reopened) === semanticSignature(doc)
}

interface Edited {
  pos: number
  block: ProseNode
  // The edited range, as positions in the new document.
  from: number
  to: number
}

const textblocks = (doc: ProseNode, from: number, to: number) => {
  const found: Array<{ pos: number; node: ProseNode }> = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (!node.type.spec.code) found.push({ pos, node })
    return false
  })
  return found
}

// The text blocks whose content an update changed, with the range changed in
// each. A block whose attributes alone changed, such as a heading given its
// id, is not edited.
function editedBlocks(before: ProseNode, after: ProseNode): Edited[] {
  const start = before.content.findDiffStart(after.content)
  if (start == null) return []
  let { a: endA, b: endB } = before.content.findDiffEnd(after.content)!
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  const old = textblocks(before, start, endA)
  const now = textblocks(after, start, endB)
  let prefix = 0
  while (
    prefix < old.length &&
    prefix < now.length &&
    old[prefix]!.node.content.eq(now[prefix]!.node.content)
  )
    prefix++
  let suffix = 0
  while (
    suffix < old.length - prefix &&
    suffix < now.length - prefix &&
    old[old.length - 1 - suffix]!.node.content.eq(
      now[now.length - 1 - suffix]!.node.content,
    )
  )
    suffix++
  const paired = old.length === now.length
  return now.slice(prefix, now.length - suffix).map(({ pos, node }, index) => {
    const previous = paired ? old[prefix + index]!.node : undefined
    const from = previous?.content.findDiffStart(node.content)
    if (!previous || from == null)
      return { pos, block: node, from: pos + 1, to: pos + node.nodeSize - 1 }
    let { a: endOld, b: endNew } = previous.content.findDiffEnd(node.content)!
    const shared = from - Math.min(endOld, endNew)
    if (shared > 0) endNew += shared
    return { pos, block: node, from: pos + 1 + from, to: pos + 1 + endNew }
  })
}

// Bare addresses follow their text, as GFM reads it: an edited address links
// to its new text while it is still an address, text that stops being one is
// plain, and an address typed into plain text becomes a link. An address in
// angle brackets follows its text the same way. Links written with brackets
// keep their destination. Only text an edit reaches is read, so loading a
// document and edits elsewhere change nothing. Each change is checked by
// writing the block and reading it back; if that does not give the same
// block, nothing changes.
export const autolinkLiterals = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('autolinkLiterals'),
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const blocks: Block[] = []
        for (const { pos, block, from, to } of editedBlocks(
          oldState.doc,
          newState.doc,
        )) {
          const chars = characters(block, pos + 1)
          const index = (at: number) => {
            const found = chars.findIndex(
              (char) => char !== undefined && char.pos >= at,
            )
            return found < 0 ? chars.length : found
          }
          const wanted = wantedLinks(ctx, chars, index(from), index(to))
          if (differs(chars, wanted)) blocks.push({ pos, chars, wanted })
        }
        if (!blocks.length) return null
        let tr = linked(newState.tr, blocks)
        const failed = blocks.filter((block) => !readsBack(ctx, tr, block.pos))
        if (!failed.length) return tr
        // Where the address cannot be written to read back as a link, its
        // text stays plain.
        for (const block of failed)
          for (const [at, want] of block.wanted)
            if (want?.form === 'literal') block.wanted.set(at, null)
        tr = linked(newState.tr, blocks)
        const kept = blocks.filter((block) => readsBack(ctx, tr, block.pos))
        if (kept.length === blocks.length) return tr
        return kept.length ? linked(newState.tr, kept) : null
      },
    }),
)
