import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [archiveArg, bundleArg, outputArg, hostArg] = process.argv.slice(2)
if (!archiveArg || !bundleArg || !outputArg || !hostArg)
  throw Error('Usage: verify-find-delete.mjs ARCHIVE BUNDLE OUTPUT HOST')
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
      nativeSteps.length === 2 &&
      nativeSteps.every(
        (step) =>
          step.result?.keyWindow &&
          step.result?.active &&
          step.result.events?.some(
            (event) => event.type === 'keydown' && event.trusted,
          ),
      ) &&
      nativeSteps[1]?.result?.events?.filter(
        (event) => event.type === 'keydown' && event.trusted,
      ).length === 2 &&
      nativeSteps[1]?.result?.events?.filter(
        (event) => event.type === 'keydown',
      )[1]?.collapsed === true,
  })
}
const source = 'needle café 😀 end.\r\n\r\nTwo needle end.\r\n'
for (const occurrence of [1, 2]) {
  for (const direction of ['left', 'right']) {
    for (const deletion of ['backward', 'forward']) {
      const offset = source.indexOf(
        'needle',
        occurrence === 1 ? 0 : source.indexOf('needle') + 1,
      )
      const caret = offset + (direction === 'right' ? 6 : 0)
      const removed = caret - (deletion === 'backward' ? 1 : 0)
      const expected =
        removed < 0
          ? source
          : source.slice(0, removed) + source.slice(removed + 1)
      runCase(`match-${occurrence}-${direction}-${deletion}`, {
        source,
        operations: [
          { op: 'select', text: 'needle', from: 0, to: 0 },
          native(123, '\uf702'),
          {
            op: 'nativeInput',
            focus: false,
            find: 'needle',
            findCount: occurrence,
            keys: [
              {
                keyCode: direction === 'left' ? 123 : 124,
                characters: direction === 'left' ? '\uf702' : '\uf703',
              },
              {
                keyCode: deletion === 'backward' ? 51 : 117,
                characters: deletion === 'backward' ? '\u007f' : '\uf728',
              },
            ],
          },
          { op: 'assert', path: 'snapshot.text', equals: expected },
          { op: 'assert', path: 'selection', equals: '' },
          { op: 'assert', path: 'error', equals: null },
          { op: 'assert', path: 'diagnostics', equals: [] },
          { op: 'save', name: 'saved' },
          { op: 'assert', name: 'saved', path: 'text', equals: expected },
          { op: 'undo' },
          { op: 'assert', path: 'snapshot.text', equals: source },
          { op: 'redo' },
          { op: 'assert', path: 'snapshot.text', equals: expected },
          { op: 'assert', path: 'error', equals: null },
          { op: 'assert', path: 'diagnostics', equals: [] },
          { op: 'reopen', name: 'reopened' },
          { op: 'assert', name: 'reopened', path: 'text', equals: expected },
        ],
      })
    }
  }
}
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
