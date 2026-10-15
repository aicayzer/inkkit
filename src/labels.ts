import type { Ctx } from '@milkdown/kit/ctx'
import { $ctx } from '@milkdown/kit/utils'
import type { EditorLabels } from './types'

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
  fileLoading: 'Loading file…',
  fileMissing: 'File unavailable',
  fileError: 'File could not be loaded',
  fileRetry: 'Retry',
  fileOpen: 'Open',
  filePreviewUnavailable: 'Preview unavailable',
  filePDFPreview: 'Open to view this PDF',
  wikiMissing: 'Link unavailable',
  comment: 'Author comment',
  preservedMarkdown: 'Preserved Markdown',
}

export const labelsCtx = $ctx<Readonly<EditorLabels>, 'inkkitLabels'>(
  defaultLabels,
  'inkkitLabels',
)

export function editorLabels(ctx: Ctx): Readonly<EditorLabels> {
  return ctx.isInjected(labelsCtx.key) ? ctx.get(labelsCtx.key) : defaultLabels
}
