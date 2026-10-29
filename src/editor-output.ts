import { withFileSignal } from './files'
import type { FormatHandler, FormatOutput, SavedText } from './formats'
import type { ClipboardOutput, PrintableDocument } from './types'
import type { SessionCapture } from './session'

interface OutputRuntime extends FormatOutput {
  handler(): FormatHandler
  assertCaptured(captured: SessionCapture, aborted?: boolean): void
}

/** Portable output and cancellation, without committing pending source history. */
export class EditorOutput {
  private readonly exportControllers = new Set<AbortController>()
  constructor(private readonly runtime: OutputRuntime) {}

  cancel(): void {
    for (const controller of this.exportControllers) controller.abort()
    this.exportControllers.clear()
  }

  /** Runs asynchronous output work for the document `captured` describes, and throws
   *  `stale-document` when the document, its revision or the editing mode changed meanwhile. */
  private async exportContent<T>(
    captured: SessionCapture,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    this.exportControllers.add(controller)
    try {
      return await withFileSignal(
        operation(controller.signal),
        controller.signal,
      )
    } finally {
      this.exportControllers.delete(controller)
      this.runtime.assertCaptured(captured, controller.signal.aborted)
    }
  }

  async printable(
    snapshot: SavedText,
    captured: SessionCapture,
  ): Promise<PrintableDocument> {
    const handler = this.runtime.handler()
    const doc = this.runtime.exportDocument(snapshot.text)
    this.runtime.diagrams().reconcile(doc)
    const output = await this.exportContent(captured, (signal) =>
      handler.print({ text: snapshot.text, doc, signal, output: this.runtime }),
    )
    return Object.freeze({
      documentId: snapshot.documentId,
      generation: snapshot.generation,
      revision: snapshot.revision,
      format: snapshot.format,
      html: output.html,
      styles: output.styles,
      assets: Object.freeze(
        output.assets.map((asset) =>
          Object.freeze({
            ...asset,
            bytes: new Uint8Array(asset.bytes),
          }),
        ),
      ),
      warnings: Object.freeze(
        output.warnings.map((warning) => Object.freeze({ ...warning })),
      ),
    })
  }

  /** Rejects rather than throws, as an asynchronous member does. */
  clipboard(
    snapshot: SavedText,
    captured: SessionCapture,
    all: boolean,
  ): Promise<ClipboardOutput> {
    const { documentId, generation, revision } = captured
    return this.runtime.handler().clipboard({
      snapshot,
      all,
      version: { documentId, generation, revision },
      output: this.runtime,
      run: (operation) => this.exportContent(captured, operation),
      assertCurrent: () => this.runtime.assertCaptured(captured),
    })
  }
}
