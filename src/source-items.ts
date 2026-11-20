import { listItemsOf, type ListItems } from './source-typing'

/** A top-level block of a parse: where it ends and the list items inside it, as offsets. */
interface Block {
  type: string
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

/**
 * Where the Markdown parser puts list items in text that is being edited, found without parsing
 * the whole text each time.
 *
 * A parser reads blocks in order, so what it makes of a line depends only on the lines before it,
 * and a top-level block that ended before the first changed line is the same in the new text. The
 * index keeps the top-level blocks of the last parse and parses again only from the end of the
 * last one that the edit cannot have reached, as far as the line asked about. A Return in a long
 * list so costs the list, and a Return in a long note after the first costs the blocks that
 * changed since. Text with a `%%` comment is parsed whole. The line after the one asked about is parsed too, because an item is empty, or
 * opens with code, by what follows its marker.
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
    // One line more than asked about, since the item on a line is empty or not by the line after it.
    const after = text.indexOf('\n', lineEnd + 1)
    const reach = after < 0 ? text.length : after
    // A `%%` comment runs across blocks and may close after the line, so text with one before
    // the end of the lines asked about is read whole.
    const comment = text.indexOf('%%')
    if (comment >= 0 && comment < reach) {
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
    for (const block of kept) for (const item of block.items) items.add(item)
    if (start > lineEnd) {
      this.text = text
      this.blocks = kept
      return items
    }
    const tree = this.parse(text.slice(start, reach)) as Root
    // Positions in the first parse leave out a byte order mark.
    const shift = start + (start === 0 ? bom : 0)
    const parsed: Block[] = tree.children.map((child) => {
      const only = listItemsOf({ type: 'root', children: [child] }, shift)
      return {
        type: child.type,
        end: (child.position?.end.offset ?? 0) + shift,
        items: [...only],
      }
    })
    for (const block of parsed) for (const item of block.items) items.add(item)
    // The last line may have been read as the end of the block before it, or the start of its own,
    // only for want of a line after it, so the last two blocks are not kept.
    this.text = text
    this.blocks = [...kept, ...parsed.slice(0, -2)]
    return items
  }
}
