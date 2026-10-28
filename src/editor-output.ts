import { editorViewCtx, parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { portableClipboard } from './clipboard'
import { withFileSignal } from './files'
import { coded } from './errors'
import { sourceSelection, rawOffset } from './source'
import { Preservation } from './preserve'
import { commentSelectionContent } from './comments'
import {
  selectionContent,
  selectionMarkdown,
  referenceMetadata,
  withReferenceMetadata,
} from './reference-clipboard'
import { isMermaid } from './mermaid'
import {
  hasAuthoredImagesInLiterals,
  printableText,
  printableMarkdown,
} from './print'
import {
  InkKitError,
  type ClipboardOutput,
  type DocumentSnapshot,
  type PrintableDocument,
  type DocumentContext,
  type ImageAdapter,
  type FileAdapter,
} from './types'
import type { SessionCapture } from './session'

interface OutputRuntime {
  ctx(): Ctx
  exportDocument(text: string): ProseNode
  sourceMode(): boolean
  element(): HTMLTextAreaElement
  images(): ImageAdapter | undefined
  files(): FileAdapter | undefined
  linkSchemes(): ReadonlySet<string>
  context(): DocumentContext
  assertCaptured(captured: SessionCapture, aborted?: boolean): void
  remember<T extends { text: string; html: string }>(
    output: T,
    markdown: string,
    content: Fragment,
    privateSource?: boolean,
  ): T
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
    snapshot: DocumentSnapshot,
    captured: SessionCapture,
  ): Promise<PrintableDocument> {
    const state = this.runtime.ctx().get(editorViewCtx).state
    const doc = this.runtime.exportDocument(snapshot.text)
    const output = await this.exportContent(captured, async (signal) => {
      if (
        snapshot.format === 'md' &&
        !this.runtime.images() &&
        !this.runtime.files() &&
        hasAuthoredImagesInLiterals(doc.content, (source) =>
          this.runtime.ctx().get(remarkCtx).parse(source),
        )
      )
        throw new InkKitError(
          'image-unavailable',
          'No image adapter is configured for the authored images.',
        )
      return snapshot.format === 'txt'
        ? printableText(snapshot.text)
        : printableMarkdown(
            doc.content,
            state.schema,
            this.runtime.images(),
            this.runtime.context(),
            this.runtime.files(),
            signal,
          )
    })
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

  async clipboard(
    snapshot: DocumentSnapshot,
    captured: SessionCapture,
    all: boolean,
  ): Promise<ClipboardOutput> {
    const { documentId, generation, revision } = captured
    const version = { documentId, generation, revision }
    if (snapshot.format === 'txt') {
      const text = all
        ? snapshot.text
        : snapshot.text.slice(
            rawOffset(snapshot.text, this.runtime.element().selectionStart),
            rawOffset(snapshot.text, this.runtime.element().selectionEnd),
          )
      const pre = document.createElement('pre')
      pre.textContent = text
      return {
        ...version,
        text,
        html: pre.outerHTML,
        markdown: text,
        images: [],
        diagrams: [],
      }
    }
    const { schema, selection } = this.runtime.ctx().get(editorViewCtx).state
    // A partial copy in the source editor reads only the selected source.
    const doc =
      all || !this.runtime.sourceMode()
        ? this.runtime.exportDocument(snapshot.text)
        : this.runtime.ctx().get(editorViewCtx).state.doc
    const selectedSource =
      !all && this.runtime.sourceMode()
        ? sourceSelection(
            snapshot.text,
            this.runtime.element().selectionStart,
            this.runtime.element().selectionEnd,
          )
        : undefined
    const selectedDoc = selectedSource
      ? this.runtime.ctx().get(parserCtx)(selectedSource.shareable)
      : undefined
    const completeDiagrams = new Set<string>()
    ;(selectedDoc ?? doc).descendants((node, pos) => {
      if (
        isMermaid(node) &&
        (selectedDoc
          ? Boolean(node.attrs.authoredFence?.close)
          : all ||
            (selection.from <= pos + 1 &&
              selection.to >= pos + node.nodeSize - 1))
      ) {
        completeDiagrams.add(node.textContent.replace(/\r\n?/g, '\n'))
      }
    })
    const content = selectedDoc
      ? selectedDoc.content
      : all
        ? doc.content
        : commentSelectionContent(
            doc,
            selection.from,
            selection.to,
            selection.content().content,
          )
    const valid = content.firstChild?.isInline
      ? Fragment.from(schema.nodes.paragraph!.create(null, content))
      : content
    let markdown: string
    try {
      markdown = selectedSource
        ? selectedSource.markdown
        : all
          ? snapshot.text
          : completeDiagrams.size
            ? Preservation.read(this.runtime.ctx(), snapshot.text).serialize(
                doc.type.create(null, selectionContent(doc, valid)),
              )
            : selectionMarkdown(this.runtime.ctx(), doc, valid)
    } catch (error) {
      throw coded(error, 'preservation')
    }
    const result = await this.exportContent(captured, (signal) =>
      portableClipboard(
        all || selectedDoc ? content : selectionContent(doc, content),
        schema,
        markdown,
        this.runtime.images(),
        this.runtime.context(),
        completeDiagrams,
        this.runtime.files(),
        signal,
        this.runtime.linkSchemes(),
      ),
    )
    const metadata = referenceMetadata(
      this.runtime.ctx(),
      selectedDoc ?? doc,
      content,
    )
    if (metadata != null)
      result.html = withReferenceMetadata(result.html, metadata)
    this.runtime.assertCaptured(captured)
    this.runtime.remember(
      result,
      markdown,
      content,
      selectedSource != null &&
        selectedSource.markdown !== selectedSource.shareable,
    )
    return { ...version, ...result }
  }
}
