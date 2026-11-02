// The drawn caret under a loose line height, placed by the facade and moved by trusted AppKit
// keys. At a soft wrap, the line WebKit's own caret chose is read back and compared.
const paragraph =
  'It recently came to my attention that a site of mine did not have the right stuff in place for agents. Can you look at my companies-house.uk website and ensure that it does have the right stuff in place? Also, can you make the other address redirect to it?'
const loose = {
  '--inkkit-line-height': '1.55',
  '--inkkit-reading-width': '360px',
}
const assert = (name, path, equals) => ({ op: 'assert', name, path, equals })
const key = (keyCode, characters, modifiers = {}) => ({
  op: 'nativeInput',
  keyCode,
  characters,
  ...modifiers,
})

export const scenarios = {
  'native-drawn-caret-wrapped-lines': {
    fixture: {
      source: `${paragraph}\n\nAfter.\n`,
      operations: [
        {
          op: 'selectTextRange',
          text: 'companies-house',
          offset: 3,
          length: 0,
          options: { focus: true },
        },
        { op: 'caretGeometry', style: loose, name: 'wrapped' },
        assert('wrapped', 'drawn', true),
        assert('wrapped', 'caretColor', 'rgba(0, 0, 0, 0)'),
        assert('wrapped', 'wrappedLine', true),
        assert('wrapped', 'onText', true),
        // Command-Right: the end of this line, where WebKit keeps the upper line.
        key(124, '', { metaKey: true }),
        { op: 'caretGeometry', engineLine: true, name: 'lineEnd' },
        assert('lineEnd', 'wrap', true),
        assert('lineEnd', 'onText', true),
        assert('lineEnd', 'onUpperLine', true),
        assert('lineEnd', 'engineOnUpperLine', true),
        // Command-Left, then Down: the start of the next line, on the lower line.
        {
          op: 'selectTextRange',
          text: 'companies-house',
          offset: 3,
          length: 0,
          options: { focus: true },
        },
        key(123, '', { metaKey: true }),
        key(125, ''),
        { op: 'caretGeometry', engineLine: true, name: 'down' },
        assert('down', 'wrap', true),
        assert('down', 'onText', true),
        assert('down', 'onUpperLine', false),
        assert('down', 'engineOnUpperLine', false),
        // A range selection hands the caret back to WebKit.
        key(124, '', { shiftKey: true }),
        { op: 'caretGeometry', name: 'range' },
        assert('range', 'drawn', false),
        assert('range', 'shown', false),
        { op: 'assert', path: 'error', equals: null },
      ],
    },
  },
}
