import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'

if (process.argv.length !== 6)
  throw Error('Usage: verify-reference-raw.mjs ARCHIVE BUNDLE OUTPUT HOST')
const [archive, bundle, output, host] = process.argv
  .slice(2)
  .map((path) => resolve(path))
mkdirSync(output, { recursive: true })
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const evidence = {
  provisional: true,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  surface:
    'Packed consumer in real WKWebView; programmatic facade and DOM events',
  archiveSha256: hash(archive),
  bundleSha256: hash(bundle),
  hostSha256: hash(host),
  fixtureSha256: hash('scripts/interop/consumer/fixtures.ts'),
  installedModulesSha256: hash('node_modules/.modules.yaml'),
  installedProseMirror: readdirSync('node_modules/.pnpm').filter((name) =>
    name.startsWith('prosemirror-view@1.42.6_patch_hash=808819'),
  ),
  cases: [],
}
const assert = (path, equals, extra = {}) => ({
  op: 'assert',
  path,
  equals,
  ...extra,
})
const roundtrip = (source) => [
  assert('snapshot.text', source),
  { op: 'save', name: 'saved' },
  assert('text', source, { name: 'saved' }),
  { op: 'reopen' },
  assert('snapshot.text', source),
  assert('error', null),
  assert('diagnostics', []),
]
const wiki = '[[Notes/旅行#Résumé|A&amp;B]]'
const named = '![[Photo|120]]'
const path = '![P&amp;Q|120](images/native.png)'
const tableWiki = '[[Notes/旅行\\|A&amp;B]]'
const tableNamed = '![[Photo\\|120]]'
const tablePath = '![P&amp;Q\\|120](images/native.png)'
const source =
  'Before ' +
  wiki +
  '.\r\n\r\n' +
  named +
  '\r\n\r\n' +
  path +
  '\r\n\r\n| Wiki | Named | Path |\r\n| --- | --- | --- |\r\n| ' +
  tableWiki +
  ' | ' +
  tableNamed +
  ' | ' +
  tablePath +
  ' |\r\n'
const scenarios = [
  {
    name: 'raw-adapter-contract',
    source,
    operations: [
      { op: 'fileState', ready: true },
      { op: 'domKeyDown', selector: '.inkkit-wiki-link', key: 'Enter' },
      { op: 'click', selector: '.inkkit-image button' },
      { op: 'fileContextMenu', selector: '.inkkit-image' },
      {
        op: 'click',
        selector: '.inkkit-image-block + .inkkit-image-block .inkkit-file-open',
      },
      {
        op: 'fileContextMenu',
        selector: '.inkkit-image-block + .inkkit-image-block .inkkit-image',
      },
      { op: 'domKeyDown', selector: 'td .inkkit-wiki-link', key: 'Enter' },
      { op: 'click', selector: 'td .inkkit-file-open' },
      { op: 'fileContextMenu', selector: 'td .inkkit-image' },
      { op: 'export' },
      { op: 'fileEvents', name: 'callbacks' },
      ...roundtrip(source),
      { op: 'fileState', ready: true },
      { op: 'fileEvents', name: 'reopenedCallbacks' },
    ],
    verify(result) {
      const events = result.steps.find(
        (s) => s.operation === 'fileEvents',
      ).result
      const required = [
        ['wikiResolve', wiki],
        ['wikiOpen', wiki],
        ['resolve', named],
        ['resolve', path],
        ['resolve', tableNamed],
        ['resolve', tablePath],
        ['wikiResolve', tableWiki],
        ['open', named],
        ['open', path],
        ['contextMenu', path],
        ['open', tableNamed],
        ['contextMenu', tableNamed],
        ['wikiOpen', tableWiki],
        ['contextMenu', named],
        ['export', named],
        ['export', path],
        ['export', tableNamed],
        ['export', tablePath],
      ]
      return required.map(([operation, raw]) => ({
        operation,
        raw,
        passed: events.some((e) => e.operation === operation && e.raw === raw),
      }))
    },
  },
  {
    name: 'resize-marked-token-only',
    source: '**' + named + '**\r\n\r\nTail\r\n',
    operations: [
      { op: 'fileState', ready: true },
      { op: 'fileResize', width: 150 },
      assert('snapshot.text', '**![[Photo|150]]**\r\n\r\nTail\r\n'),
      { op: 'undo' },
      assert('snapshot.text', '**' + named + '**\r\n\r\nTail\r\n'),
      { op: 'redo' },
      ...roundtrip('**![[Photo|150]]**\r\n\r\nTail\r\n'),
      { op: 'fileState', ready: true },
      { op: 'fileEvents' },
    ],
    verify(result) {
      const events =
        result.steps.findLast((s) => s.operation === 'fileEvents')?.result ?? []
      return [
        {
          operation: 'resized resolve raw',
          passed: events.some(
            (e) => e.operation === 'resolve' && e.raw === '![[Photo|150]]',
          ),
        },
      ]
    },
  },
  {
    name: 'table-paste-and-invalid-range',
    source:
      '| A | B | C |\n| --- | --- | --- |\n| ' +
      tableNamed +
      ' | ' +
      tableWiki +
      ' | Tail |\n',
    operations: [
      { op: 'snapshot', name: 'before' },
      {
        op: 'selectTextRange',
        from: -1,
        to: 0,
        expectedError: 'invalid-range',
      },
      {
        op: 'assert',
        path: 'snapshot.text',
        equalsFrom: { name: 'before', path: 'text' },
      },
      { op: 'select', text: 'Tail', from: 0, to: 4 },
      { op: 'paste', input: { text: 'Replacement' } },
      assert(
        'snapshot.text',
        '| A | B | C |\n| --- | --- | --- |\n| ' +
          tableNamed +
          ' | ' +
          tableWiki +
          ' | Replacement |\n',
      ),
      { op: 'undo' },
      assert(
        'snapshot.text',
        '| A | B | C |\n| --- | --- | --- |\n| ' +
          tableNamed +
          ' | ' +
          tableWiki +
          ' | Tail |\n',
      ),
      { op: 'redo' },
      ...roundtrip(
        '| A | B | C |\n| --- | --- | --- |\n| ' +
          tableNamed +
          ' | ' +
          tableWiki +
          ' | Replacement |\n',
      ),
    ],
  },
]
for (const scenario of scenarios) {
  const input = join(output, scenario.name + '.input.json')
  const resultPath = join(output, scenario.name + '.result.json')
  writeFileSync(
    input,
    JSON.stringify(
      { files: true, source: scenario.source, operations: scenario.operations },
      null,
      2,
    ),
  )
  const run = spawnSync(host, [bundle, 'scenario', input, resultPath], {
    encoding: 'utf8',
    timeout: 60000,
  })
  let result
  try {
    result = JSON.parse(readFileSync(resultPath))
  } catch {}
  const contracts = result?.passed ? (scenario.verify?.(result) ?? []) : []
  evidence.cases.push({
    name: scenario.name,
    status: run.status,
    stderr: run.stderr,
    error: run.error?.message,
    assertions:
      result?.steps?.filter((s) => s.operation === 'assert').length ?? 0,
    diagnostics: result?.final?.diagnostics,
    failedStep: result?.steps?.find((s) => !s.passed),
    contracts,
    passed:
      run.status === 0 &&
      result?.passed === true &&
      result.final?.diagnostics?.length === 0 &&
      contracts.every((c) => c.passed),
  })
}
evidence.passed =
  evidence.installedProseMirror.length > 0 &&
  evidence.cases.every((c) => c.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = evidence.passed ? 0 : 1
