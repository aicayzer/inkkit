import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
if (args.length !== 4)
  throw Error('Usage: verify-source-redo.mjs ARCHIVE BUNDLE OUTPUT HOST')
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
for (const prior of [false, true]) {
  const source = 'Café 😀\r\n\r\nTail\r\n'
  const retained = prior ? 'Café 😀\r\n\r\nTailX\r\n' : source
  const operations = []
  if (prior)
    operations.push(
      { op: 'select', text: 'Café 😀', from: 0, to: 0 },
      { op: 'insertText', text: 'X' },
    )
  operations.push(
    { op: 'select', text: 'Tail', from: 0, to: 0 },
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
  const input = join(output, name + '.input.json')
  const resultPath = join(output, name + '.result.json')
  writeFileSync(input, JSON.stringify({ source, operations }, null, 2))
  const run = spawnSync(host, [bundle, 'scenario', input, resultPath], {
    encoding: 'utf8',
    timeout: 60000,
  })
  let result
  try {
    result = JSON.parse(readFileSync(resultPath))
  } catch {}
  const nativeSteps =
    result?.steps?.filter((step) => step.operation === 'nativeInput') ?? []
  const trusted =
    nativeSteps.length === 3 &&
    nativeSteps.every(
      (step) =>
        step.result?.keyWindow &&
        step.result?.active &&
        step.result?.events?.some(
          (event) => event.type === 'keydown' && event.trusted,
        ),
    )
  evidence.cases.push({
    name,
    status: run.status,
    signal: run.signal,
    error: run.error?.message,
    stderr: run.stderr,
    nativeSteps,
    trusted,
    failedStep: result?.steps?.find((step) => !step.passed),
    diagnostics: result?.final?.diagnostics,
    passed:
      run.status === 0 &&
      result?.passed === true &&
      trusted &&
      !result?.final?.error &&
      result?.final?.diagnostics?.length === 0,
  })
}
evidence.passed = evidence.cases.every((test) => test.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = evidence.passed ? 0 : 1
