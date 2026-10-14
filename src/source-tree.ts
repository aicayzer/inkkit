interface PositionedNode {
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: PositionedNode[]
}

/**
 * Moves the start of each block that begins inside the block before it to
 * where its own text begins, and returns the tree.
 *
 * micromark starts a setext heading where the paragraph it was read from
 * started, which is before any link reference definitions that paragraph
 * opened with, so the heading's range would include them.
 */
export function ownStarts<T>(tree: T, text: string): T {
  const visit = (node: PositionedNode) => {
    let previousEnd: number | undefined
    for (const child of node.children ?? []) {
      const start = child.position?.start.offset
      if (start != null && previousEnd != null && start < previousEnd) {
        const own = child.children?.[0]?.position?.start.offset
        child.position!.start = {
          ...child.position!.start,
          offset:
            own != null && own >= previousEnd
              ? own
              : text.indexOf('\n', previousEnd) + 1 || previousEnd,
        }
      }
      visit(child)
      previousEnd = child.position?.end.offset ?? previousEnd
    }
  }
  visit(tree as PositionedNode)
  return tree
}
