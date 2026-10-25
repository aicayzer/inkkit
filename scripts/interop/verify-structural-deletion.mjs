import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
if (args.length !== 4)
  throw Error(
    'Usage: verify-structural-deletion.mjs ARCHIVE BUNDLE OUTPUT HOST',
  )
const [archive, bundle, output, host] = args.map((path) => resolve(path))
mkdirSync(output, { recursive: true })
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const evidence = {
  archive,
  archiveSha256: hash(archive),
  bundle,
  bundleSha256: hash(bundle),
  host,
  hostSha256: hash(host),
  cases: [],
}
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
  const inputPath = join(output, name + '.input.json')
  const resultPath = join(output, name + '.result.json')
  writeFileSync(inputPath, JSON.stringify(input, null, 2))
  const run = spawnSync(host, [bundle, 'scenario', inputPath, resultPath], {
    encoding: 'utf8',
    timeout: 60000,
  })
  let result
  try {
    result = JSON.parse(readFileSync(resultPath))
  } catch {}
  const nativeSteps =
    result?.steps?.filter((step) => step.operation === 'nativeInput') ?? []
  const keys =
    nativeSteps[0]?.result?.events?.filter(
      (event) => event.type === 'keydown',
    ) ?? []
  const passed =
    run.status === 0 &&
    result?.passed === true &&
    !result.final?.error &&
    !result.final?.diagnostics?.length &&
    !run.stderr.includes('WKWebView:') &&
    nativeSteps.length === 1 &&
    nativeSteps[0]?.result?.keyWindow &&
    nativeSteps[0]?.result?.active &&
    keys.length === 3 &&
    keys.every(
      (event) =>
        event.trusted && event.key === 'Backspace' && event.collapsed === true,
    )
  evidence.cases.push({
    name,
    passed: Boolean(passed),
    status: run.status,
    signal: run.signal,
    error: run.error?.message,
    stderr: run.stderr,
    failedStep: result?.steps?.find((step) => !step.passed),
    final: result?.final,
    nativeSteps,
  })
}
evidence.passed = evidence.cases.every((test) => test.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(
  JSON.stringify(
    {
      ...evidence,
      cases: evidence.cases.map(({ final, nativeSteps, ...test }) => test),
    },
    null,
    2,
  ),
)
process.exitCode = evidence.passed ? 0 : 1
