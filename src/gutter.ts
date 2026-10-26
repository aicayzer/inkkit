const listMarker = /(?:[-*+]|\d{1,9}[.)])(?=[ \t])/g

/**
 * What the lines of a block repeat before it: the quote markers and
 * indentation that open the line `offset` is on, up to `offset`, with a list
 * marker as the spaces it takes, which is how the lines after the item's first
 * are indented. Anything else before `offset` on its line is content, and ends
 * the gutter.
 */
export function gutterAt(text: string, offset: number): string {
  const line = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset)
  const leading = /^(?:[ \t]|>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))*/.exec(line)![0]
  return leading.replace(listMarker, (marker) => ' '.repeat(marker.length))
}
