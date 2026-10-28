// Offsets address UTF-16 source maps, so compare code units, not code points.
export function matchingTextEdges(
  before: string,
  after: string,
): { prefix: number; suffix: number } {
  const limit = Math.min(before.length, after.length)
  let prefix = 0,
    suffix = 0
  while (prefix < limit && before[prefix] === after[prefix]) prefix++
  while (
    suffix < limit - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++
  return { prefix, suffix }
}
