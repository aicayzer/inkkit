import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [hostArgument, directoryArgument] = process.argv.slice(2)
if (!hostArgument || !directoryArgument)
  throw Error(
    'Usage: node scripts/interop/verify-input.mjs HOST OUTPUT_DIRECTORY',
  )
const host = resolve(hostArgument)
const directory = resolve(directoryArgument)
mkdirSync(directory, { recursive: true })
const bundle = join(directory, 'input-probe.html')
writeFileSync(
  bundle,
  `<!doctype html><title>Fixture input fidelity</title><script>
window.ready = true;
let loaded, selection;
window.interop = {
  run: input => ({passed: true, input, units: Array.from({length: input.source.length}, (_, i) => input.source.charCodeAt(i))}),
  load: (source, format) => { loaded = {source, format}; return true },
  select: value => { selection = value; return true },
  export: all => ({passed: true, loaded, selection: selection ?? null, all}),
  paste: clipboard => ({passed: true, loaded, clipboard})
};
</script>`,
)
const source = '\ufeffpre\r\nAe\u0301B\nkeep\rfinal\t"\\\u0000👩🏽‍💻'
const input = {
  source,
  format: 'md',
  selection: { text: '\ufeffselected', nested: ['\ufeffnested', '', null] },
  clipboard: { text: '\ufeffclipboard\r\n\u0000', html: '<p>\ufeffhtml</p>' },
  operations: [{ op: 'assert', equals: source }],
}
const units = Array.from({ length: source.length }, (_, i) =>
  source.charCodeAt(i),
)
const results = []
for (const [name, mode, text, expected] of [
  [
    'literal',
    'scenario',
    JSON.stringify(input),
    { passed: true, input, units },
  ],
  [
    'escaped',
    'scenario',
    JSON.stringify(input).replaceAll('\ufeff', '\\ufeff'),
    { passed: true, input, units },
  ],
  [
    'export',
    'export',
    JSON.stringify(input),
    {
      passed: true,
      loaded: { source, format: 'md' },
      selection: null,
      all: true,
    },
  ],
  [
    'selection',
    'partial',
    JSON.stringify(input),
    {
      passed: true,
      loaded: { source, format: 'md' },
      selection: input.selection,
      all: false,
    },
  ],
  [
    'paste',
    'paste',
    JSON.stringify(input),
    {
      passed: true,
      loaded: { source, format: 'md' },
      clipboard: input.clipboard,
    },
  ],
  ['invalid', 'scenario', '{"source":', null],
]) {
  const inputPath = join(directory, name + '.input.json')
  const outputPath = join(directory, name + '.result.json')
  writeFileSync(inputPath, text)
  rmSync(outputPath, { force: true })
  const run = spawnSync(host, [bundle, mode, inputPath, outputPath], {
    encoding: 'utf8',
    timeout: 20_000,
  })
  writeFileSync(
    join(directory, name + '.log'),
    (run.stdout ?? '') + (run.stderr ?? ''),
  )
  assert.ifError(run.error)
  if (expected) {
    assert.equal(run.status, 0, `${name}: ${run.stderr}`)
    assert.deepEqual(
      JSON.parse(readFileSync(outputPath, 'utf8')),
      expected,
      name,
    )
  } else {
    assert.notEqual(run.status, 0, 'Malformed JSON must fail')
    assert.match(run.stderr, /JSON|3840/)
  }
  results.push({ name, mode, passed: true })
}
const evidence = {
  hostSha256: createHash('sha256').update(readFileSync(host)).digest('hex'),
  testedAt: new Date().toISOString(),
  results,
}
writeFileSync(
  join(directory, 'evidence.json'),
  JSON.stringify(evidence, null, 2) + '\n',
)
console.log(JSON.stringify(evidence, null, 2))
