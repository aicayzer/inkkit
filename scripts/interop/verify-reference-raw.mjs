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
const callbackOperations = new Set([
  'resolve',
  'export',
  'open',
  'contextMenu',
  'wikiResolve',
  'wikiOpen',
])
const callbackChecks = (events, allowed, phase) => [
  { operation: `${phase} callbacks present`, passed: events.length > 0 },
  ...events
    .filter((event) => callbackOperations.has(event.operation))
    .map((event) => ({
      operation: `${phase} ${event.operation} exact raw token`,
      raw: event.raw,
      passed: typeof event.raw === 'string' && allowed.includes(event.raw),
    })),
]
const eventSnapshots = (result) =>
  result.steps
    .filter((step) => step.operation === 'fileEvents')
    .map((step) => step.result)
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
      const [events, reopenedEvents] = eventSnapshots(result)
      // loadDocument retains the fixture log, so require new callbacks after reopen.
      const fresh = reopenedEvents.slice(events.length)
      const allowed = [wiki, named, path, tableWiki, tableNamed, tablePath]
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
      return [
        ...callbackChecks(events, allowed, 'before reopen'),
        ...callbackChecks(fresh, allowed, 'after reopen'),
        ...[
          ['wikiResolve', wiki],
          ['wikiResolve', tableWiki],
          ['resolve', named],
          ['resolve', path],
          ['resolve', tableNamed],
          ['resolve', tablePath],
        ].map(([operation, raw]) => ({
          operation: `fresh ${operation}`,
          raw,
          passed: fresh.some(
            (event) => event.operation === operation && event.raw === raw,
          ),
        })),
        ...required.map(([operation, raw]) => ({
          operation,
          raw,
          passed: events.some(
            (e) => e.operation === operation && e.raw === raw,
          ),
        })),
      ]
    },
  },
  {
    name: 'resize-marked-token-only',
    source: '**![Path photo|120](images/native.png)**\r\n\r\nTail\r\n',
    operations: [
      { op: 'fileState', ready: true },
      { op: 'fileResize', width: 150 },
      assert(
        'snapshot.text',
        '**![Path photo|150](images/native.png)**\r\n\r\nTail\r\n',
      ),
      { op: 'undo' },
      assert(
        'snapshot.text',
        '**![Path photo|120](images/native.png)**\r\n\r\nTail\r\n',
      ),
      { op: 'redo' },
      { op: 'fileState', ready: true },
      { op: 'fileEvents' },
      ...roundtrip('**![Path photo|150](images/native.png)**\r\n\r\nTail\r\n'),
      { op: 'fileState', ready: true },
      { op: 'fileEvents' },
    ],
    verify(result) {
      const [events, reopenedEvents] = eventSnapshots(result)
      const fresh = reopenedEvents.slice(events.length)
      const resized = '![Path photo|150](images/native.png)'
      return [
        ...callbackChecks(
          events,
          ['![Path photo|120](images/native.png)', resized],
          'before reopen',
        ),
        ...callbackChecks(fresh, [resized], 'after reopen'),
        ...[
          ['before reopen', events],
          ['after reopen', fresh],
        ].map(([phase, callbacks]) => ({
          operation: `${phase} resized resolve raw`,
          passed: callbacks.some(
            (event) => event.operation === 'resolve' && event.raw === resized,
          ),
        })),
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
  const contracts = result?.passed
    ? [
        ...(scenario.verify?.(result) ?? []),
        ...result.steps
          .filter((step) => ['undo', 'redo'].includes(step.operation))
          .map((step) => ({
            operation: `${step.operation} returned true`,
            passed: step.result === true,
          })),
      ]
    : []
  const assertions =
    result?.steps?.filter((step) => step.operation === 'assert').length ?? 0
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
      !run.error &&
      !run.signal &&
      run.stderr.trim() === '' &&
      assertions > 0 &&
      contracts.length > 0 &&
      result?.steps?.length === scenario.operations.length &&
      result.steps.every((step) => step.passed === true && !step.skipped) &&
      result?.passed === true &&
      result.final?.diagnostics?.length === 0 &&
      contracts.every((c) => c.passed),
  })
}
evidence.passed =
  evidence.installedProseMirror.length > 0 &&
  evidence.cases.length === 3 &&
  evidence.cases.every((c) => c.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = evidence.passed ? 0 : 1
