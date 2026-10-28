import { matchingTextEdges } from './text-edges'
import type { Root } from 'mdast'
import { type SourceNode } from './preserve-types'
import { sourceRange, lf, literals } from './preserve-shape'

// One line of a literal block: its authored spelling, given its canonical
// spelling `before` and the edited canonical line `after`. The authored text
// is kept on the side of the edit where it reads as `before` does.
function retainLine(authored: string, before: string, after: string): string {
  if (before === after) return authored
  const { prefix, suffix } = matchingTextEdges(before, after)
  if (authored.endsWith(before.slice(prefix)))
    return (
      authored.slice(0, authored.length - before.length + prefix) +
      after.slice(prefix)
    )
  if (authored.startsWith(before.slice(0, before.length - suffix)))
    return (
      after.slice(0, after.length - suffix) +
      authored.slice(before.length - suffix)
    )
  return after
}

// The authored source of a literal block with the edit that turned its
// canonical Markdown `before` into `after`, or into the authored source itself
// when its canonical Markdown is not known. The canonical Markdown has a line
// for each authored line, so each line the edit left alone keeps its authored
// spelling and line ending, and an edited line keeps them where it can. Where
// the edit adds or removes lines, those it reached are written as `after` has
// them.
export function retainLiteral(
  raw: string,
  before: string | undefined,
  after: string,
): string {
  const parts = raw.split(/(\r\n|\r|\n)/)
  const authored = parts.filter((_, index) => index % 2 === 0)
  const endings = parts.filter((_, index) => index % 2 === 1)
  const old = (before ?? lf(raw)).split('\n')
  const now = after.split('\n')
  if (authored.length !== old.length) return after
  let start = 0
  while (start < old.length && start < now.length && old[start] === now[start])
    start++
  let end = 0
  while (
    end < old.length - start &&
    end < now.length - start &&
    old[old.length - 1 - end] === now[now.length - 1 - end]
  )
    end++
  const reached = now.slice(start, now.length - end)
  const lines: string[] = []
  for (let index = 0; index < start; index++)
    lines.push(authored[index]! + (endings[index] ?? ''))
  if (reached.length === old.length - start - end)
    reached.forEach((line, index) =>
      lines.push(
        retainLine(authored[start + index]!, old[start + index]!, line) +
          (endings[start + index] ?? ''),
      ),
    )
  else if (reached.length)
    lines.push(
      reached.join('\n') +
        (end ? (endings[authored.length - end - 1] ?? '\n') : ''),
    )
  // Removed lines at the end leave no line ending after the last one kept.
  else if (!end && start) lines[start - 1] = authored[start - 1]!
  for (let index = authored.length - end; index < authored.length; index++)
    lines.push(authored[index]! + (endings[index] ?? ''))
  return lines.join('')
}

export const holdsLiteral = (node: SourceNode): boolean =>
  (node.children ?? []).some(
    (child) => literals.has(child) || holdsLiteral(child),
  )

// Marks the nodes of `raw` that `transformed` keeps as literal blocks, and
// those at the ranges of `blocks`, which the editor holds as literal blocks.
export function markLiterals(
  raw: Root,
  transformed: Root,
  blocks: readonly SourceNode[] = [],
): void {
  const ranges = new Set(blocks.map(sourceRange))
  const find = (node: SourceNode) => {
    if (node.type === 'inkkitLiteral') ranges.add(sourceRange(node))
    else node.children?.forEach(find)
  }
  find(transformed as unknown as SourceNode)
  if (!ranges.size) return
  const mark = (node: SourceNode) => {
    if (node.position?.start.offset != null && ranges.has(sourceRange(node)))
      literals.add(node)
    else node.children?.forEach(mark)
  }
  ;(raw.children as unknown as SourceNode[]).forEach(mark)
}
