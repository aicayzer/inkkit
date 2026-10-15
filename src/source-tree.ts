import type { Nodes, Root } from 'mdast'

/**
 * Moves the start of each block that begins inside the block before it to
 * the start of its own first line, after any container markers.
 *
 * micromark starts a setext heading where the paragraph it was read from
 * started, which is before any link reference definitions that paragraph
 * opened with, so the heading's range would include them. That start is in
 * the column the paragraph's lines start in, so the heading's first line
 * starts there too, unless it is a lazy line that starts further left.
 */
export function ownStarts(tree: Root): undefined {
  const visit = (node: Nodes) => {
    if (!('children' in node)) return
    let previousEnd: number | undefined
    for (const child of node.children) {
      const start = child.position?.start
      const own =
        'children' in child ? child.children[0]?.position?.start : undefined
      if (
        start?.offset != null &&
        previousEnd != null &&
        start.offset < previousEnd &&
        own?.offset != null &&
        own.offset >= previousEnd
      ) {
        // micromark counts a tab as one column, so on one line columns and
        // offsets move together.
        const column = Math.min(start.column, own.column)
        child.position!.start = {
          line: own.line,
          column,
          offset: own.offset - (own.column - column),
        }
      }
      visit(child)
      previousEnd = child.position?.end.offset ?? previousEnd
    }
  }
  visit(tree)
  return undefined
}
