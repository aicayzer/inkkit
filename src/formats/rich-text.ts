import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Slice } from '@milkdown/kit/prose/model'
import { clipboardContent, clipboardText } from '../clipboard'
import { printableMarkdown } from '../print'
import { richTextFromText, richTextText } from './rich-text-model'
import { richTextPaste } from './rich-text-import'
import {
  inLink,
  linkedUnderlines,
  proseToRichText,
  richTextAllows,
  richTextToProse,
} from './rich-text-prose'
import type { FormatHandler, FormatSource } from './types'

function source(ctx: Ctx, text: string): FormatSource {
  const { schema } = ctx.get(editorViewCtx).state
  const document = richTextFromText(text)
  // A document of one empty paragraph and an empty one look the same in the editor; each saves
  // as it loaded.
  const emptyAsNone = document.blocks.length === 0
  return {
    baseline: richTextToProse(schema, document),
    serialize: (doc) => richTextText(proseToRichText(doc, emptyAsNone)),
  }
}

/** Rich text, which the host converts to and from RTF. The editor holds the canonical JSON as the
 *  document's text. It reaches no Markdown parsing or preservation;
 *  `test/formats/boundary.test.ts` checks its imports. */
export const richTextFormat: FormatHandler = {
  format: 'rtf',
  promise: 'structure',
  literalOnly: false,
  sourceMode: false,
  formattedLabel: 'richTextEditor',
  literalLabel: 'sourceEditor',
  headings: false,
  nativeCopy: false,
  keepsInsertedLineEndings: false,
  markdownInput: false,
  load: source,
  parse: source,
  pendingExport: () => undefined,
  literalPaste: (input) => input.text,
  richText: {
    allows: richTextAllows,
    linkedUnderlines,
    inLink,
    paste: richTextPaste,
    copy(state, linkSchemes) {
      const content = state.selection.content().content
      return clipboardContent(content, state.schema, linkSchemes)
    },
  },
  async print({ doc, signal, output }) {
    return printableMarkdown(
      doc.content,
      output.ctx().get(editorViewCtx).state.schema,
      undefined,
      output.context(),
      undefined,
      signal,
    )
  },
  async clipboard({ all, version, output, assertCurrent }) {
    const { state } = output.ctx().get(editorViewCtx)
    const slice = all
      ? new Slice(state.doc.content, 0, 0)
      : state.selection.content()
    const content = slice.content
    // Markdown that shows the copied content, so text such as `**literal**` stays text.
    const markdown = output.richTextMarkdown(slice)
    const { html } = clipboardContent(
      content,
      state.schema,
      output.linkSchemes(),
    )
    const text = clipboardText(content)
    assertCurrent()
    return { ...version, text, html, markdown, images: [], diagrams: [] }
  },
}
