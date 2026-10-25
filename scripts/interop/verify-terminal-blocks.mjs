import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [archiveArg, bundleArg, outputArg, hostArg] = process.argv.slice(2)
if (!archiveArg || !bundleArg || !outputArg || !hostArg)
  throw Error('Usage: verify-terminal-blocks.mjs ARCHIVE BUNDLE OUTPUT HOST')
const [archive, bundle, output, host] = [
  archiveArg,
  bundleArg,
  outputArg,
  hostArg,
].map((path) => resolve(path))
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
const native = (keyCode, characters, extra = {}) => ({
  op: 'nativeInput',
  keyCode,
  characters,
  ...extra,
})
const cases = [
  ['final-divider', 'Text\n\n---', 'TextX\n\n---'],
  ['sole-divider', '---', '---\n\nX\n'],
  [
    'final-image',
    'Text\n\n![Example](asset:example)',
    'Text\n\n![Example](asset:example)\n\nX\n',
  ],
  ['ordinary-paragraph', 'Text\n\nLast', 'Text\n\nLastX'],
  [
    'final-diagram',
    'Text\n\n```mermaid\ngraph TD; A-->B\n```',
    'Text\n\n```mermaid\ngraph TD; A-->BX\n```',
  ],
  ['crlf-unicode-divider', 'Café 😀\r\n\r\n***\r\n', 'Café 😀X\r\n\r\n***\r\n'],
]
const runCase = (name, input) => {
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
  evidence.cases.push({
    name,
    status: run.status,
    signal: run.signal,
    error: run.error?.message,
    stderr: run.stderr,
    diagnostics: result?.final?.diagnostics ?? [],
    failedStep: result?.steps?.find((step) => !step.passed),
    nativeSteps,
    passed:
      run.status === 0 &&
      result?.passed === true &&
      !run.stderr?.includes('WKWebView:') &&
      !result.final?.error &&
      !result.final?.diagnostics?.length &&
      nativeSteps.length > 0 &&
      nativeSteps.every(
        (step) =>
          step.result?.keyWindow &&
          step.result?.active &&
          step.result.events?.some(
            (event) => event.type === 'keydown' && event.trusted,
          ),
      ),
  })
}
for (const [label, source, expected] of cases) {
  for (const method of ['load', 'replace']) {
    runCase(method + '-' + label, {
      source: 'Original',
      operations: [
        method === 'load'
          ? { op: 'load', source }
          : { op: 'replaceSource', text: source },
        { op: 'assert', path: 'snapshot.text', equals: source },
        native(7, 'X', { shiftKey: true }),
        { op: 'assert', path: 'snapshot.text', equals: expected },
        { op: 'undo' },
        { op: 'assert', path: 'snapshot.text', equals: source },
        { op: 'redo' },
        { op: 'assert', path: 'snapshot.text', equals: expected },
        { op: 'save', name: 'saved' },
        { op: 'assert', name: 'saved', path: 'text', equals: expected },
        { op: 'reopen', name: 'reopened' },
        { op: 'assert', name: 'reopened', path: 'text', equals: expected },
      ],
    })
  }
}
runCase('native-navigation-delete', {
  source: 'Hello.\n',
  operations: [
    { op: 'select', text: 'Hello.', from: 6, to: 6 },
    native(7, 'x'),
    { op: 'assert', path: 'snapshot.text', equals: 'Hello.x\n' },
    {
      op: 'nativeInput',
      keys: [
        { keyCode: 123, characters: '\uf702' },
        { keyCode: 117, characters: '\uf728' },
      ],
    },
    { op: 'assert', path: 'snapshot.text', equals: 'Hello.\n' },
    { op: 'undo' },
    { op: 'assert', path: 'snapshot.text', equals: 'Hello.x\n' },
    { op: 'save', name: 'saved' },
    { op: 'reopen', name: 'reopened' },
    { op: 'assert', name: 'reopened', path: 'text', equals: 'Hello.x\n' },
  ],
})
evidence.passed = evidence.cases.every((test) => test.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(
  JSON.stringify(
    {
      ...evidence,
      cases: evidence.cases.map(({ nativeSteps, ...test }) => test),
    },
    null,
    2,
  ),
)
process.exitCode = evidence.passed ? 0 : 1
