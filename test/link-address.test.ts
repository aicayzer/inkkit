import { expect, test } from 'vitest'
import { canOpenLink, normalizeLinkAddress } from '../src/core'

test.each([
  ['example.com', 'https://example.com'],
  ['  example.com/path?q=1#top  ', 'https://example.com/path?q=1#top'],
  ['www.example.com', 'https://www.example.com'],
  ['localhost', 'https://localhost'],
  ['http://example.com', 'http://example.com'],
  ['HTTPS://Example.com/A', 'https://Example.com/A'],
  ['Http://example.com', 'http://example.com'],
  ['ftp-like+scheme://host', undefined],
  ['mailto:a@b.co', 'mailto:a@b.co'],
  ['MAILTO:a@b.co', 'mailto:a@b.co'],
  ['a@b.co', 'mailto:a@b.co'],
  ['tel:+441234', 'tel:+441234'],
  ['TEL:+441234', 'tel:+441234'],
  ['[::1]:8080', 'https://[::1]:8080'],
])('normalizes %j to %j', (input, expected) => {
  expect(normalizeLinkAddress(input)).toBe(expected)
})

test.each([
  // A colon is a port, not a scheme, unless `//` follows or the scheme is mailto or tel.
  ['example.com:8080', 'https://example.com:8080'],
  ['localhost:3000/a', 'https://localhost:3000/a'],
  ['example.com:8080/a?b=1', 'https://example.com:8080/a?b=1'],
  ['https://example.com:8080', 'https://example.com:8080'],
])('treats a host and port as a host: %j', (input, expected) => {
  expect(normalizeLinkAddress(input)).toBe(expected)
})

test.each([
  '',
  '   ',
  'two words',
  'example.com/a b',
  'https://',
  'http://:80',
  'mailto:',
  'tel:',
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'javascript://x',
  'data:text/html,x',
  'file:///etc/passwd',
  'FILE://host/x',
  'vbscript:x',
  '//example.com',
  '/relative/path',
  'https://exa\u0000mple.com',
  'example.com\n',
  'ftp://example.com',
])('refuses %j', (input) => {
  // Leading and trailing white space is trimmed, so a trailing line break alone is fine.
  expect(normalizeLinkAddress(input)).toBe(
    input === 'example.com\n' ? 'https://example.com' : undefined,
  )
})

test('every normalized address can be opened', () => {
  for (const input of [
    'example.com',
    'localhost:3000/a',
    'a@b.co',
    'tel:+4412',
    'MAILTO:a@b.co',
    'http://x.test',
  ])
    expect(canOpenLink(normalizeLinkAddress(input)!)).toBe(true)
})

test.each([
  'http://example.com',
  'https://example.com/a?b#c',
  'HTTPS://EXAMPLE.COM',
  'Http://example.com',
  'mailto:a@b.co',
  'MailTo:a@b.co',
  'tel:+4412',
  'TEL:+4412',
  '  https://example.com  ',
])('opens %j', (address) => {
  expect(canOpenLink(address)).toBe(true)
})

test.each([
  '',
  'example.com',
  'example.com:8080',
  'localhost:3000/a',
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  ' javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'data:text/html,x',
  'file:///etc/passwd',
  'vbscript:x',
  'ftp://example.com',
  'things:///show',
  '//example.com',
  '/path',
  '#fragment',
  '?query',
  'https\u0000://example.com',
  'x/https://example.com',
])('does not open %j', (address) => {
  expect(canOpenLink(address)).toBe(false)
})
