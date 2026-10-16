// Literal paste keeps the delimiters visible; the address uses a reopenable form.
export const autolinkRefusalCases = [
  ['**', '\\*\\*<http://x.com>\\*\\*'],
  ['*', '\\*<http://x.com>\\*'],
  ['__', '\\_\\_<http://x.com>\\_\\_'],
  ['~~', '\\~\\~<http://x.com>\\~\\~'],
  // GFM reads a closing backtick into a bare URL; the link ends before it.
  ['`', '\\`<http://x.com>\\`'],
] as const
