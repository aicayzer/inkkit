import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { platform, release, arch, cpus } from 'node:os'

const [archiveArg, bundleArg, outputArg, hostArg] = process.argv.slice(2)
if (!archiveArg || !bundleArg || !outputArg || !hostArg)
  throw Error('Usage: verify-long-source.mjs ARCHIVE BUNDLE OUTPUT HOST')
const [archive, bundle, output, host] = [
  archiveArg,
  bundleArg,
  outputArg,
  hostArg,
].map((path) => resolve(path))
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const consumer = JSON.parse(
  readFileSync(join(dirname(bundle), 'consumer-evidence.json'), 'utf8'),
)
if (
  consumer.tarballSha256 !== hash(archive) ||
  consumer.bundleSha256 !== hash(bundle)
)
  throw Error('Consumer evidence does not identify this archive and bundle')
mkdirSync(output, { recursive: true })
const source =
  Array.from(
    { length: 10_000 },
    (_, index) => `Paragraph ${index} café 😀 has ordinary text.`,
  ).join('\r\n\r\n') + '\r\n'
const pasted = Array.from(
  { length: 500 },
  (_, index) => `Pasted ${index} 雪.`,
).join('\n\n')
// Keep the insertion before the first CRLF so textarea and source offsets agree.
const position = 20
const assert = (path, equals, name) => ({
  op: 'assert',
  path,
  equals,
  ...(name ? { name } : {}),
})
const evidence = {
  ...consumer,
  archive,
  bundle,
  host,
  hostSha256: hash(host),
  machine: {
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
  },
  document: {
    paragraphs: 10_000,
    bytes: Buffer.byteLength(source),
    lineEndings: 'CRLF',
    samplesPerPhase: 3,
  },
  method:
    'Trusted AppKit keydown to the next frame and timer in WKWebView; each phase uses a fresh document. Paste is a facade operation, followed by measured trusted typing.',
  gate: 'Trusted native input and exact saved/reopened bytes. Timing is reported separately; a correctness pass does not satisfy the performance target.',
  performanceTargetMs: 35,
  cases: [],
}
for (const phase of ['entry', 'undo', 'redo', 'paste']) {
  const operations = [
    { op: 'editingMode', mode: 'source' },
    { op: 'selectSourceRange', from: position },
  ]
  if (phase === 'undo' || phase === 'redo') {
    operations.push({ op: 'insertText', text: 'prepared' }, { op: 'undo' })
    if (phase === 'redo') operations.push({ op: 'redo' })
  }
  if (phase === 'paste')
    operations.push({ op: 'pasteAsPlainText', text: pasted })
  operations.push(
    { op: 'selectSourceRange', from: position },
    { op: 'snapshot', name: 'before' },
  )
  for (let sample = 0; sample < 3; sample++)
    operations.push({
      op: 'nativeInput',
      keyCode: 7,
      characters: 'x',
      measure: true,
    })
  operations.push(
    { op: 'snapshot', name: 'typed' },
    { op: 'save' },
    { op: 'reopen' },
    {
      op: 'assert',
      path: 'snapshot.text',
      equalsFrom: { name: 'typed', path: 'text' },
    },
    assert('error', null),
  )
  const input = join(output, `${phase}.input.json`)
  const resultPath = join(output, `${phase}.result.json`)
  writeFileSync(input, JSON.stringify({ source, operations }))
  const run = spawnSync(host, [bundle, 'scenario', input, resultPath], {
    encoding: 'utf8',
    timeout: 90_000,
  })
  let result
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'))
  } catch {}
  const steps =
    result?.steps?.filter((step) => step.operation === 'nativeInput') ?? []
  const samples = steps.flatMap((step) => step.result?.keyToFrame ?? [])
  const ordered = [...samples].sort((a, b) => a - b)
  const median = ordered[1] ?? null
  const snapshots =
    result?.steps?.filter((step) => step.operation === 'snapshot') ?? []
  const before = snapshots[0]?.result?.text
  const typed = snapshots[1]?.result?.text
  const exact =
    typeof before === 'string' &&
    typed === before.slice(0, position) + 'xxx' + before.slice(position)
  const passed =
    run.status === 0 &&
    result?.passed === true &&
    !result?.pageErrors?.length &&
    !run.stderr.includes('WKWebView page error:') &&
    samples.length === 3 &&
    samples.every(Number.isFinite) &&
    exact &&
    steps.every(
      (step) =>
        step.result?.keyWindow &&
        step.result?.active &&
        step.result.events.some(
          (event) => event.type === 'input' && event.trusted,
        ),
    )
  evidence.cases.push({
    phase,
    passed,
    status: run.status,
    samples,
    median,
    under35ms: median !== null && median < 35,
    exact,
    errors: run.stderr,
    failures: result?.steps?.filter((step) => !step.passed),
  })
}
evidence.passed = evidence.cases.every((entry) => entry.passed)
evidence.performanceTargetMet = evidence.cases.every((entry) => entry.under35ms)
writeFileSync(
  join(output, 'evidence.json'),
  JSON.stringify(evidence, null, 2) + '\n',
)
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = evidence.passed ? 0 : 1
