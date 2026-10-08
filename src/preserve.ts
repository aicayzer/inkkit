import { parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { serialize } from './dialect'

interface Block {
  start: number
  end: number
  form: string
}

export class PreservationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PreservationError'
  }
}

function form(text: string): string {
  return text.replace(/\n+$/, '')
}

function blockForm(ctx: Ctx, node: ProseNode): string {
  // An empty document is empty Markdown, but an empty block inside a document
  // is authored spacing and must remain a real block when read again.
  if (node.type.name === 'paragraph' && node.content.size === 0) return '<br />'
  return form(serialize(ctx, node.type.schema.topNodeType.create(null, [node])))
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
      const tree = processor.runSync(processor.parse(source), {
        value: body,
      }) as Root
      for (const node of tree.children) {
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
        const parsed = parse(text)
        this.blocks.push({
          start,
          end: sourceEnd,
          form:
            parsed.childCount === 1
              ? blockForm(ctx, parsed.firstChild!)
              : form(serialize(ctx, parsed)),
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
        output +=
          block && block.form === text
            ? this.source.slice(block.start, block.end)
            : text.replaceAll('\n', this.lineEnding)
        previous = position
      })
      if (previous === this.blocks.length - 1 && this.blocks.length)
        output += this.source.slice(this.blocks[previous]!.end)
      else if (output) output += this.lineEnding
      const parse = this.ctx.get(parserCtx)
      if (serialize(this.ctx, parse(output)) === canonical) return output
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
