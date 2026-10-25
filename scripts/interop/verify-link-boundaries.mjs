import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [archiveArg, bundleArg, outputArg, hostArg] = process.argv.slice(2)
if (!archiveArg || !bundleArg || !outputArg || !hostArg)
  throw Error('Usage: verify-link-boundaries.mjs ARCHIVE BUNDLE OUTPUT HOST')
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
const assertion = (path, equals, name) => ({
  op: 'assert',
  path,
  equals,
  ...(name ? { name } : {}),
})
const keys = (text) => ({
  op: 'nativeInput',
  keys: [...text].map((characters) => ({
    keyCode:
      { s: 1, n: 45, e: 14, w: 13, ' ': 49, t: 17, a: 0, i: 34, l: 37 }[
        characters
      ] ?? 0,
    characters,
  })),
})
const anchors = (text) => [
  { op: 'dom', selector: 'a', name: 'anchors' },
  assertion('count', 1, 'anchors'),
  assertion('nodes.0.text', text, 'anchors'),
  assertion(
    'nodes.0.attributes.href',
    text.startsWith('https://') ? text : 'docs',
    'anchors',
  ),
]
const prefix = 'Untouched &copy; Café 😀\r\n\r\nSee '
const suffix = ' tail\r\n\r\nLast é 中文\r\n'
const cases = []
for (const [name, link, label, definition] of [
  ['inline', '[docs](docs)', 'docs', ''],
  ['reference', '[docs][ref]', 'docs', '\r\n\r\n[ref]: docs\r\n'],
  ['angle', '<https://example.com>', 'https://example.com', ''],
  ['bare', 'https://example.com', 'https://example.com', ''],
]) {
  const source = prefix + link + suffix + definition
  cases.push({
    name: name + '-end',
    source,
    label,
    offset: label.length,
    expected: prefix + link + 's' + suffix + definition,
    anchor: label + (name === 'bare' ? 's' : ''),
    typing: [keys('s')],
  })
}
for (const [name, link, expected] of [
  ['inline', '[docs](docs)', '[doscs](docs)'],
  ['reference', '[docs][ref]', '[doscs][ref]'],
]) {
  const definition = name === 'reference' ? '\r\n\r\n[ref]: docs\r\n' : ''
  cases.push({
    name: name + '-interior',
    source: prefix + link + suffix + definition,
    label: 'docs',
    offset: 2,
    expected: prefix + expected + suffix + definition,
    anchor: 'doscs',
    typing: [keys('s')],
  })
}
for (const batched of [false, true]) {
  cases.push({
    name: batched ? 'explicit-key-batch' : 'explicit-successive',
    source: prefix + 'here' + suffix,
    label: 'here',
    offset: 4,
    expected: prefix + 'here[new](docs) tails' + suffix,
    anchor: 'new',
    format: true,
    typing: batched
      ? [keys('new tail'), keys('s')]
      : [keys('n'), keys('e'), keys('w'), ...anchors('new'), keys(' tails')],
  })
}
for (const test of cases) {
  const operations = [
    { op: 'select', text: test.label, from: test.offset, to: test.offset },
    ...(test.format
      ? [{ op: 'format', command: 'link', options: { destination: 'docs' } }]
      : []),
    ...test.typing,
    assertion('snapshot.text', test.expected),
    ...anchors(test.anchor),
    { op: 'textSnapshot', name: 'readable' },
    assertion(
      'text',
      'Untouched © Café 😀\nSee ' +
        (test.format
          ? 'herenew tails'
          : test.name.endsWith('-interior')
            ? 'doscs'
            : test.label + 's') +
        ' tail\nLast é 中文',
      'readable',
    ),
    assertion('error', null),
    assertion('diagnostics', []),
    { op: 'save', name: 'saved' },
    assertion('text', test.expected, 'saved'),
    { op: 'undo', name: 'undone' },
    assertion('', true, 'undone'),
    ...(!test.format ? [assertion('snapshot.text', test.source)] : []),
    { op: 'redo', name: 'redone' },
    assertion('', true, 'redone'),
    assertion('snapshot.text', test.expected),
    assertion('error', null),
    assertion('diagnostics', []),
    { op: 'reopen', name: 'reopened' },
    assertion('text', test.expected, 'reopened'),
    ...anchors(test.anchor),
  ]
  const inputPath = join(output, test.name + '.input.json')
  const resultPath = join(output, test.name + '.result.json')
  writeFileSync(
    inputPath,
    JSON.stringify({ source: test.source, operations }, null, 2),
  )
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
    name: test.name,
    status: run.status,
    signal: run.signal,
    error: run.error?.message,
    stderr: run.stderr,
    failedStep: result?.steps?.find((step) => !step.passed),
    nativeSteps,
    passed:
      run.status === 0 &&
      result?.passed === true &&
      !run.stderr.includes('WKWebView:') &&
      !result.final?.error &&
      !result.final?.diagnostics?.length &&
      nativeSteps.length > 0 &&
      nativeSteps.every(
        (step) =>
          step.result?.keyWindow &&
          step.result?.active &&
          step.result.events?.some(
            (event) => event.type === 'keydown' && event.trusted,
          ) &&
          step.result.events?.some(
            (event) => event.type === 'input' && event.trusted,
          ),
      ),
  })
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
