import type { Ctx } from '@milkdown/kit/ctx'
import { $ctx } from '@milkdown/kit/utils'
import type { EditorLabels } from './types'

export const defaultLabels: Readonly<EditorLabels> = {
  suggestions: 'Suggestions',
  suggestionsEmpty: 'No matches',
  suggestionsLoading: 'Loading…',
  slashHeading1: 'Heading 1',
  slashHeading2: 'Heading 2',
  slashHeading3: 'Heading 3',
  slashBulletList: 'Bulleted List',
  slashOrderedList: 'Numbered List',
  slashTaskList: 'Checklist',
  taskCheckbox: 'Task',
  slashQuote: 'Quote',
  slashCodeBlock: 'Code Block',
  slashTable: 'Table',
  slashCallout: 'Callout',
  slashDivider: 'Divider',
  slashDiagram: 'Diagram',
  slashNote: 'Note',
  slashTip: 'Tip',
  slashImportant: 'Important',
  slashWarning: 'Warning',
  slashCaution: 'Caution',

  formattedEditor: 'Formatted Markdown editor',
  richTextEditor: 'Rich text editor',
  plainTextEditor: 'Plain text editor',
  sourceEditor: 'Markdown source editor',
  placeholder: 'Start typing…',
  copyCode: 'Copy',
  codeLanguage: 'Code language',
  codeLanguageSearch: 'Search languages',
  codeAuto: 'Auto',
  codePlainText: 'Plain text',
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
  imageResize: 'Resize image',
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
