import { withoutLeadingBOM } from './bom'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { finalCodeEnding } from './code-fences'
import { sourceFrontmatter } from './literals'
import { type Carried, type Run } from './preserve-types'
import { type LoadedSource } from './preserve-source'
import { type DefinitionContext } from './preserve-context'
import { type MoveOrigins } from './preserve-moves'
import { type Reconstruction } from './preserve-reconstruction'

// A cached region includes the neighbouring nodes and their original positions.
export class RegionEdits {
  private readonly regionEdits = new WeakMap<
    ProseNode,
    { identity: string; nodes: ProseNode[]; text: string }
  >()

  constructor(
    private readonly loaded: Pick<
      LoadedSource,
      | 'baseline'
      | 'blocks'
      | 'definitionSources'
      | 'formOf'
      | 'lineEnding'
      | 'source'
    >,
    private readonly context: Pick<DefinitionContext, 'readsAs'>,
    private readonly movement: Pick<MoveOrigins, 'pairing'>,
    private readonly reconstruction: Pick<
      Reconstruction,
      'endsAsAuthored' | 'gap' | 'readAlone' | 'runPieces' | 'runs'
    >,
  ) {}

  // Saves an edit that inserts, removes, splits or joins blocks by validating
  // only what changed. Blocks are paired with their originals as the
  // whole-document path pairs them, and each run of changed blocks between
  // unchanged ones is written by the same code. Each run is then read back
  // with the unchanged block on either side, which shows that nothing in it
  // changes how those blocks, or the blocks beyond them, read. Returns
  // undefined whenever that cannot be shown, and the whole-document path
  // decides.
  regions(doc: ProseNode): string | undefined {
    const count = doc.childCount
    if (
      !count ||
      this.loaded.baseline.childCount !== this.loaded.blocks.length ||
      !doc.sameMarkup(this.loaded.baseline) ||
      // `readAlone` would refuse this after pairing; checking first skips it.
      this.loaded.definitionSources === undefined
    )
      return undefined
    const current: string[] = []
    doc.forEach((node) => current.push(this.loaded.formOf(node)))
    let positions: Array<number | undefined>
    let carried: Carried
    try {
      ;({ positions, carried } = this.movement.pairing(doc, current))
    } catch {
      return undefined
    }
    const runs = this.reconstruction.runs(positions, current, carried.within)
    if (
      // With nothing left as it was, the whole document is one run.
      runs.some(
        (run) => run.previous === undefined && run.next === undefined,
      ) ||
      !this.reconstruction.readAlone(doc, positions, runs)
    )
      return undefined
    let output = ''
    let at = 0
    for (const run of runs) {
      const from =
        run.previous === undefined
          ? 0
          : this.loaded.blocks[positions[run.previous]!]!.end
      const to =
        run.next === undefined
          ? this.loaded.source.length
          : this.loaded.blocks[positions[run.next]!]!.start
      const text = this.region(doc, positions, current, carried, run)
      if (text === undefined) return undefined
      output += this.loaded.source.slice(at, from) + text
      at = to
    }
    output += this.loaded.source.slice(at)
    // Front matter runs from the start of the file to the next delimiter
    // line, which a changed block can supply, and a rule that opens the file
    // would then be rewritten.
    const frontmatter = sourceFrontmatter(withoutLeadingBOM(output))
    if (
      frontmatter !==
        sourceFrontmatter(withoutLeadingBOM(this.loaded.source)) ||
      (doc.firstChild?.type.name === 'hr' && frontmatter?.startsWith('---'))
    )
      return undefined
    return output
  }

  // The text that replaces the source between the unchanged blocks around a
  // run, or undefined when the run cannot be validated on its own.
  private region(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
    carried: Carried,
    run: Run,
  ): string | undefined {
    const from = run.previous === undefined ? 0 : run.previous + 1
    const to = run.next ?? doc.childCount
    const nodes: ProseNode[] = []
    for (let index = from; index < to; index++) nodes.push(doc.child(index))
    const neighbours = [run.previous, run.next].flatMap((index) =>
      index === undefined ? [] : [doc.child(index)],
    )
    const key = nodes[0] ?? neighbours[0]!
    const original = (index: number | undefined) =>
      index === undefined ? -1 : positions[index]!
    const identity = [
      original(run.previous),
      original(run.next),
      // Unpaired positions are holes, which `slice` keeps as holes.
      ...Array.from(
        { length: to - from },
        (_, at) =>
          positions[from + at] ?? `m${carried.moved.get(from + at) ?? ''}`,
      ),
    ].join()
    const cached = this.regionEdits.get(key)
    if (
      cached &&
      cached.identity === identity &&
      cached.nodes.length === nodes.length + neighbours.length &&
      [...nodes, ...neighbours].every(
        (node, index) => cached.nodes[index] === node,
      )
    )
      return cached.text
    // Two lists of one kind side by side need markers chosen across both.
    const list = (index: number) => {
      const name = doc.maybeChild(index)?.type.name
      return name === 'bullet_list' || name === 'ordered_list'
        ? name
        : undefined
    }
    for (
      let index = Math.max(1, from);
      index <= Math.min(to, doc.childCount - 1);
      index++
    )
      if (list(index) && list(index) === list(index - 1)) return undefined
    const { gaps, pieces } = this.reconstruction.runPieces(
      doc,
      positions,
      current,
      carried,
      run,
    )
    let text = pieces.map((piece, index) => gaps[index] + piece).join('')
    if (run.next !== undefined)
      text += this.reconstruction.gap(run.next, positions)
    else
      text += this.reconstruction.endsAsAuthored(positions, carried)
        ? this.loaded.source.slice(this.loaded.blocks.at(-1)!.end)
        : (finalCodeEnding(doc) ?? this.loaded.lineEnding)
    const slice = (index: number | undefined) => {
      if (index === undefined) return ''
      const block = this.loaded.blocks[positions[index]!]!
      return this.loaded.source.slice(block.start, block.end)
    }
    const read = [
      ...(run.previous === undefined ? [] : [doc.child(run.previous)]),
      ...nodes,
      ...(run.next === undefined ? [] : [doc.child(run.next)]),
    ]
    if (
      !this.context.readsAs(slice(run.previous) + text + slice(run.next), read)
    )
      return undefined
    this.regionEdits.set(key, {
      identity,
      nodes: [...nodes, ...neighbours],
      text,
    })
    return text
  }
}
