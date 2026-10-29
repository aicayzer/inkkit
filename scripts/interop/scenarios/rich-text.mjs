// An RTF document loaded through the facade as the host's converter gives it, edited with trusted
// AppKit typing and the host's underline key, and saved back as a canonical document.
const assert = (path, equals, name) => ({
  op: 'assert',
  path,
  equals,
  ...(name ? { name } : {}),
})
const text = (value, marks) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const paragraph = (...content) => ({ type: 'paragraph', content })
const document = (...blocks) => ({ version: 1, blocks })

const source = document(
  paragraph(text('Café '), text('bold', [{ type: 'bold' }]), text(' word')),
  {
    type: 'paragraph',
    align: 'center',
    content: [text('Centred 😀')],
  },
)
const typed = document(
  paragraph(text('Café '), text('bold', [{ type: 'bold' }]), text(' wordx')),
  source.blocks[1],
)
const underlined = document(
  paragraph(
    text('Café '),
    text('bold', [{ type: 'bold' }]),
    text(' '),
    text('wordx', [{ type: 'underline' }]),
  ),
  source.blocks[1],
)

export const scenarios = {
  'native-rich-text-type-and-underline': {
    fixture: {
      source,
      format: 'rtf',
      operations: [
        assert('snapshot.format', 'rtf'),
        assert('snapshot.document', source),
        assert('snapshot.dirty', false),
        {
          op: 'selectTextRange',
          text: 'word',
          offset: 4,
          length: 0,
          options: { focus: true },
          name: 'caret',
        },
        assert('text', '', 'caret'),
        { op: 'nativeInput', keyCode: 7, characters: 'x' },
        assert('snapshot.document', typed),
        assert('snapshot.dirty', true),
        { op: 'setKeymap', bindings: { underline: ['Mod-u'] } },
        {
          op: 'selectTextRange',
          text: 'wordx',
          options: { focus: true },
          name: 'selected',
        },
        assert('text', 'wordx', 'selected'),
        { op: 'nativeInput', keyCode: 32, characters: 'u', metaKey: true },
        assert('snapshot.document', underlined),
        assert('commandState.caret.marks', ['underline']),
        assert('error', null),
        assert('diagnostics', []),
        { op: 'undo' },
        assert('snapshot.document', typed),
        { op: 'redo' },
        assert('snapshot.document', underlined),
        { op: 'save', name: 'saved' },
        assert('document', underlined, 'saved'),
        { op: 'reopen', name: 'reopened' },
        assert('document', underlined, 'reopened'),
        assert('dirty', false, 'reopened'),
      ],
    },
    native: [{ key: 'x' }, { key: 'u' }],
    strict: true,
  },
}
