import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { rawOffset } from '../source'
import { printableText } from '../print'
import type { FormatHandler, FormatSource } from './types'

/** A paragraph holding `text`, or an empty one. */
function paragraph(ctx: Ctx, text: string): FormatSource {
  const { schema } = ctx.get(editorViewCtx).state
  return {
    baseline: schema.topNodeType.create(
      null,
      schema.nodes.paragraph!.create(
        null,
        text ? schema.text(text) : undefined,
      ),
    ),
  }
}

/** Literal text, edited only on the literal surface and saved as typed. It reaches no Markdown
 *  parsing or preservation; `test/formats/boundary.test.ts` checks its imports. */
export const textFormat: FormatHandler = {
  format: 'txt',
  promise: 'exact',
  literalOnly: true,
  sourceMode: false,
  literalLabel: 'plainTextEditor',
  headings: false,
  nativeCopy: true,
  keepsInsertedLineEndings: false,
  // The text stays on the literal surface, and the formatted document stays empty until an edit.
  load: (ctx) => paragraph(ctx, ''),
  parse: paragraph,
  pendingExport: () => undefined,
  literalPaste: (input) => input.text,
  print: async ({ text }) => printableText(text),
  async clipboard({ snapshot, all, version, output }) {
    const text = all
      ? snapshot.text
      : snapshot.text.slice(
          rawOffset(snapshot.text, output.element().selectionStart),
          rawOffset(snapshot.text, output.element().selectionEnd),
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
  },
}
