const assert = (path, equals, name) => ({
  op: 'assert',
  path,
  equals,
  ...(name ? { name } : {}),
})
const healthy = () => [assert('error', null), assert('diagnostics', [])]
const cases = [
  {
    name: 'paragraph-lf',
    source: 'before\n\ntarget\n\nafter\n',
    text: 'α\nβ',
    pasted: 'before\n\nα\\\nβ\n\nafter\n',
    completed: 'before\n\nα\\\nβX\n\nafter\n',
    readable: 'before\nα\nβX\nafter',
    selector: 'p',
    occurrence: 1,
    content: 'αβX',
    marks: null,
  },
  {
    name: 'marked-table-lf',
    source: 'before\n\n| H |\n| - |\n| **target** |\n\nafter\n',
    text: 'α\nβ',
    pasted: 'before\n\n| H |\n| - |\n| **α<br />β** |\n\nafter\n',
    completed: 'before\n\n| H |\n| - |\n| **α<br />βX** |\n\nafter\n',
    readable: 'before\nH\nα\nβX\nafter',
    selector: 'td p',
    occurrence: 0,
    content: 'αβX',
    marks: 'td strong',
    markedContent: 'αβX',
  },
  {
    name: 'marked-heading-crlf-blank-trailing',
    source: 'before\n\n# **target**\n\nafter\n',
    text: 'α\r\n\r\nβ\r\n',
    pasted: 'before\n\n# **α<br /><br />β**<br />\n\nafter\n',
    completed: 'before\n\n# **α<br /><br />β**<br />X\n\nafter\n',
    readable: 'before\nα\n\nβ\nX\nafter',
    selector: 'h1',
    occurrence: 0,
    content: 'αβX',
    marks: 'h1 strong',
    markedContent: 'αβ',
  },
  {
    name: 'source-crlf-unicode',
    source: 'before\n\ntarget\n\nafter\n',
    mode: 'source',
    text: 'α\r\n\r\nβ\r\n',
    pasted: 'before\n\nα\r\n\r\nβ\r\n\n\nafter\n',
    completed: 'before\n\nα\r\n\r\nβ\r\nX\n\nafter\n',
  },
]

export const scenarios = {}
for (const fixture of cases) {
  const { name, source, text, pasted, completed } = fixture
  const operations = [
    ...(fixture.mode ? [{ op: 'editingMode', mode: fixture.mode }] : []),
    { op: 'selectTextRange', text: 'target', name: 'selected' },
    assert('text', 'target', 'selected'),
    {
      op: 'nativeClipboard',
      action: 'write',
      text,
      html: '<p>HTML must be ignored</p>',
      name: 'written',
    },
    { op: 'nativeClipboard', action: 'read', name: 'readBack' },
    assert('text', text, 'readBack'),
    {
      op: 'nativeClipboard',
      action: 'hostPastePlain',
      name: 'pastedClipboard',
    },
    assert('text', text, 'pastedClipboard'),
    assert('snapshot.text', pasted),
    ...healthy(),
    { op: 'historyBoundary' },
    {
      op: 'nativeInput',
      keyCode: 7,
      characters: 'X',
      shiftKey: true,
      name: 'typed',
    },
    assert('snapshot.text', completed),
    ...healthy(),
    ...(fixture.readable
      ? [
          { op: 'textSnapshot', name: 'readable' },
          assert('text', fixture.readable, 'readable'),
          { op: 'dom', selector: fixture.selector, name: 'content' },
          assert(
            'nodes.' + fixture.occurrence + '.text',
            fixture.content,
            'content',
          ),
          ...(fixture.marks
            ? [
                { op: 'dom', selector: fixture.marks, name: 'marks' },
                assert('count', 1, 'marks'),
                assert('nodes.0.text', fixture.markedContent, 'marks'),
              ]
            : []),
        ]
      : []),
    { op: 'undo' },
    assert('snapshot.text', pasted),
    { op: 'undo' },
    assert('snapshot.text', source),
    { op: 'redo' },
    assert('snapshot.text', pasted),
    { op: 'redo' },
    assert('snapshot.text', completed),
    { op: 'save', name: 'saved' },
    assert('text', completed, 'saved'),
    ...healthy(),
    { op: 'reopen', name: 'reopened' },
    assert('text', completed, 'reopened'),
    ...healthy(),
    ...(fixture.readable
      ? [
          { op: 'textSnapshot', name: 'reopenedReadable' },
          assert('text', fixture.readable, 'reopenedReadable'),
          ...(fixture.marks
            ? [
                { op: 'dom', selector: fixture.marks, name: 'reopenedMarks' },
                assert('count', 1, 'reopenedMarks'),
                assert('nodes.0.text', fixture.markedContent, 'reopenedMarks'),
              ]
            : []),
        ]
      : []),
  ]

  scenarios['native-literal-paste-' + name] = {
    fixture: { source, historyClock: true, operations },
    clipboard: true,
    native: [{ key: 'X' }],
    strict: true,
  }
}
