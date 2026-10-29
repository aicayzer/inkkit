import type { DocumentFormat } from '../types'
import { markdownFormat } from './markdown'
import { textFormat } from './text'
import type { FormatHandler } from './types'

export type { FormatHandler, FormatSource, FormatOutput } from './types'

/** Every format Inkkit can open, and the list a host is offered when it chooses none. */
export const documentFormats = [
  'md',
  'txt',
] as const satisfies readonly DocumentFormat[]

export const formatHandlers: Readonly<Record<DocumentFormat, FormatHandler>> = {
  md: markdownFormat,
  txt: textFormat,
}
// Fails to compile when `documentFormats` leaves out a format.
const everyFormat: [
  Exclude<DocumentFormat, (typeof documentFormats)[number]>,
] extends [never]
  ? true
  : never = true
void everyFormat
