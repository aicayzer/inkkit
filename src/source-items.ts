import { listItemsOf, type ListItems } from './source-typing'

/** A top-level block of a parse: where it ends and the list items inside it, as offsets. */
interface Block {
  type: string
  start: number
  end: number
  items: number[]
}

// A parse may start after these. Others leave the parser in a state that a blank line does not
// end: indented code goes on across blank lines, and a bare list marker after it is read as text.
const restarts = new Set(['paragraph', 'heading', 'thematicBreak'])

interface Root {
  children: Array<{
    type: string
    position?: { start: { offset?: number }; end: { offset?: number } }
  }>
}

function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let at = 0
  while (at < limit && a.charCodeAt(at) === b.charCodeAt(at)) at++
  return at
}

/** The end of the line that holds offset `at`, or the end of the text. */
function lineEndFrom(text: string, at: number): number {
  const next = text.indexOf('\n', at)
  return next < 0 ? text.length : next
}

// How far past the caret line the first parse reaches, in characters, and the least it grows by.
const lookahead = 400

/**
 * Where the Markdown parser puts list items in text that is being edited, found without parsing
 * the whole text each time.
 *
 * What a parser makes of a block depends on the lines before it and on the lines that continue
 * it, such as the rest of a link reference definition, an item, or a fenced block. It does not
 * depend on what follows once another top-level block has begun. So a parse of the text up to a
 * block that starts after the caret's line reads the blocks before that one as a parse of the
 * whole text does, whatever follows. The index parses from a safe start to the end of the text
 * that holds the caret's block, and as far as the start of the next block, and widens the range
 * until a block starts after the caret's line, or the text ends. The answer does not depend on
 * which lines were asked about before.
 *
 * The safe start is the end of a block kept from the last parse, so a Return after the first costs
 * the blocks that changed since. A kept block is one that a later block followed in that parse, and
 * that an edit cannot have reached: a paragraph, heading or thematic break, a blank line and a line
 * with content after it, all before the first changed line. Text with a `%%` comment before the
 * end of the range is parsed whole, because the comment syntax runs across blocks.
 *
 * The cost of one call is the text from the safe start to the start of the block after the caret's
 * block. In the worst case that is the whole text from the first line: the first call after the
 * text is loaded, text with a `%%` comment before the caret, and a caret in a block that runs to
 * the end of the text, such as an unclosed code fence.
 */
export class ListItemIndex {
  private text = ''
  private blocks: Block[] = []

  constructor(private readonly parse: (text: string) => unknown) {}

  /** Forgets the last parse. */
  reset(): void {
    this.text = ''
    this.blocks = []
  }

  /** The list items in `text`, complete up to the end of the line that ends at `lineEnd`. */
  through(text: string, lineEnd: number, bom: number): ListItems {
    // A `%%` comment runs across blocks and may close after the range, so text with one before
    // the end of the range is read whole.
    const comment = text.indexOf('%%')
    const whole = () => {
      this.reset()
      return listItemsOf(this.parse(text), bom)
    }
    const common = commonPrefix(this.text, text)
    // The start of the first line that differs from the last parse.
    const changed = common === 0 ? 0 : text.lastIndexOf('\n', common - 1) + 1
    // A block is kept when it is followed by a blank line, so that the parse can start there and
    // what precedes it, such as a paragraph or code that a line right after could continue, does
    // not matter, and when the edit is after the first line with content that follows it.
    const settled = (block: Block) => {
      if (!restarts.has(block.type)) return false
      const end = block.end
      // A list or code block ends only at the first line with content after it, so that line must
      // lie before the change as well.
      let line = end + 1
      let blank = false
      while (line <= text.length) {
        const next = text.indexOf('\n', line)
        const stop = next < 0 ? text.length : next
        if (!/^[ \t]*$/.test(text.slice(line, stop)))
          return blank && line < changed
        blank = true
        if (next < 0) return false
        line = next + 1
      }
      return false
    }
    let keep = this.blocks.length
    while (keep > 0 && !settled(this.blocks[keep - 1]!)) keep--
    const kept = this.blocks.slice(0, keep)
    const start = keep > 0 ? kept[keep - 1]!.end + 1 : 0
    const items = new Set<number>()
    const add = (block: Block) => {
      // Only what the caller asked about, so that the answer is the same after any earlier call.
      if (block.start <= lineEnd)
        for (const item of block.items) if (item <= lineEnd) items.add(item)
    }
    for (const block of kept) add(block)
    // The kept blocks reach past the line, so the caret's block is among them.
    if (kept.at(-1) && kept.at(-1)!.end >= lineEnd) {
      this.text = text
      this.blocks = kept
      return items
    }
    let reach = lineEndFrom(text, lineEnd + 1 + lookahead)
    for (;;) {
      if (comment >= 0 && comment < reach) return whole()
      const tree = this.parse(text.slice(start, reach)) as Root
      // Positions in the first parse leave out a byte order mark.
      const shift = start + (start === 0 ? bom : 0)
      const parsed: Block[] = tree.children.map((child) => {
        const only = listItemsOf({ type: 'root', children: [child] }, shift)
        return {
          type: child.type,
          start: (child.position?.start.offset ?? 0) + shift,
          end: (child.position?.end.offset ?? 0) + shift,
          items: [...only],
        }
      })
      // A block that starts after the caret's line shows that the ones before it are complete. The
      // last block of a range that stops short may be cut off, and may read differently with the
      // lines that follow it, so it is not kept.
      if (
        reach >= text.length ||
        parsed.some((block) => block.start > lineEnd)
      ) {
        for (const block of parsed) add(block)
        this.text = text
        this.blocks = [...kept, ...parsed.slice(0, -1)]
        return items
      }
      reach = lineEndFrom(text, reach + Math.max(lookahead, reach - start))
    }
  }
}
