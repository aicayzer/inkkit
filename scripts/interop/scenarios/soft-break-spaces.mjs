const assert = (path, equals, extra = {}) => ({
  op: 'assert',
  path,
  equals,
  ...extra,
})
export const scenarios = {}
for (const ending of ['\n', '\r\n'])
  for (const container of ['paragraph', 'quote'])
    for (const side of ['before', 'after']) {
      const body = container === 'quote' ? '> αlpha\n> βeta' : 'αlpha\nβeta'
      const source = (
        '__Before__ &amp;\n\n' +
        body +
        '\n\nAfter&#33;\n'
      ).replaceAll('\n', ending)
      const expected =
        side === 'before'
          ? source.replace('αlpha', 'αlpha&#x20;')
          : source.replace('βeta', '&#x20;βeta')
      const name = [container, ending === '\n' ? 'lf' : 'crlf', side].join('-')
      const text = side === 'before' ? 'αlpha' : 'βeta'
      const operations = [
        assert('snapshot.text', source),
        {
          op: 'selectTextRange',
          text,
          offset: side === 'before' ? text.length : 0,
          length: 0,
          options: { focus: true },
          name: 'caret',
        },
        assert('text', '', { name: 'caret' }),
        { op: 'nativeInput', keyCode: 49, characters: ' ' },
        assert('error', null),
        assert('diagnostics', []),
        assert('snapshot.text', expected),
        { op: 'textSnapshot', name: 'editedText' },
        { op: 'undo', name: 'undone' },
        assert('', true, { name: 'undone' }),
        assert('snapshot.text', source),
        { op: 'redo', name: 'redone' },
        assert('', true, { name: 'redone' }),
        assert('snapshot.text', expected),
        { op: 'save', name: 'saved' },
        assert('text', expected, { name: 'saved' }),
        assert('error', null),
        assert('diagnostics', []),
        { op: 'reopen', name: 'reopened' },
        assert('text', expected, { name: 'reopened' }),
        { op: 'textSnapshot', name: 'reopenedText' },
        {
          op: 'assert',
          name: 'reopenedText',
          path: 'text',
          equalsFrom: { name: 'editedText', path: 'text' },
        },
      ]

      scenarios['native-soft-break-spaces-' + name] = {
        fixture: { source, operations },
        native: [
          {
            key: ' ',
            collapsed: true,
            selection: '',
            beforeinput: 'insertText',
          },
        ],
        strict: true,
      }
    }
