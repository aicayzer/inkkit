import { type SourceNode } from './preserve-types'
import { signature } from './preserve-shape'
import { PreservationError } from './preserve-error'

// The pipes GFM splits a row at; an escaped pipe does not split it.
export function rowPipes(row: string): {
  opening: boolean
  closing: number | undefined
  cells: number
} {
  const pipes: number[] = []
  for (let index = 0; index < row.length; index++)
    if (row[index] === '\\' && /[\\|]/.test(row[index + 1] ?? '')) index++
    else if (row[index] === '|') pipes.push(index)
  const opening = pipes[0] === row.search(/\S/)
  const last = row.trimEnd().length - 1
  const closing =
    pipes.at(-1) === last && (!opening || pipes.length > 1) ? last : undefined
  return {
    opening,
    closing,
    cells: pipes.length + 1 - Number(opening) - Number(closing != null),
  }
}

// A source row may stop before the header's last cell; the editor holds the
// rest as empty cells, which stay unwritten until one of them gains content.
// Then the new cells follow the row's own source, before its closing pipe.
export function retainShortRow(
  before: SourceNode,
  after: SourceNode,
  retain: (row: SourceNode) => string,
  source: string,
  canonical: string,
): string {
  const count = before.children!.length
  const row = retain({ ...after, children: after.children!.slice(0, count) })
  let filled = after.children!.length
  while (filled > count && !after.children![filled - 1]!.children?.length)
    filled--
  if (filled === count) return row
  const from = after.children![count]!.position?.start.offset
  const to = after.children![filled - 1]!.position?.end.offset
  const start = before.position?.start.offset
  const end = before.position?.end.offset
  if (from == null || to == null || start == null || end == null)
    throw new PreservationError('A source token has no location')
  const kept = rowPipes(row)
  let output = (
    kept.closing == null ? row : row.slice(0, kept.closing)
  ).trimEnd()
  // Without an opening pipe, an empty first cell would not be read at all.
  if (!kept.opening && !after.children![0]!.children?.length)
    output = `|${output ? ' ' : ''}${output.trimStart()}`
  for (let cell = kept.cells; cell < count; cell++) output += ' |'
  // A cell that matches one of the row's own, such as one moved there, keeps
  // that cell's authored text.
  const contentOf = (cell: SourceNode) => [
    cell.children![0]!.position!.start.offset!,
    cell.children!.at(-1)!.position!.end.offset!,
  ]
  const added = after
    .children!.slice(count, filled)
    .map((cell) => {
      const text = canonical.slice(
        cell.position!.start.offset!,
        cell.position!.end.offset!,
      )
      const original = cell.children?.length
        ? before.children!.find(
            (candidate) =>
              candidate.children?.length &&
              signature(candidate) === signature(cell),
          )
        : undefined
      if (!original) return text
      const [cellFrom, cellTo] = contentOf(cell)
      const [sourceFrom, sourceTo] = contentOf(original)
      const offset = cell.position!.start.offset!
      return (
        text.slice(0, cellFrom! - offset) +
        source.slice(sourceFrom, sourceTo) +
        text.slice(cellTo! - offset)
      )
    })
    .join('')
  const addedPipes = rowPipes(added)
  const closing =
    kept.closing != null || rowPipes(source.slice(start, end)).closing != null
  return (
    `${output} ` +
    (addedPipes.closing == null
      ? added
      : added.slice(0, addedPipes.closing)
    ).trimEnd() +
    (closing ? ' |' : '')
  )
}
