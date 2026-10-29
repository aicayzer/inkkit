import { editorViewCtx, parserCtx, remarkCtx } from '@milkdown/kit/core'
import { Fragment } from '@milkdown/kit/prose/model'
import { portableClipboard } from '../clipboard'
import { coded } from '../errors'
import { sourceSelection } from '../source'
import { Preservation } from '../preserve'
import { commentSelectionContent } from '../comments'
import {
  selectionContent,
  selectionMarkdown,
  referenceMetadata,
  withReferenceMetadata,
} from '../reference-clipboard'
import { isMermaid } from '../mermaid'
import { hasAuthoredImagesInLiterals, printableMarkdown } from '../print'
import { InkKitError } from '../types'
import type { FormatHandler } from './types'

/** Markdown, read and saved through source preservation, so an unedited file saves exactly and an
 *  edit changes only the bytes it touched. */
export const markdownFormat: FormatHandler = {
  format: 'md',
  promise: 'exact',
  literalOnly: false,
  sourceMode: true,
  literalLabel: 'sourceEditor',
  headings: true,
  nativeCopy: false,
  keepsInsertedLineEndings: true,
  markdownInput: true,
  load: (ctx, text) => Preservation.read(ctx, text),
  parse: (ctx, text) => Preservation.read(ctx, text),
  pendingExport: (ctx, text) => ctx.get(parserCtx)(text),
  literalPaste: (input) => input.markdown ?? input.text,
  async print({ doc, signal, output }) {
    if (
      !output.images() &&
      !output.files() &&
      hasAuthoredImagesInLiterals(doc.content, (source) =>
        output.ctx().get(remarkCtx).parse(source),
      )
    )
      throw new InkKitError(
        'image-unavailable',
        'No image adapter is configured for the authored images.',
      )
    return printableMarkdown(
      doc.content,
      output.ctx().get(editorViewCtx).state.schema,
      output.images(),
      output.context(),
      output.files(),
      signal,
      output.diagrams(),
      output.root(),
    )
  },
  async clipboard({ snapshot, all, version, output, run, assertCurrent }) {
    const { schema, selection } = output.ctx().get(editorViewCtx).state
    // A partial copy in the source editor reads only the selected source.
    const doc =
      all || !output.sourceMode()
        ? output.exportDocument(snapshot.text)
        : output.ctx().get(editorViewCtx).state.doc
    if (all || !output.sourceMode()) output.diagrams().reconcile(doc)
    const selectedSource =
      !all && output.sourceMode()
        ? sourceSelection(
            snapshot.text,
            output.element().selectionStart,
            output.element().selectionEnd,
          )
        : undefined
    const selectedDoc = selectedSource
      ? output.ctx().get(parserCtx)(selectedSource.shareable)
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
            ? Preservation.read(output.ctx(), snapshot.text).serialize(
                doc.type.create(null, selectionContent(doc, valid)),
              )
            : selectionMarkdown(output.ctx(), doc, valid)
    } catch (error) {
      throw coded(error, 'preservation')
    }
    const result = await run((signal) =>
      portableClipboard(
        all || selectedDoc ? content : selectionContent(doc, content),
        schema,
        markdown,
        output.images(),
        output.context(),
        completeDiagrams,
        output.files(),
        signal,
        output.linkSchemes(),
        output.diagrams(),
        output.root(),
      ),
    )
    const metadata = referenceMetadata(
      output.ctx(),
      selectedDoc ?? doc,
      content,
    )
    if (metadata != null)
      result.html = withReferenceMetadata(result.html, metadata)
    assertCurrent()
    output.remember(
      result,
      markdown,
      content,
      selectedSource != null &&
        selectedSource.markdown !== selectedSource.shareable,
    )
    return { ...version, ...result }
  },
}
