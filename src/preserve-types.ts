export interface Block {
  start: number
  end: number
  form: string
  ast: SourceNode
}

export interface SourceNode {
  type: string
  value?: string
  children?: SourceNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
  [key: string]: unknown
}

/** Where a block move carried children: by their parent, the original index
 *  of each moved child, by its current index. A parent is known by its type
 *  and where it starts in the source, since a list starts where its first
 *  item does. */
export type Reorder = Map<string, Map<number, number>>

export interface Neighbour {
  ordered: unknown
  marker: string
}

/** The prefix each line of a block repeats, as authored and as the canonical writer writes it. */
export type Gutters = readonly [authored: string, canonical: string]

export type Kept = 'unchanged' | 'moved' | 'edited' | 'canonical'

// The blocks a block move carried, for one save: the original each moved
// top-level block keeps the source of, by its index, and whether children a
// move carried inside an edited block keep theirs.
export interface Carried {
  moved: Map<number, number>
  children: boolean
  // Blocks paired with an original they read the same as, whose children a
  // move carried, so their source can still change.
  within: Set<number>
}

export const nothingCarried: Carried = {
  moved: new Map(),
  children: false,
  within: new Set(),
}

export interface Pairing {
  positions: Array<number | undefined>
  carried: Carried
}

// Changed blocks between two unchanged ones, by their index in the document.
export interface Run {
  previous?: number
  next?: number
}
