import type { Ctx } from '@milkdown/kit/ctx'
import { $ctx } from '@milkdown/kit/utils'

/** Built-in editor text. Hosts can override individual labels at mount time. */
export interface EditorLabels {
  formattedEditor: string
  plainTextEditor: string
  sourceEditor: string
  placeholder: string
  copyCode: string
  expandCallout: string
  collapseCallout: string
  diagramRendering: string
  /** Prefix shown before the renderer's diagnostic message. */
  diagramUnavailable: string
  /** Prefix followed by the authored footnote label. */
  footnote: string
  tableAddRow: string
  tableAddColumn: string
  tableDeleteRow: string
  tableDeleteColumn: string
  tableAlignLeft: string
  tableAlignCenter: string
  tableAlignRight: string
  tableMoveColumn: string
  tableMoveRow: string
}

export const defaultLabels: Readonly<EditorLabels> = {
  formattedEditor: 'Formatted Markdown editor',
  plainTextEditor: 'Plain text editor',
  sourceEditor: 'Markdown source editor',
  placeholder: 'Start typing…',
  copyCode: 'Copy',
  expandCallout: 'Expand',
  collapseCallout: 'Collapse',
  diagramRendering: 'Rendering diagram…',
  diagramUnavailable: 'Diagram unavailable:',
  footnote: 'Footnote',
  tableAddRow: 'Add row',
  tableAddColumn: 'Add column',
  tableDeleteRow: 'Delete row',
  tableDeleteColumn: 'Delete column',
  tableAlignLeft: 'Align left',
  tableAlignCenter: 'Align center',
  tableAlignRight: 'Align right',
  tableMoveColumn: 'Move column',
  tableMoveRow: 'Move row',
}

export const labelsCtx = $ctx<Readonly<EditorLabels>, 'inkkitLabels'>(
  defaultLabels,
  'inkkitLabels',
)

export function editorLabels(ctx: Ctx): Readonly<EditorLabels> {
  return ctx.isInjected(labelsCtx.key) ? ctx.get(labelsCtx.key) : defaultLabels
}
