import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  Fragment,
  Slice,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import { Preservation } from './preserve'
import {
  sourceAttribute,
  cleanSourceDoc,
  type SourceProvenance,
} from './source'
import { assertCommentsEndWhereWritten } from './comments'
import { coded } from './errors'

interface DocumentRuntime {
  ctx(): Ctx
  literal(): boolean
  pending(): string | undefined
}

/** Source provenance and successful save caches for the loaded document. */
export class EditorDocument {
  format: 'md' | 'txt' = 'md'
  original = ''
  private sourcePreservations = new WeakMap<SourceProvenance, Preservation>()
  private sourceTexts = new WeakMap<ProseNode, string>()
  private preservation?: Preservation
  // Moved blocks retain their authored source for this loaded document.
  private carried?: WeakSet<ProseNode>

  constructor(private readonly runtime: DocumentRuntime) {}

  resetCaches(): void {
    this.sourcePreservations = new WeakMap()
    this.sourceTexts = new WeakMap()
  }

  loaded(preservation: Preservation): void {
    this.preservation = preservation
    this.carried = undefined
  }

  carry(nodes: readonly ProseNode[]): void {
    for (const node of nodes) (this.carried ??= new WeakSet()).add(node)
  }

  remember(doc: ProseNode, text: string): void {
    this.sourceTexts.set(doc, text)
  }

  parseSource(text: string, provenance: SourceProvenance): ProseNode {
    const view = this.runtime.ctx().get(editorViewCtx)
    try {
      if (this.format === 'txt')
        return view.state.schema.topNodeType.create(
          null,
          view.state.schema.nodes.paragraph!.create(
            null,
            text ? view.state.schema.text(text) : undefined,
          ),
        )
      const preservation = Preservation.read(this.runtime.ctx(), text)
      this.sourcePreservations.set(provenance, preservation)
      return preservation.baseline
    } catch (error) {
      throw coded(error, 'preservation')
    }
  }

  currentText(doc?: ProseNode): string {
    const pending = this.runtime.pending()
    if (!doc && pending !== undefined) return pending
    doc ??= this.runtime.ctx().get(editorViewCtx).state.doc
    const cached = this.sourceTexts.get(doc)
    if (cached !== undefined) return cached
    const provenance = doc.attrs[sourceAttribute] as SourceProvenance | null
    if (this.format === 'txt') return provenance?.text ?? this.original
    let text: string
    try {
      let preservation = this.preservation
      if (provenance) {
        preservation = this.sourcePreservations.get(provenance)
        if (!preservation) {
          preservation = Preservation.read(this.runtime.ctx(), provenance.text)
          this.sourcePreservations.set(provenance, preservation)
        }
      }
      text = preservation!.serialize(cleanSourceDoc(doc), this.carried)
    } catch (error) {
      throw coded(error, 'preservation')
    }
    this.sourceTexts.set(doc, text)
    return text
  }

  /**
   * The document to export. Source typed in the source editor has not reached
   * the formatted document, which would merge its undo steps, so a document
   * read from the text stands in without touching history.
   */
  exportDocument(text: string): ProseNode {
    const { doc } = this.runtime.ctx().get(editorViewCtx).state
    return this.runtime.pending() !== undefined && this.format === 'md'
      ? this.runtime.ctx().get(parserCtx)(text)
      : doc
  }

  /** Whether two documents are the same note. A move of blocks that read alike, such as a setext
   *  heading and the same heading written with `#`, gives an equal document with other source. */
  sameDocument(after: ProseNode, before: ProseNode): boolean {
    if (after === before) return true
    if (!after.eq(before)) return false
    if (!this.carried || !this.preservation) return true
    try {
      return this.currentText(after) === this.currentText(before)
    } catch {
      return false
    }
  }

  /** Throws when a document reached by an edit, after every appended normalisation, cannot be
   *  saved as preserved Markdown. Dispatch and the replacement commands share this check.
   *  `written` is false for history steps and source replacement, which restore or supply a
   *  document that may hold comment text the formatted editor would refuse to accept typed. */
  assertPreserved(before: ProseNode, after: ProseNode, written = true): void {
    if (this.runtime.literal() || this.sameDocument(after, before)) return
    if (written) assertCommentsEndWhereWritten(before, after)
    if (this.preservation) this.currentText(after)
  }

  /**
   * The authored Markdown of the textblocks at `positions`, found by saving
   * the document once with each block's content replaced by a numbered mark
   * no one writes. The saved text between the marks is the current text
   * between those blocks, so what lies between the same pieces of the current
   * text is each block's source.
   */
  authoredSources(
    doc: ProseNode,
    positions: readonly number[],
  ): Map<number, string> {
    const none = new Map<number, string>()
    if (this.runtime.literal() || !positions.length) return none
    try {
      let marked = doc
      // Positions are in document order, so marking the last first leaves
      // the earlier ones where they are.
      for (let index = positions.length - 1; index >= 0; index--) {
        const pos = positions[index]!
        const node = doc.nodeAt(pos)
        if (!node?.isTextblock) return none
        marked = marked.replace(
          pos + 1,
          pos + node.nodeSize - 1,
          new Slice(
            Fragment.from(doc.type.schema.text(`\uE000${index}\uE001`)),
            0,
            0,
          ),
        )
      }
      const text = this.currentText(doc)
      const pieces = this.currentText(marked).split(/\uE000(\d+)\uE001/)
      // Pieces alternate between saved text and a mark's number.
      if (pieces.length !== positions.length * 2 + 1) return none
      for (let index = 0; index < positions.length; index++)
        if (pieces[index * 2 + 1] !== String(index)) return none
      const first = pieces[0]!
      const last = pieces.at(-1)!
      if (!text.startsWith(first) || !text.endsWith(last)) return none
      const found = new Map<number, string>()
      let cursor = first.length
      const end = text.length - last.length
      for (let index = 0; index < positions.length; index++) {
        const lastBlock = index + 1 === positions.length
        const next = lastBlock ? '' : pieces[index * 2 + 2]!
        // Saved text always separates two blocks.
        if (!lastBlock && !next) return none
        const at = lastBlock ? end : text.indexOf(next, cursor)
        if (at < 0 || at > end) return none
        found.set(positions[index]!, text.slice(cursor, at))
        cursor = at + next.length
      }
      return cursor === end ? found : none
    } catch {
      return none
    }
  }
}
