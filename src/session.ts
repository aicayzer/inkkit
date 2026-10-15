import {
  InkKitError,
  type DocumentContext,
  type DocumentVersion,
} from './types'

/** The document as it was when work started, to check when the work finishes. */
export interface SessionCapture extends DocumentVersion {
  /** Names this load, revision and editing mode; readable snapshot and heading IDs derive from it. */
  readonly key: string
  /** The same load is current, at the same revision, and the editing mode has not changed since.
   *  With `editability`, `setEditable` has not been called since either. */
  isCurrent(options?: { editability?: boolean }): boolean
  /** The same load is current, whatever has been edited since. */
  isLoaded(): boolean
}

/**
 * The loaded document's identity and counters. Each load must bring a greater `generation` than
 * the last, so a generation names exactly one load; `revision` counts content changes within it.
 * Asynchronous work captures the session when it starts and asks the capture whether it is still
 * current when it finishes, instead of comparing the counters itself.
 */
export class DocumentSession {
  private documentId = ''
  // Undefined before the first load and after the editor is destroyed.
  private loaded?: number
  private revisions = 0
  // Mode changes and editability changes since the editor was mounted.
  private modes = 0
  private editability = 0
  private operations = 0

  get generation(): number | undefined {
    return this.loaded
  }

  get revision(): number {
    return this.revisions
  }

  version(): DocumentVersion {
    return {
      documentId: this.documentId,
      generation: this.loaded ?? 0,
      revision: this.revisions,
    }
  }

  /** Throws `invalid-argument` unless `generation` is greater than the loaded one. */
  checkLoad(generation: number, name: string): void {
    if (this.loaded !== undefined && generation <= this.loaded)
      throw new InkKitError(
        'invalid-argument',
        `${name} must be greater than the loaded generation, ${this.loaded}`,
      )
  }

  load(documentId: string, generation: number): void {
    this.checkLoad(generation, 'generation')
    this.documentId = documentId
    this.loaded = generation
    this.revisions = 0
  }

  /** Counts a change to the document's content. */
  changed(): void {
    this.revisions += 1
  }

  /** The revision a failed call puts back with `restore`. */
  mark(): number {
    return this.revisions
  }

  restore(mark: number): void {
    this.revisions = mark
  }

  modeChanged(): void {
    this.modes += 1
  }

  editabilityChanged(): void {
    this.editability += 1
  }

  close(): void {
    this.loaded = undefined
  }

  /** The context an adapter call receives, with a new operation ID. */
  context(): DocumentContext {
    return {
      documentId: this.documentId,
      generation: this.loaded ?? 0,
      operationId: `${this.loaded ?? 0}:${++this.operations}`,
    }
  }

  capture(): SessionCapture {
    const { documentId, generation, revision } = this.version()
    const loaded = this.loaded
    const modes = this.modes
    const editability = this.editability
    const isLoaded = () => loaded !== undefined && loaded === this.loaded
    return Object.freeze({
      documentId,
      generation,
      revision,
      key: `${generation}:${revision}:${modes}`,
      isLoaded,
      isCurrent: (options?: { editability?: boolean }) =>
        isLoaded() &&
        revision === this.revisions &&
        modes === this.modes &&
        (!options?.editability || editability === this.editability),
    })
  }
}
