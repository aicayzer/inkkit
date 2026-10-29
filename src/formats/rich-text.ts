import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Fragment } from '@milkdown/kit/prose/model'
import type { EditorState } from '@milkdown/kit/prose/state'
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
  return {
    baseline: richTextToProse(schema, richTextFromText(text)),
    serialize: (doc) => richTextText(proseToRichText(doc)),
  }
}

function selectedContent(state: EditorState, all: boolean): Fragment {
  return all ? state.doc.content : state.selection.content().content
}

/** Rich text, which the host converts to and from RTF. The editor holds the canonical JSON as the
 *  document's text. It reaches no Markdown parsing or preservation;
 *  `test/formats/boundary.test.ts` checks its imports. */
export const richTextFormat: FormatHandler = {
  format: 'rtf',
  promise: 'structure',
  literalOnly: false,
  sourceMode: false,
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
      const content = selectedContent(state, false)
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
    const content = selectedContent(state, all)
    const { html } = clipboardContent(
      content,
      state.schema,
      output.linkSchemes(),
    )
    const text = clipboardText(content)
    assertCurrent()
    // Markdown is not this document's source, so the explicit Markdown field holds its readable
    // text: pasted into a Markdown document, it arrives as typed text, never as syntax.
    return { ...version, text, html, markdown: text, images: [], diagrams: [] }
  },
}
