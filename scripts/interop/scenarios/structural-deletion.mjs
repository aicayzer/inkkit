const cases = [
  ['tight-nested', '- two\n  * nested\n  * more\n', '- * nested\n  * more\n'],
  ['wrapped-paragraph', 'two\nmore\n', 'more\n'],
  ['wrapped-list', '- two\n  more\n', '- more\n'],
  ['wrapped-quote', '> two\n> more\n', '> more\n'],
  [
    'crlf-unicode-nested',
    '+ two\r\n  * nested 🌍\r\n  * more\r\n',
    '+ * nested 🌍\r\n  * more\r\n',
  ],
  ['crlf-unicode-quote', '> two\r\n> more 🌍\r\n', '> more 🌍\r\n'],
]
export const scenarios = {}
for (const [name, source, expectedSource] of cases) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const tail =
    newline +
    '[Keep café 😀][REF]' +
    newline +
    newline +
    '[REF]: https://example.com "Authored"' +
    newline
  const original = source + tail
  const expected = expectedSource + tail
  const input = {
    source: original,
    operations: [
      { op: 'assert', path: 'snapshot.text', equals: original },
      { op: 'select', text: 'two', from: 3, to: 3, name: 'caret' },
      { op: 'assert', name: 'caret', path: '', equals: '' },
      {
        op: 'nativeInput',
        keys: Array.from({ length: 3 }, () => ({
          keyCode: 51,
          characters: '\u007f',
        })),
      },
      { op: 'assert', path: 'snapshot.text', equals: expected },
      { op: 'assert', path: 'snapshot.revision', equals: 3 },
      { op: 'assert', path: 'error', equals: null },
      { op: 'assert', path: 'diagnostics', equals: [] },
      { op: 'undo' },
      { op: 'assert', path: 'snapshot.text', equals: original },
      { op: 'redo' },
      { op: 'assert', path: 'snapshot.text', equals: expected },
      { op: 'save', name: 'saved' },
      { op: 'assert', name: 'saved', path: 'text', equals: expected },
      { op: 'assert', path: 'error', equals: null },
      { op: 'assert', path: 'diagnostics', equals: [] },
      { op: 'reopen', name: 'reopened' },
      { op: 'assert', name: 'reopened', path: 'text', equals: expected },
    ],
  }

  scenarios['native-structural-deletion-' + name] = {
    fixture: input,
    native: [{ key: 'Backspace', count: 3, collapsed: true }],
    strict: true,
  }
}
