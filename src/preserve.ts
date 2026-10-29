import { tracePreservation } from './diagnostics'
import { leadingBOMLength } from './bom'
import { remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { nothingCarried } from './preserve-types'
import { correspondence } from './preserve-alignment'
import {
  PreservationError,
  PreservationRefusal,
  isPreservationRefusal,
} from './preserve-error'
import { preservationWork, parseDoc, write, crossCheck } from './preserve-parse'
import { semanticSignature } from './preserve-shape'
import { LoadedSource } from './preserve-source'
import { DefinitionContext } from './preserve-context'
import { LocalEdits } from './preserve-local'
import { MoveOrigins } from './preserve-moves'
import { Reconstruction } from './preserve-reconstruction'
import { RegionEdits } from './preserve-regions'
export { decodedOffsets } from './preserve-inline'
export { correspondence } from './preserve-alignment'
export { crossCheck, preservationWork } from './preserve-parse'
export { PreservationError } from './preserve-error'
export { semanticSignature } from './preserve-shape'

/** Retains the loaded source of blocks the edit leaves alone. */
export class Preservation {
  private static readonly recent = new WeakMap<Ctx, Preservation>()
  private readonly loaded: LoadedSource
  private readonly context: DefinitionContext
  private readonly local: LocalEdits
  private readonly movement: MoveOrigins
  private readonly reconstruction: Reconstruction
  private readonly regionWriter: RegionEdits
  /** The document as loaded from `source`. */
  readonly baseline: ProseNode
  readonly sourceTree: Root

  constructor(
    private readonly ctx: Ctx,
    private readonly source: string,
    previous?: Preservation,
  ) {
    this.loaded = new LoadedSource(ctx, source, previous?.loaded)
    this.baseline = this.loaded.baseline
    this.sourceTree = this.loaded.sourceTree
    this.context = new DefinitionContext(
      ctx,
      this.loaded.lineEnding,
      this.loaded.definitionSources,
    )
    this.movement = new MoveOrigins(
      this.baseline,
      this.loaded.blocks,
      this.loaded.blockForms,
    )
    this.local = new LocalEdits(ctx, this.loaded, this.context, this.movement)
    this.reconstruction = new Reconstruction(
      ctx,
      this.loaded,
      this.context,
      this.movement,
    )
    this.regionWriter = new RegionEdits(
      this.loaded,
      this.context,
      this.movement,
      this.reconstruction,
    )
  }

  private localEdits(doc: ProseNode): string | undefined {
    return this.local.localEdits(doc)
  }

  private regions(doc: ProseNode): string | undefined {
    return this.regionWriter.regions(doc)
  }

  static read(ctx: Ctx, source: string): Preservation {
    const cached = this.recent.get(ctx)
    const previous =
      cached?.loaded.processor === ctx.get(remarkCtx) ? cached : undefined
    if (previous?.source === source) return previous
    const next = new Preservation(ctx, source, previous)
    this.recent.set(ctx, next)
    return next
  }

  /** `moved` holds the nodes block moves carried. A moved node that is still a
   *  node of the loaded document keeps that node's source where it reads the
   *  same; every other edit is saved without it. */
  serialize(doc: ProseNode, moved?: WeakSet<ProseNode>): string {
    this.movement.current = moved
    try {
      return this.serializeWith(doc)
    } catch (cause) {
      tracePreservation(this.ctx, {
        kind: 'preservation',
        phase: 'refused',
        code: 'preservation',
        reason:
          cause instanceof PreservationRefusal ? cause.reason : 'unexpected',
      })
      if (cause instanceof PreservationError || isPreservationRefusal(cause))
        throw cause
      throw new PreservationError('Cannot preserve the edited Markdown', {
        cause,
      })
    } finally {
      this.movement.current = undefined
    }
  }

  private serializeWith(doc: ProseNode): string {
    if (this.unchanged(doc)) {
      tracePreservation(this.ctx, { kind: 'preservation', path: 'unchanged' })
      return this.source
    }
    let local = this.localEdits(doc)
    let path: 'local' | 'regions' | 'whole' = 'local'
    if (local === undefined)
      try {
        path = 'regions'
        local = this.regions(doc)
      } catch (error) {
        if (!isPreservationRefusal(error)) throw error
        // The whole-document path decides, and refuses if it fails too.
        local = undefined
      }
    tracePreservation(this.ctx, {
      kind: 'preservation',
      path: local === undefined ? 'whole' : path,
    })
    return local === undefined
      ? this.wholeDocument(doc)
      : this.checked(doc, local)
  }

  // Equal to the loaded document. The editor shows the baseline's own nodes,
  // and an edit keeps the nodes it does not reach, so most blocks are
  // compared by identity rather than by content.
  private unchanged(doc: ProseNode): boolean {
    if (doc === this.baseline) return true
    if (
      doc.childCount !== this.baseline.childCount ||
      !doc.sameMarkup(this.baseline)
    )
      return false
    for (let index = 0; index < doc.childCount; index++) {
      const node = doc.child(index)
      const before = this.baseline.child(index)
      if (node !== before && (!node.eq(before) || this.movement.carries(node)))
        return false
    }
    return true
  }

  // In cross-check mode, records where the whole-document path would save
  // different bytes or refuse.
  private checked(doc: ProseNode, text: string): string {
    if (!crossCheck.enabled) return text
    crossCheck.compared++
    const { characters } = preservationWork
    let whole: string
    try {
      try {
        whole = this.wholeDocument(doc)
      } catch (error) {
        if (!isPreservationRefusal(error)) throw error
        // An edit validated where it stands needs no matching, so it can save
        // when matching the whole document would run out of budget.
        whole =
          error instanceof PreservationRefusal &&
          error.reason === 'matching-budget' &&
          this.reopens(doc, text)
            ? text
            : `refused: ${error.message}`
      }
    } finally {
      preservationWork.characters = characters
    }
    if (whole !== text)
      crossCheck.differences.push(
        JSON.stringify({ source: this.source, fast: text, whole }),
      )
    return text
  }

  // Whether `output` reads back as `doc`.
  private reopens(
    doc: ProseNode,
    output: string,
    canonical = write(this.ctx, doc),
  ): boolean {
    const reopened = parseDoc(this.ctx, output)
    if (semanticSignature(reopened) !== semanticSignature(doc)) return false
    const normalized = (text: string): string => text.replace(/\r\n?/g, '\n')
    const actual = normalized(write(this.ctx, reopened))
    // Parsing may normalize loose-list spacing. Compare both reconstructed
    // source and intended canonical source after that same normalization.
    return (
      actual === normalized(canonical) ||
      actual === normalized(write(this.ctx, parseDoc(this.ctx, canonical)))
    )
  }

  private wholeDocument(doc: ProseNode): string {
    try {
      const canonical = write(this.ctx, doc)
      if (canonical === '') return leadingBOMLength(this.source) ? '\uFEFF' : ''
      const current: string[] = []
      doc.forEach((node) => current.push(this.loaded.formOf(node)))
      const pairing = this.movement.pairing(doc, current)
      const carries = pairing.carried.moved.size > 0 || pairing.carried.children
      // The document as the source and the edit leave it, or undefined when
      // it does not read back as `doc`.
      const attempt = (): string | undefined => {
        if (carries) {
          // A moved block's source can read differently where it now stands,
          // such as indented code under a list. The moved blocks are then
          // written as an edit without the move's record writes them.
          let output: string | undefined
          try {
            output = this.reconstruction.writeDocument(doc, current, pairing)
          } catch (error) {
            if (!isPreservationRefusal(error)) throw error
            output = undefined
          }
          if (output !== undefined && this.reopens(doc, output, canonical))
            return output
        }
        const output = this.reconstruction.writeDocument(
          doc,
          current,
          carries
            ? {
                positions: correspondence(this.loaded.blockForms, current),
                carried: nothingCarried,
              }
            : pairing,
        )
        return this.reopens(doc, output, canonical) ? output : undefined
      }
      // An address typed into angle brackets, or out of them, reads as the
      // same link, so the first attempt keeps its source and is refused on
      // reading back. The second attempt writes the links that edit changed
      // as the edit left them.
      const output = attempt() ?? this.reconstruction.withLinkEdits(attempt)
      if (output !== undefined) return output
      throw new PreservationRefusal(
        'reopen-mismatch',
        'The edited Markdown cannot be reopened without changing its content',
      )
    } catch (cause) {
      if (cause instanceof PreservationError || isPreservationRefusal(cause))
        throw cause
      throw new PreservationError('Cannot preserve the edited Markdown', {
        cause,
      })
    }
  }
}
