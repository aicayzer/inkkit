import type { Ctx } from '@milkdown/kit/ctx'
import { $ctx } from '@milkdown/kit/utils'
import type { RichTextBehaviour } from './formats/types'

/** What plugins read about the loaded document's format. Each read gives the current value. */
export interface FormatInput {
  /** Markdown input rules and bare-address links apply while typing. */
  markdownInput(): boolean
  /** Set for a document whose content is limited, such as RTF. */
  richText(): RichTextBehaviour | undefined
}

const markdown: FormatInput = {
  markdownInput: () => true,
  richText: () => undefined,
}

export const formatInputCtx = $ctx<FormatInput, 'inkkitFormatInput'>(
  markdown,
  'inkkitFormatInput',
)

export function formatInput(ctx: Ctx): FormatInput {
  return ctx.isInjected(formatInputCtx.key)
    ? ctx.get(formatInputCtx.key)
    : markdown
}
