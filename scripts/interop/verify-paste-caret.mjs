import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

if (process.argv.length !== 6)
  throw Error('Usage: verify-paste-caret.mjs ARCHIVE BUNDLE OUTPUT HOST')
const [archive, bundle, output, host] = process.argv
  .slice(2)
  .map((p) => resolve(p))
mkdirSync(output, { recursive: true })
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const evidence = {
  contract:
    'Public paste facade and trusted AppKit X typing in WKWebView. DOM clicks establish reader fold state only. No native paste shortcut, native pointer or system clipboard claim.',
  archive,
  archiveSha256: hash(archive),
  bundle,
  bundleSha256: hash(bundle),
  host,
  hostSha256: hash(host),
  cases: [],
}
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
    // Each host operation settles for 100 ms; these six operations create a
    // history boundary longer than ProseMirror's 500 ms typing group delay.
    ...Array.from({ length: 6 }, () => assert('snapshot.text', f.pasted)),
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
  const input = join(output, f.name + '.input.json'),
    resultPath = join(output, f.name + '.result.json')
  writeFileSync(
    input,
    JSON.stringify({ source: f.source, operations }, null, 2),
  )
  const run = spawnSync(host, [bundle, 'scenario', input, resultPath], {
    encoding: 'utf8',
    timeout: 60000,
  })
  let result
  try {
    result = JSON.parse(readFileSync(resultPath))
  } catch {}
  const nativeSteps =
    result?.steps?.filter((s) => s.operation === 'nativeInput') ?? []
  evidence.cases.push({
    name: f.name,
    status: run.status,
    error: run.error?.message,
    stderr: run.stderr,
    failedStep: result?.steps?.find((s) => !s.passed),
    nativeSteps,
    passed:
      run.status === 0 &&
      result?.passed === true &&
      !result.final?.error &&
      !result.final?.diagnostics?.length &&
      !run.stderr?.includes('WKWebView:') &&
      nativeSteps.length === 1 &&
      nativeSteps.every(
        (s) =>
          s.result?.keyWindow &&
          s.result?.active &&
          s.result?.events?.some(
            (e) => e.type === 'keydown' && e.trusted && e.key === 'X',
          ),
      ),
  })
}
evidence.passed =
  evidence.cases.length === fixtures.length &&
  evidence.cases.every((c) => c.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(
  JSON.stringify(
    { ...evidence, cases: evidence.cases.map(({ nativeSteps, ...c }) => c) },
    null,
    2,
  ),
)
process.exitCode = evidence.passed ? 0 : 1
