// Literal paste keeps the delimiters visible; the address uses a reopenable form.
export const autolinkRefusalCases = [
  ['**', '\\*\\*<http://x.com>\\*\\*'],
  ['*', '\\*<http://x.com>\\*'],
  ['__', '\\_\\_<http://x.com>\\_\\_'],
  ['~~', '\\~\\~<http://x.com>\\~\\~'],
  // A literal backtick can occur in a bare GFM URL; the opening one is escaped.
  ['`', '\\`http://x.com`'],
] as const
