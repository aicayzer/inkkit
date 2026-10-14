// Schemes a link may keep when HTML is imported. Each opens a mail, phone or
// web destination and runs no code.
const linkSchemes = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * Whether a link address from imported HTML may be kept. Relative paths,
 * queries and fragments pass. An address with a scheme passes only when the
 * scheme is listed, however it is cased. Spaces, tabs and line breaks at the
 * ends are ignored, as in a browser; any other control character, which a
 * browser may skip while it reads the scheme, makes the address unsafe. The
 * text before the first `/`, `?`, `#` or `\` that holds a `:` is read as the
 * scheme, so an unknown or malformed one is refused.
 */
export function isSafeLinkTarget(value: string): boolean {
  const target = value.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '')
  if (/[\u0000-\u001f\u007f]/.test(target)) return false
  const head = target.slice(0, target.search(/[/?#\\]|$/))
  const colon = head.indexOf(':')
  return colon < 0 || linkSchemes.has(head.slice(0, colon).toLowerCase())
}
