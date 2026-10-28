const assert = (path, equals, extra = {}) => ({
  op: 'assert',
  path,
  equals,
  ...extra,
})
const key = (keyCode, characters, extra = {}) => ({
  op: 'nativeInput',
  keyCode,
  characters,
  ...extra,
})
const mode = (mode) => ({ op: 'editingMode', mode })
export const scenarios = {}
for (const prior of [false, true]) {
  const source = 'Café 😀\r\n\r\nTail\r\n'
  const retained = prior ? 'Café 😀\r\n\r\nTailX\r\n' : source
  const operations = []
  if (prior)
    operations.push(
      { op: 'textSnapshot', name: 'priorText' },
      assert('text', 'Café 😀\nTail', { name: 'priorText' }),
      {
        op: 'selectTextRange',
        text: 'Tail',
        offset: 4,
        length: 0,
        options: { focus: true },
        name: 'priorCaret',
      },
      assert('selection.from', 12, { name: 'priorCaret' }),
      assert('selection.to', 12, { name: 'priorCaret' }),
      assert('text', '', { name: 'priorCaret' }),
      { op: 'textSnapshot', name: 'priorSelection' },
      assert('selection.from', 12, { name: 'priorSelection' }),
      assert('selection.to', 12, { name: 'priorSelection' }),
      { op: 'insertText', text: 'X' },
      assert('snapshot.text', retained),
      { op: 'historyBoundary' },
    )
  operations.push(
    {
      op: 'selectTextRange',
      text: 'Tail',
      offset: 0,
      length: 0,
      options: { focus: true },
      name: 'editCaret',
    },
    assert('selection.from', 8, { name: 'editCaret' }),
    assert('selection.to', 8, { name: 'editCaret' }),
    assert('text', '', { name: 'editCaret' }),
    { op: 'insertText', text: 'E' },
    assert('snapshot.text', retained.replace('Tail', 'ETail')),
    mode('source'),
    key(6, 'z', { metaKey: true }),
    assert('snapshot.text', retained),
    { op: 'selectSourceRange', from: 0 },
    key(45, 'n'),
    assert('snapshot.text', 'n' + retained),
    key(6, 'z', { metaKey: true }),
    assert('snapshot.text', retained),
    mode('formatted'),
    assert('commandState.commands.redo', false),
    { op: 'redo', name: 'obsoleteRedo' },
    assert('', false, { name: 'obsoleteRedo' }),
    assert('snapshot.text', retained),
  )
  if (prior)
    operations.push(
      assert('commandState.commands.undo', true),
      { op: 'undo' },
      assert('snapshot.text', source),
      assert('commandState.commands.redo', true),
      { op: 'redo' },
      assert('snapshot.text', retained),
      assert('commandState.commands.redo', false),
      { op: 'redo' },
      assert('snapshot.text', retained),
    )
  operations.push(
    { op: 'save', name: 'saved' },
    assert('text', retained, { name: 'saved' }),
    assert('error', null),
    assert('diagnostics', []),
    { op: 'reopen', name: 'reopened' },
    assert('text', retained, { name: 'reopened' }),
  )
  const name = prior ? 'retained-undo-and-new-redo' : 'obsolete-redo-excluded'

  scenarios['native-source-redo-' + name] = {
    fixture: { source, historyClock: true, operations },
    native: [{ key: 'z' }, { key: 'n' }, { key: 'z' }],
    strict: true,
  }
}
