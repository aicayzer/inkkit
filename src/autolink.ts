import { remarkCtx } from '@milkdown/kit/core'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { Mapping } from '@milkdown/kit/prose/transform'
import { $inputRule, $prose } from '@milkdown/kit/utils'
import type { Root } from 'mdast'

// A typed URL becomes a link once a space follows it; nothing links it otherwise.
export const autolinkInputRule = $inputRule((ctx) => {
  return new InputRule(
    /(?:^|\s)(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]])\s$/,
    (state, match, _start, end) => {
      const url = match[1]
      if (!url) return null
      const to = end
      const from = to - url.length
      const mark = linkSchema.type(ctx).create({ href: url })
      return state.tr
        .addMark(from, to, mark)
        .insertText(' ', end, end)
        .removeStoredMark(mark)
    },
  )
})

// A bare URL, www address or email address links to its own text.
const literal = (text: string, href: string): boolean =>
  href === text ||
  (href === `http://${text}` && /^www\./i.test(text)) ||
  href === `mailto:${text}`

interface Character {
  pos: number
  text: string
  link: Mark | undefined
  marks: readonly Mark[]
}

// The characters of a text block, with undefined where an inline node that is
// not text breaks the run.
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
    for (let index = 0; index < child.text!.length; index++)
      result.push({
        pos: start + offset + index,
        text: child.text![index]!,
        link,
        marks,
      })
  })
  return result
}

interface Run {
  from: number
  to: number
  href: string
  text: string
}

function linkRuns(chars: Array<Character | undefined>): Run[] {
  const runs: Run[] = []
  for (let index = 0; index < chars.length;) {
    const link = chars[index]?.link
    if (!link) {
      index++
      continue
    }
    let end = index
    while (chars[end]?.link?.eq(link)) end++
    runs.push({
      from: index,
      to: end,
      href: String(link.attrs.href),
      text: chars
        .slice(index, end)
        .map((char) => char!.text)
        .join(''),
    })
    index = end
  }
  return runs
}

// Ranges each transaction changed, in the document before and after them all.
function changedRanges(transactions: readonly Transaction[]) {
  const mapping = new Mapping(transactions.flatMap((tr) => tr.mapping.maps))
  const before: Array<[number, number]> = []
  const after: Array<[number, number]> = []
  mapping.maps.forEach((map, index) => {
    const back = mapping.slice(0, index).invert()
    const forward = mapping.slice(index + 1)
    map.forEach((oldFrom, oldTo, newFrom, newTo) => {
      before.push([back.map(oldFrom, -1), back.map(oldTo, 1)])
      after.push([forward.map(newFrom, -1), forward.map(newTo, 1)])
    })
  })
  return { before, after }
}

function textBlocks(
  doc: ProseNode,
  ranges: Array<[number, number]>,
): Array<{ block: ProseNode; start: number; from: number; to: number }> {
  const blocks: Array<{
    block: ProseNode
    start: number
    from: number
    to: number
  }> = []
  for (const [from, to] of ranges)
    doc.nodesBetween(
      Math.max(0, from - 1),
      Math.min(doc.content.size, to + 1),
      (node, pos) => {
        if (!node.isTextblock) return true
        blocks.push({ block: node, start: pos + 1, from, to })
        return false
      },
    )
  return blocks
}

// The edited text of a bare URL keeps the link it reads as when written back:
// the link follows the text while it is still a bare URL, and ends where the
// text stops being one. Otherwise the document would hold a link that its own
// Markdown cannot express.
export const autolinkLiterals = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('autolinkLiterals'),
      appendTransaction(transactions, oldState: EditorState, newState) {
        if (!transactions.some((tr) => tr.docChanged)) return null
        const { before, after } = changedRanges(transactions)
        if (!after.length) return null
        const hrefs = new Set<string>()
        for (const { block, start } of textBlocks(oldState.doc, before))
          for (const run of linkRuns(characters(block, start)))
            if (literal(run.text, run.href)) hrefs.add(run.href)
        if (!hrefs.size) return null
        const type = linkSchema.type(ctx)
        const processor = ctx.get(remarkCtx)
        const tr = newState.tr
        const seen = new Set<number>()
        for (const { block, start, from, to } of textBlocks(
          newState.doc,
          after,
        )) {
          const chars = characters(block, start)
          for (const run of linkRuns(chars)) {
            const runFrom = chars[run.from]!.pos
            const runTo = chars[run.to - 1]!.pos + 1
            if (
              seen.has(runFrom) ||
              !hrefs.has(run.href) ||
              runTo < from ||
              runFrom > to
            )
              continue
            seen.add(runFrom)
            // The text around the link that the URL could run into.
            const marks = chars[run.from]!.marks
            const joins = (char: Character | undefined) =>
              char !== undefined &&
              !char.link &&
              !/\s/.test(char.text) &&
              char.marks.length === marks.length &&
              char.marks.every((mark, index) => mark.eq(marks[index]!))
            let first = run.from
            while (first > 0 && joins(chars[first - 1])) first--
            let last = run.to
            while (last < chars.length && joins(chars[last])) last++
            const segment = chars.slice(first, last) as Character[]
            const text = segment.map((char) => char.text).join('')
            // The leading word keeps the text inside one paragraph, after a
            // space, which is where a literal may start.
            const tree = processor.parse(`x ${text}`) as Root
            const wanted: Array<string | undefined> = segment.map(
              () => undefined,
            )
            const visit = (node: Root | Root['children'][number]) => {
              if (node.type === 'link') {
                const start = (node.position?.start.offset ?? 0) - 2
                const end = (node.position?.end.offset ?? 0) - 2
                const [child, ...rest] = node.children
                if (
                  start >= 0 &&
                  !rest.length &&
                  child?.type === 'text' &&
                  child.value === text.slice(start, end)
                )
                  for (let index = start; index < end; index++)
                    wanted[index] = node.url
                return
              }
              if ('children' in node) node.children.forEach(visit)
            }
            visit(tree)
            if (
              segment.every(
                (char, index) => char.link?.attrs.href === wanted[index],
              )
            )
              continue
            const segmentFrom = segment[0]!.pos
            tr.removeMark(segmentFrom, segment.at(-1)!.pos + 1, type)
            for (let index = 0; index < segment.length;) {
              const href = wanted[index]
              let end = index + 1
              while (end < segment.length && wanted[end] === href) end++
              if (href)
                tr.addMark(
                  segment[index]!.pos,
                  segment[end - 1]!.pos + 1,
                  type.create({ href }),
                )
              index = end
            }
          }
        }
        return tr.steps.length ? tr : null
      },
    }),
)
