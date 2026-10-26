import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [archiveArg, bundleArg, outputArg, hostArg] = process.argv.slice(2)
if (!archiveArg || !bundleArg || !outputArg || !hostArg)
  throw Error('Usage: verify-link-typing.mjs ARCHIVE BUNDLE OUTPUT HOST')
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
// US keyboard key codes for the characters these cases type.
const codes = {
  a: 0,
  s: 1,
  d: 2,
  g: 5,
  x: 7,
  w: 13,
  e: 14,
  t: 17,
  u: 32,
  i: 34,
  l: 37,
  n: 45,
  ' ': 49,
}
const keys = (text) => ({
  op: 'nativeInput',
  keys: [...text].map((characters) => {
    if (!(characters in codes)) throw Error(`No key code for ${characters}`)
    return { keyCode: codes[characters], characters }
  }),
})
const compose = (...steps) => ({ op: 'nativeInput', compose: steps })
const anchors = (texts) => [
  { op: 'dom', selector: 'a', name: 'anchors' },
  assertion('count', texts.length, 'anchors'),
  ...texts.map((text, index) =>
    assertion(`nodes.${index}.text`, text, 'anchors'),
  ),
]
const head = 'Untouched &copy; Café 😀\r\n\r\nSee '
const tail = ' tail\r\n\r\nLast é 中文\r\n'
const definition = '\r\n\r\n[ref]: docs\r\n'
const sushi = ['す', 'すし', '寿司']
// [name, link, selection in the label, typing, saved link, link texts shown]
const cases = [
  ['inline-end', '[docs](docs)', [4], [keys('s')], '[docs](docs)s', ['docs']],
  ['reference-end', '[docs][ref]', [4], [keys('s')], '[docs][ref]s', ['docs']],
  [
    'angle-end',
    '<https://example.com>',
    [19],
    [keys('s')],
    '<https://example.com>s',
    ['https://example.com'],
  ],
  [
    'bare-end',
    'https://example.com',
    [19],
    [keys('s')],
    'https://example.coms',
    ['https://example.coms'],
  ],
  [
    'inline-interior',
    '[docs](docs)',
    [2],
    [keys('s')],
    '[doscs](docs)',
    ['doscs'],
  ],
  [
    'inline-replace-label',
    '[docs](docs)',
    [0, 4],
    [keys('new guide')],
    '[new guide](docs)',
    ['new guide'],
  ],
  [
    'reference-replace-label',
    '[docs][ref]',
    [0, 4],
    [keys('new')],
    '[new][ref]',
    ['new'],
  ],
  [
    'explicit-successive',
    'here',
    [4],
    [keys('n'), keys('e'), keys('w'), keys(' tail'), keys('s')],
    'here[new](docs) tails',
    ['new'],
    true,
  ],
  [
    'explicit-batch',
    'here',
    [4],
    [keys('new tail'), keys('s')],
    'here[new](docs) tails',
    ['new'],
    true,
  ],
  [
    'compose-end',
    '[docs](docs)',
    [4],
    [compose(...sushi), keys('s')],
    '[docs](docs)寿司s',
    ['docs'],
  ],
  [
    'compose-interior',
    '[docs](docs)',
    [2],
    [compose(...sushi)],
    '[do寿司cs](docs)',
    ['do寿司cs'],
  ],
  [
    'compose-explicit',
    'here',
    [4],
    [compose(...sushi), keys('s')],
    'here[寿司s](docs)',
    ['寿司s'],
    true,
  ],
  [
    'compose-replace-label',
    '[docs](docs)',
    [0, 4],
    [compose(...sushi)],
    '[寿司](docs)',
    ['寿司'],
  ],
]
for (const [name, link, [from, to], typing, written, shown, start] of cases) {
  // The label as the editor shows it, where the selection is made.
  const text = /^\[([^\]]*)\]/.exec(link)?.[1] ?? link.replace(/^<|>$/g, '')
  const definitions = link.endsWith('[ref]') ? definition : ''
  const source = head + link + tail + definitions
  const expected = head + written + tail + definitions
  const operations = [
    { op: 'select', text, from, to: to ?? from },
    ...(start
      ? [{ op: 'format', command: 'link', options: { destination: 'docs' } }]
      : []),
    ...typing,
    assertion('snapshot.text', expected),
    ...anchors(shown),
    assertion('error', null),
    assertion('diagnostics', []),
    { op: 'save', name: 'saved' },
    assertion('text', expected, 'saved'),
    { op: 'undo', name: 'undone' },
    assertion('', true, 'undone'),
    { op: 'redo', name: 'redone' },
    assertion('', true, 'redone'),
    assertion('snapshot.text', expected),
    { op: 'reopen', name: 'reopened' },
    assertion('text', expected, 'reopened'),
    ...anchors(shown),
  ]
  const inputPath = join(output, name + '.input.json')
  const resultPath = join(output, name + '.result.json')
  writeFileSync(inputPath, JSON.stringify({ source, operations }, null, 2))
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
  const trusted = (step, type) =>
    step.result?.events?.some((event) => event.type === type && event.trusted)
  evidence.cases.push({
    name,
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
      nativeSteps.length === typing.length &&
      nativeSteps.every(
        (step) =>
          step.result?.keyWindow &&
          step.result?.active &&
          trusted(step, 'input') &&
          (trusted(step, 'keydown') || trusted(step, 'compositionend')),
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
