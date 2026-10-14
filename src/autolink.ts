import { parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  Mark,
  type Node as ProseNode,
  type Schema,
} from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { serialize } from './dialect'
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

// The links each text reads as once written, as [start, end, href] within
// it, found by writing the texts as plain paragraphs and reading them back.
// GFM links addresses in a pass after escapes are read, so escaping cannot
// keep one plain. Undefined where a text does not read back as itself.
function literals(
  ctx: Ctx,
  schema: Schema,
  texts: string[],
): Array<Array<[number, number, string]> | undefined> {
  if (!texts.length) return []
  // A leading word puts each text after a space, where an address may start,
  // and keeps it a paragraph of its own.
  const doc = schema.topNodeType.create(
    null,
    texts.map((text) =>
      schema.nodes.paragraph!.create(null, schema.text(`x ${text}`)),
    ),
  )
  const reopened = ctx.get(parserCtx)(serialize(ctx, doc))
  if (reopened.childCount !== texts.length)
    return texts.length === 1
      ? [undefined]
      : texts.flatMap((text) => literals(ctx, schema, [text]))
  return texts.map((text, index) => {
    const paragraph = reopened.child(index)
    if (
      paragraph.type.name !== 'paragraph' ||
      paragraph.textContent !== `x ${text}`
    )
      return undefined
    const found: Array<[number, number, string]> = []
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

// Where a link is wanted on each character of an edited window of a block.
// Characters inside a link written with brackets are left as they are.
function wantedLinks(
  ctx: Ctx,
  schema: Schema,
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
  // an address could be read or could end.
  const free = (index: number) => {
    const char = chars[index]
    return (
      char !== undefined &&
      (released.has(index) ||
        (char.form !== 'angle' && !(char.link && !char.form)))
    )
  }
  const spans: Array<[number, number]> = []
  for (let index = 0; index < chars.length;) {
    const char = chars[index]
    if (!free(index) || /\s/.test(char!.text)) {
      // A space never belongs to an address that follows its text.
      if (free(index) && index >= from && index <= to && char!.link)
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
    schema,
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

// Whether a text block reads back with the same links once written.
function readsBack(ctx: Ctx, tr: Transaction, pos: number): boolean {
  const block = tr.doc.nodeAt(pos)!
  const paragraph = tr.doc.type.schema.nodes.paragraph!.create(
    null,
    block.content,
  )
  const reopened = ctx.get(parserCtx)(
    serialize(ctx, tr.doc.type.create(null, [paragraph])),
  )
  const clean = (node: ProseNode) =>
    JSON.stringify(node.toJSON(), (key, value) =>
      key === 'form' ? undefined : value,
    )
  return (
    reopened.childCount === 1 &&
    clean(reopened.firstChild!) === clean(paragraph)
  )
}

// Positions where each transaction changed the document, in the final one.
function changedWindow(
  transactions: readonly Transaction[],
  before: ProseNode,
  after: ProseNode,
): [number, number] | undefined {
  if (!transactions.some((tr) => tr.docChanged)) return undefined
  const start = before.content.findDiffStart(after.content)
  if (start == null) return undefined
  const end = before.content.findDiffEnd(after.content)!.b
  return [start, Math.max(start, end)]
}

// Bare addresses follow their text, as GFM reads it: an edited address links
// to its new text while it is still an address, text that stops being one is
// plain, and an address typed into plain text becomes a link. An address in
// angle brackets follows its text the same way. Links written with brackets
// keep their destination. Each change is checked by writing the block and
// reading it back; if that does not give the same block, nothing changes.
export const autolinkLiterals = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('autolinkLiterals'),
      appendTransaction(transactions, oldState, newState) {
        const window = changedWindow(transactions, oldState.doc, newState.doc)
        if (!window) return null
        const blocks: Block[] = []
        newState.doc.nodesBetween(
          Math.max(0, window[0] - 1),
          Math.min(newState.doc.content.size, window[1] + 1),
          (block, pos) => {
            if (!block.isTextblock) return true
            if (block.type.spec.code) return false
            const chars = characters(block, pos + 1)
            const index = (at: number) => {
              const found = chars.findIndex(
                (char) => char !== undefined && char.pos >= at,
              )
              return found < 0 ? chars.length : found
            }
            const wanted = wantedLinks(
              ctx,
              newState.schema,
              chars,
              Math.max(0, index(window[0]) - 1),
              index(window[1]) + 1,
            )
            if (differs(chars, wanted)) blocks.push({ pos, chars, wanted })
            return false
          },
        )
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
