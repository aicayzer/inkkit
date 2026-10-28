import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  type Block,
  type SourceNode,
  type Reorder,
  nothingCarried,
  type Pairing,
} from './preserve-types'
import { correspondence } from './preserve-alignment'
import { parentKey } from './preserve-list'

// Origin lookup belongs to the loaded baseline; only the move record changes per save.
export class MoveOrigins {
  // The move record is scoped to one save; origins stay cached for this baseline.
  current?: WeakSet<ProseNode>
  private origins?: WeakMap<ProseNode, number[]>

  constructor(
    private readonly baseline: ProseNode,
    private readonly blocks: readonly Block[],
    private readonly blockForms: string[],
  ) {}

  // Whether a move carried `node` or a block inside it, so that a node equal
  // to its original can still be written differently.
  carries(node: ProseNode): boolean {
    const moves = this.current
    if (!moves) return false
    let found = moves.has(node)
    node.descendants((child) => {
      found ||= moves.has(child)
      return !found && !child.isTextblock
    })
    return found
  }

  // Where each baseline block sits in the baseline, by node: its index among
  // the top-level blocks, then among the children of each block above it.
  private originIndex(): WeakMap<ProseNode, number[]> {
    if (this.origins) return this.origins
    const origins = new WeakMap<ProseNode, number[]>()
    const visit = (node: ProseNode, path: number[]) =>
      node.forEach((child, _, index) => {
        const at = [...path, index]
        origins.set(child, at)
        if (!child.isTextblock && !child.isLeaf && child.type.name !== 'table')
          visit(child, at)
      })
    visit(this.baseline, [])
    return (this.origins = origins)
  }

  // Pairs the current blocks with the originals. Without block moves, this is
  // `correspondence`. A top-level block a move carried, that is still a node
  // of the baseline, is paired with its own original before the others are
  // matched, so a copy of its text elsewhere can't take its source or give it
  // another's. Back beside a neighbor it had in the source, it is paired in
  // place, as if it had not moved; otherwise it keeps its source as a moved
  // block.
  pairing(doc: ProseNode, current: string[]): Pairing {
    const moves = this.current
    if (!moves || this.baseline.childCount !== this.blocks.length)
      return {
        positions: correspondence(this.blockForms, current),
        carried: nothingCarried,
      }
    const origins = this.originIndex()
    const pinned = new Map<number, number>()
    doc.forEach((node, _, index) => {
      if (moves.has(node)) {
        const origin = origins.get(node)
        if (origin?.length === 1) pinned.set(index, origin[0]!)
      }
    })
    if (!pinned.size) {
      const positions = correspondence(this.blockForms, current)
      return {
        positions,
        carried: {
          moved: pinned,
          children: true,
          within: this.within(doc, positions, current),
        },
      }
    }
    const taken = new Set(pinned.values())
    const before = this.blocks.flatMap((_, index) =>
      taken.has(index) ? [] : [index],
    )
    const after = current.flatMap((_, index) =>
      pinned.has(index) ? [] : [index],
    )
    // A block that is still a node of the baseline is matched with its own
    // original, so a copy of it elsewhere can't take its place when a move
    // has left its neighbors out of order.
    const present = new Map<number, number>()
    for (const index of after) {
      const origin = origins.get(doc.child(index))
      if (origin?.length === 1) present.set(index, origin[0]!)
    }
    const kept = new Set(present.values())
    const matched = correspondence(
      before.map((index) =>
        kept.has(index)
          ? `${this.blockForms[index]!}\u0000${index}`
          : this.blockForms[index]!,
      ),
      after.map((index) =>
        present.has(index)
          ? `${current[index]!}\u0000${present.get(index)!}`
          : current[index]!,
      ),
    )
    const positions: Array<number | undefined> = new Array(current.length)
    after.forEach((index, at) => {
      const match = matched[at]
      if (match !== undefined) positions[index] = before[match]
    })
    // The paired original after each current block, so a carried block back
    // in its own place is paired there, as if it had not moved.
    const next: number[] = new Array(current.length)
    let following = this.blocks.length
    for (let index = current.length - 1; index >= 0; index--) {
      next[index] = following
      if (positions[index] !== undefined) following = positions[index]!
    }
    // The original of each block that is still a node of the baseline. A
    // carried block between two of them in their source order is in its own
    // place, as after Undo, even when blocks around it were deleted since.
    const own = (index: number) => {
      const origin = origins.get(doc.child(index))
      return origin?.length === 1 ? origin[0]! : undefined
    }
    const above: number[] = new Array(current.length)
    let upper = this.blocks.length
    for (let index = current.length - 1; index >= 0; index--) {
      above[index] = upper
      upper = own(index) ?? upper
    }
    const moved = new Map<number, number>()
    let last = -1
    let lower = -1
    for (let index = 0; index < current.length; index++) {
      const origin = pinned.get(index)
      const inOrder = origin! > lower && origin! < above[index]!
      lower = own(index) ?? lower
      if (origin === undefined) {
        if (positions[index] !== undefined) last = positions[index]!
      } else if (origin > last && origin < next[index]! && inOrder) {
        positions[index] = origin
        last = origin
      } else moved.set(index, origin)
    }
    return {
      positions,
      carried: {
        moved,
        children: true,
        within: this.within(doc, positions, current),
      },
    }
  }

  // The blocks that read the same as the originals they are paired with, but
  // hold children a move carried, so their source can change.
  private within(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
  ): Set<number> {
    const within = new Set<number>()
    positions.forEach((position, index) => {
      const node = doc.child(index)
      if (
        position !== undefined &&
        this.blocks[position]!.form === current[index] &&
        node !== this.baseline.child(position) &&
        this.carries(node)
      )
        within.add(index)
    })
    return within
  }

  // Where block moves carried the children of the current block `node`,
  // paired with the original at `original`: for each list, quote, callout or
  // footnote of the original, by where it starts in the source, the original
  // index of each child a move carried, by its current index.
  carriedChildren(node: ProseNode, original: number): Reorder | undefined {
    const moves = this.current
    if (!moves || this.baseline.childCount !== this.blocks.length) return
    const origins = this.originIndex()
    let reorder: Reorder | undefined
    const walk = (
      current: ProseNode,
      path: number[],
      ast: SourceNode | undefined,
    ) => {
      if (!ast?.children || ast.position?.start.offset == null) return
      current.forEach((child, _, index) => {
        let from = index
        const origin = moves.has(child) ? origins.get(child) : undefined
        if (
          origin?.length === path.length + 1 &&
          origin.every((step, at) => at === path.length || step === path[at])
        ) {
          from = origin.at(-1)!
          if (from !== index) {
            reorder ??= new Map()
            const key = parentKey(ast)
            if (!reorder.has(key)) reorder.set(key, new Map())
            reorder.get(key)!.set(index, from)
          }
        }
        if (!child.isTextblock && !child.isLeaf && child.type.name !== 'table')
          walk(child, [...path, from], ast.children![from])
      })
    }
    walk(node, [original], this.blocks[original]!.ast)
    return reorder
  }
}
