/** The address of an icon a host supplies, checked before it is drawn as a CSS mask. A URL that
 *  fetches from the network or runs script is refused, so an icon is only ever decoration.
 *  `what` names the icon in the error, such as `Wiki link icon`. */
export function iconUrl(icon: unknown, what: string): string {
  if (typeof icon !== 'string' || !icon.trim())
    throw new TypeError(`${what} needs a URL`)
  // The address that is checked is the address that is fetched: a relative one would otherwise
  // resolve against the stylesheet that reads the variable, not against the page.
  const url = new URL(icon, document.baseURI)
  if (['http:', 'https:', 'javascript:', 'vbscript:'].includes(url.protocol))
    throw new TypeError(`${what}s must load offline`)
  if (url.protocol === 'data:' && !/^image\//i.test(url.pathname))
    throw new TypeError(`${what} data URL must be an image`)
  return url.href
}

/** A quoted CSS url() whose text cannot end the string or the declaration early. */
export const cssUrl = (url: string) =>
  `url("${url.replace(/[\\"\n\r\f]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `)}")`
