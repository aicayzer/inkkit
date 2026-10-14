// Schemes a link may keep in imported HTML and in print export. Each opens a
// mail, phone or web destination and runs no code.
const linkSchemes = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * Whether a link address may be kept. Relative paths, queries and fragments
 * pass, and so does an address whose scheme is listed, in any letter case.
 * Spaces, tabs and line breaks at the ends are ignored, as in a browser. Any
 * other control character makes the address unsafe, because a browser may skip
 * it while it reads the scheme. The scheme is the text before the first `:` in
 * the part before the first `/`, `?`, `#` or `\`, so an unknown or malformed
 * scheme is refused.
 */
export function isSafeLinkTarget(value: string): boolean {
  const target = value.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '')
  if (/[\u0000-\u001f\u007f]/.test(target)) return false
  const head = target.slice(0, target.search(/[/?#\\]|$/))
  const colon = head.indexOf(':')
  return colon < 0 || linkSchemes.has(head.slice(0, colon).toLowerCase())
}
