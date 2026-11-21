import { $ctx } from '@milkdown/kit/utils'

/** The display preferences the plugins read when a document loads. */
export interface DisplayState {
  foldHeadings: boolean
  codeLineNumbers: boolean
}

/** The editor answers with the current preferences, so a load starts from them. */
export const displayCtx = $ctx<() => DisplayState, 'inkkitDisplay'>(
  () => ({ foldHeadings: false, codeLineNumbers: false }),
  'inkkitDisplay',
)
