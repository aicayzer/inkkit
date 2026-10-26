import type { Ctx } from '@milkdown/kit/ctx'
import { $ctx } from '@milkdown/kit/utils'
import { invalidArgument } from './errors'

// Schemes a link may keep in imported HTML and in print export. Each opens a
// mail, phone or web destination and runs no code.
const linkSchemes = new Set(['http', 'https', 'mailto', 'tel'])

/** Schemes a host may never add: each runs code or reads local data. */
const refusedSchemes = new Set(['javascript', 'data', 'vbscript', 'file'])

const noSchemes: ReadonlySet<string> = new Set()

/**
 * Whether a link address may be kept. Relative paths, queries and fragments
 * pass, and so does an address whose scheme is listed, in any letter case.
 * `extra` holds the lower-case schemes one editor's host added. Spaces, tabs
 * and line breaks at the ends are ignored, as in a browser. Any other control
 * character makes the address unsafe, because a browser may skip it while it
 * reads the scheme. The scheme is the text before the first `:` in the part
 * before the first `/`, `?`, `#` or `\`, so an unknown or malformed scheme is
 * refused.
 */
export function isSafeLinkTarget(
  value: string,
  extra: ReadonlySet<string> = noSchemes,
): boolean {
  const target = value.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '')
  if (/[\u0000-\u001f\u007f]/.test(target)) return false
  const head = target.slice(0, target.search(/[/?#\\]|$/))
  const colon = head.indexOf(':')
  if (colon < 0) return true
  const scheme = head.slice(0, colon).toLowerCase()
  return linkSchemes.has(scheme) || extra.has(scheme)
}

/**
 * Checks the host's `linkSchemes` option and returns its entries in lower
 * case. An entry is a scheme name, and `javascript`, `data`, `vbscript` and
 * `file` are never accepted.
 */
export function extraLinkSchemes(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw invalidArgument(`${name} must be a list`)
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || !/^[a-z][a-z0-9+.-]*$/i.test(entry))
      throw invalidArgument(
        `${name}[${index}] must be a scheme name of letters, digits, +, - and ., starting with a letter`,
      )
    const scheme = entry.toLowerCase()
    if (refusedSchemes.has(scheme))
      throw invalidArgument(`${name}[${index}] cannot be ${scheme}`)
    return scheme
  })
}

/** The extra schemes of one editor, so that two editors on a page keep their own. */
export const linkSchemesCtx = $ctx<ReadonlySet<string>, 'inkkitLinkSchemes'>(
  noSchemes,
  'inkkitLinkSchemes',
)

export function editorLinkSchemes(ctx: Ctx): ReadonlySet<string> {
  return ctx.isInjected(linkSchemesCtx.key)
    ? ctx.get(linkSchemesCtx.key)
    : noSchemes
}

/**
 * Whether an image source would run script if a renderer treated it as an
 * address. Image sources are opaque references that a host adapter owns, so
 * only these schemes are refused. Spaces and control characters are ignored
 * wherever they appear, which refuses at least what a browser would run.
 */
export function isScriptAddress(value: string): boolean {
  return /^(?:javascript|vbscript):/i.test(
    value.replace(/[\u0000-\u0020\u007f]/g, ''),
  )
}
