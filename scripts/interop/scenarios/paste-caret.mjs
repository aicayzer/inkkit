const assert = (path, equals, name) => ({
  op: 'assert',
  path,
  equals,
  ...(name ? { name } : {}),
})
const healthy = () => [assert('error', null), assert('diagnostics', [])]
const fixtures = [
  {
    name: 'terminal-comment',
    source: 'Before\n',
    text: 'x\n\n---\n\n<!-- note -->',
    pasted: 'Beforex\n\n---\n\n<!-- note -->\n',
    typed: 'Beforex\n\n---\n\n<!-- note -->\n\nX\n',
    readable: 'Beforex\nX',
    visible: '.ProseMirror > p:last-child',
  },
  {
    name: 'terminal-folded-callout',
    source: 'Before\n',
    text: 'x\n\n> [!NOTE]-\n> hi',
    pasted: 'Beforex\n\n> [!NOTE]-\n> hi\n',
    typed: 'Beforex\n\n> [!NOTE]-\n> hi\n\nX\n',
    readable: 'Beforex\nNOTE\nhi\nX',
    visible: '.ProseMirror > p:last-child',
    folded: true,
    body: 'hi',
  },
  {
    name: 'terminal-literal-control',
    source: 'Before\n',
    text: 'x\n\nA [full][ref] literal.',
    pasted: 'Beforex\n\nA [full][ref] literal.\n',
    typed: 'Beforex\n\nA [full][ref] literal.X\n',
    readable: 'Beforex\nA [full][ref] literal.X',
    visible: '.inkkit-literal-markdown',
  },
  ...['authored-folded-control', 'reader-opened', 'reader-folded-control'].map(
    (name) => {
      const marker = name === 'reader-folded-control' ? '+' : '-'
      const source = `Before\n\n> [!NOTE]${marker} Title\n> hi\n\nafter\n\n*  untouched é🌻\n`
      const pasted = source.replace('Before', 'Beforex\n\n---')
      const opened = name === 'reader-opened'
      return {
        name,
        source,
        text: 'x\n\n---',
        pasted,
        typed: pasted.replace(
          opened ? '> hi' : '\nafter',
          opened ? '> Xhi' : '\nXafter',
        ),
        readable: `Beforex\nTitle\n${opened ? 'Xhi\nafter' : 'hi\nXafter'}\nuntouched é🌻`,
        visible: opened
          ? '.inkkit-callout-body p'
          : '.ProseMirror > p:nth-last-child(2)',
        folded: !opened,
        body: opened ? 'Xhi' : 'hi',
        toggle: name !== 'authored-folded-control',
      }
    },
  ),
]
export const scenarios = {}
for (const f of fixtures) {
  const visibility = () => [
    { op: 'dom', selector: f.visible, name: 'visible' },
    { op: 'assert', name: 'visible', path: 'nodes.0.text', includes: 'X' },
    assert('nodes.0.display', 'block', 'visible'),
    assert('nodes.0.visibility', 'visible', 'visible'),
    ...(f.folded === undefined
      ? []
      : [
          { op: 'dom', selector: '.inkkit-callout', name: 'fold' },
          assert(
            'nodes.0.attributes.data-inkkit-folded',
            String(f.folded),
            'fold',
          ),
          { op: 'dom', selector: '.inkkit-callout-body', name: 'body' },
          assert('nodes.0.text', f.body, 'body'),
          assert('nodes.0.display', f.folded ? 'none' : 'block', 'body'),
        ]),
  ]
  const operations = [
    {
      op: 'selectTextRange',
      text: 'Before',
      offset: 6,
      length: 0,
      options: { focus: true },
    },
    ...(f.toggle
      ? [{ op: 'click', selector: '[data-inkkit-callout-toggle]' }]
      : []),
    { op: 'paste', input: { text: f.text } },
    assert('snapshot.text', f.pasted),
    ...healthy(),
    { op: 'historyBoundary' },
    { op: 'nativeInput', keyCode: 7, characters: 'X', shiftKey: true },
    assert('snapshot.text', f.typed),
    ...healthy(),
    { op: 'textSnapshot', name: 'readable' },
    assert('text', f.readable, 'readable'),
    ...visibility(),
    ...[
      ['undo', f.pasted],
      ['undo', f.source],
      ['redo', f.pasted],
      ['redo', f.typed],
    ].flatMap(([op, text], i) => [
      { op, name: 'history' + i },
      assert('', true, 'history' + i),
      assert('snapshot.text', text),
      ...healthy(),
    ]),
    { op: 'save', name: 'saved' },
    assert('text', f.typed, 'saved'),
    ...healthy(),
    { op: 'reopen', name: 'reopened' },
    assert('text', f.typed, 'reopened'),
    ...healthy(),
    { op: 'textSnapshot', name: 'reopenedReadable' },
    assert('text', f.readable, 'reopenedReadable'),
  ]

  scenarios['native-paste-caret-' + f.name] = {
    fixture: { source: f.source, historyClock: true, operations },
    native: [{ key: 'X' }],
    strict: true,
  }
}
