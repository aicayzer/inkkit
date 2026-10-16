// The marker `x` is selected and replaced by the typed keys, so a case places
// input without typing container syntax or changing other blocks.
export const codeSpanAutolinkCases = [
  ['a URL', 'x\n', '`http://x.com`', '`http://x.com`\n'],
  ['a www address', 'x\n', '`www.x.com`', '`www.x.com`\n'],
  ['an email address', 'x\n', '`a@b.co`', '`a@b.co`\n'],
  ['an HTTPS URL', 'x\n', '`https://x.com`', '`https://x.com`\n'],
  [
    'a path and query',
    'x\n',
    '`https://x.com/a?q=1&b=2`',
    '`https://x.com/a?q=1&b=2`\n',
  ],
  [
    'an address with text around it',
    'x\n',
    '`see http://x.com now`',
    '`see http://x.com now`\n',
  ],
  ['after existing text', 'See x\n', '`http://x.com`', 'See `http://x.com`\n'],
  [
    'before existing text',
    'x later\n',
    '`http://x.com`',
    '`http://x.com` later\n',
  ],
  [
    'inside existing text',
    'Before x after\n',
    '`http://x.com`',
    'Before `http://x.com` after\n',
  ],
  [
    'followed by text',
    'x\n',
    '`http://x.com` and more',
    '`http://x.com` and more\n',
  ],
  ['followed by punctuation', 'x\n', '`http://x.com`.', '`http://x.com`.\n'],
  ['inside brackets', 'x\n', '(`http://x.com`)', '(`http://x.com`)\n'],
  [
    'two spans',
    'x\n',
    '`http://x.com` `www.y.com`',
    '`http://x.com` `www.y.com`\n',
  ],
  [
    'inside existing code',
    'Code `xy` now\n',
    'http://x.com',
    'Code `http://x.comy` now\n',
  ],
  ['in a list', '- x\n', '`http://x.com`', '- `http://x.com`\n'],
  ['in a quote', '> x\n', '`http://x.com`', '> `http://x.com`\n'],
  [
    'in a table cell',
    '| Link |\n| --- |\n| x |\n',
    '`http://x.com`',
    '| Link |\n| --- |\n| `http://x.com` |\n',
  ],
  [
    'in a CRLF note',
    'Untouched &copy;\r\n\r\nx\r\n\r\n+ other\r\n',
    '`http://x.com`',
    'Untouched &copy;\r\n\r\n`http://x.com`\r\n\r\n+ other\r\n',
  ],
] as const
