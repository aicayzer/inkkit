// The schemes a host may open: each is a web, mail or phone address and runs no code.
const openable = new Set(['http', 'https', 'mailto', 'tel'])

// A colon ends a scheme only before `//` or after `mailto` and `tel`, so `example.com:8080` and
// `localhost:3000/a` are a host and a port, not a scheme.
const schemePrefix = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:mailto|tel):)/i

/**
 * The address a Link field should write for what the person typed, or `undefined` when it is not
 * a web, mail or phone address. See the reference, which describes each rule.
 */
export function normalizeLinkAddress(input: string): string | undefined {
  const text = input.trim()
  if (!text || /[\s\u0000-\u001f\u007f]/.test(text)) return undefined
  const prefix = schemePrefix.exec(text)
  let address: string
  if (prefix) address = prefix[0].toLowerCase() + text.slice(prefix[0].length)
  else if (text.startsWith('/')) return undefined
  else if (text.includes('@') && !text.includes('/')) address = `mailto:${text}`
  else address = `https://${text}`
  const scheme = address.slice(0, address.indexOf(':'))
  if (scheme === 'http' || scheme === 'https') {
    try {
      return new URL(address).hostname ? address : undefined
    } catch {
      return undefined
    }
  }
  if (scheme === 'mailto' || scheme === 'tel')
    return address.length > scheme.length + 1 ? address : undefined
  return undefined
}

/**
 * Whether a host may open `address` for the person. Only `http`, `https`, `mailto` and `tel`
 * qualify, whatever the letter case. An address with no scheme, an unknown scheme such as
 * `javascript:` or `file:`, or a control character does not.
 */
export function canOpenLink(address: string): boolean {
  const text = address.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '')
  if (/[\u0000-\u001f\u007f]/.test(text)) return false
  const colon = text.search(/[:/?#\\]|$/)
  return text[colon] === ':' && openable.has(text.slice(0, colon).toLowerCase())
}
