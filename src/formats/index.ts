import type { DocumentFormat } from '../types'
import { markdownFormat } from './markdown'
import { richTextFormat } from './rich-text'
import { textFormat } from './text'
import type { FormatHandler } from './types'

export type {
  FormatHandler,
  FormatSource,
  FormatOutput,
  SavedText,
} from './types'

/** Every format Inkkit can open. */
export const documentFormats = [
  'md',
  'txt',
  'rtf',
] as const satisfies readonly DocumentFormat[]

/** The formats a host is offered when it chooses none. */
export const defaultFormats = [
  'md',
  'txt',
] as const satisfies readonly DocumentFormat[]

export const formatHandlers: Readonly<Record<DocumentFormat, FormatHandler>> = {
  md: markdownFormat,
  txt: textFormat,
  rtf: richTextFormat,
}
// Fails to compile when `documentFormats` leaves out a format.
const everyFormat: [
  Exclude<DocumentFormat, (typeof documentFormats)[number]>,
] extends [never]
  ? true
  : never = true
void everyFormat
