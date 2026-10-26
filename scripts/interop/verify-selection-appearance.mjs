import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'

// Run on a logged-in Mac. OUTPUT must be fresh. An optional mode subset
// allows formatted verification while native textarea behaviour is investigated.
const [archiveArg, outputArg, modesArg] = process.argv.slice(2)
if (!archiveArg || !outputArg)
  throw Error(
    'Usage: node scripts/interop/verify-selection-appearance.mjs ARCHIVE OUTPUT [formatted,source,txt]',
  )
const modes = (modesArg ?? 'formatted,source,txt').split(',')
if (
  !modes.length ||
  modes.some((mode) => !['formatted', 'source', 'txt'].includes(mode)) ||
  new Set(modes).size !== modes.length
)
  throw Error('Modes must be a comma-separated subset of formatted,source,txt')
const archive = resolve(archiveArg)
const output = resolve(outputArg)
if (existsSync(output))
  throw Error('Use a fresh output directory for immutable evidence')
mkdirSync(output, { recursive: true })
const script = dirname(fileURLToPath(import.meta.url))
const root = resolve(script, '../..')
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  })
const unpack = join(output, 'unpacked')
mkdirSync(unpack)
run('tar', ['-xzf', archive, '-C', unpack])
const fixture = join(output, 'fixture')
cpSync(join(script, 'selection'), fixture, { recursive: true })
const config = join(output, 'vite.config.mjs')
writeFileSync(
  config,
  `import {defineConfig} from ${JSON.stringify(join(root, 'node_modules/vite/dist/node/index.js'))};
import {viteSingleFile} from ${JSON.stringify(join(root, 'node_modules/vite-plugin-singlefile/dist/esm/index.js'))};
export default defineConfig({root:${JSON.stringify(fixture)},plugins:[viteSingleFile()],resolve:{alias:[{find:'@aicayzer/inkkit/core',replacement:${JSON.stringify(join(unpack, 'package/dist/core.js'))}},{find:'@aicayzer/inkkit/style.css',replacement:${JSON.stringify(join(unpack, 'package/dist/style.css'))}}]},build:{target:'safari26',modulePreload:false,cssCodeSplit:false}});`,
)
run(join(root, 'node_modules/.bin/vite'), ['build', '--config', config])
const bundle = join(fixture, 'dist/index.html')
if (/<script[^>]+\bsrc=|<link[^>]+\bhref=/i.test(readFileSync(bundle, 'utf8')))
  throw Error('Selection fixture is not self-contained')
const host = join(output, 'SelectionHost')
run('swiftc', [
  '-swift-version',
  '6',
  join(script, 'SelectionHost.swift'),
  '-o',
  host,
  '-framework',
  'AppKit',
  '-framework',
  'WebKit',
])
const execution = spawnSync(host, [bundle, output, modes.join(',')], {
  encoding: 'utf8',
  timeout: 90000,
})
writeFileSync(join(output, 'host.log'), execution.stdout + execution.stderr)
const cases = existsSync(join(output, 'native.json'))
  ? JSON.parse(readFileSync(join(output, 'native.json'), 'utf8'))
  : []
const evidence = {
  scope:
    'Window focus, native field focus, a second window and a host blur() in a real WKWebView, from the packed candidate. Native textarea paint is recorded, not asserted.',
  verification: {
    automaticFocusAndRange: 'not-run',
    formattedPaint: 'not-run',
  },
  modes,
  archive,
  archiveSha256: hash(archive),
  bundle,
  bundleSha256: hash(bundle),
  hostSha256: hash(host),
  hostSourceSha256: hash(join(script, 'SelectionHost.swift')),
  fixtureSourceSha256: hash(join(script, 'selection/main.ts')),
  fixtureHtmlSha256: hash(join(script, 'selection/index.html')),
  verifierSourceSha256: hash(fileURLToPath(import.meta.url)),
  // A copy without .git, such as a remote Mac's, cannot say which commit it holds.
  gitHead: (() => {
    try {
      return run('git', ['rev-parse', 'HEAD']).trim()
    } catch {
      return 'unavailable'
    }
  })(),
  artifacts: Object.fromEntries(
    readdirSync(output)
      .filter((name) => /\.(png|json|log)$/.test(name))
      .map((name) => [name, hash(join(output, name))]),
  ),
  cases,
}
const saveEvidence = () =>
  writeFileSync(
    join(output, 'evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
saveEvidence()
if (execution.status !== 0)
  throw Error(
    `Native verifier failed (${execution.status}): ${execution.stderr}`,
  )
if (cases.length !== modes.length * 6)
  throw Error('Incomplete native case matrix')
for (const result of cases) {
  if (!existsSync(result.snapshot) || !readFileSync(result.snapshot).length)
    throw Error(`Missing image: ${result.name}`)
  result.snapshotSha256 = hash(result.snapshot)
  const index = result.name.endsWith('second-editor') ? 1 : 0
  const selection = result.fixture.selections[index]
  const collapsedByEngine =
    result.fixture.mode !== 'formatted' && result.name.endsWith('native-field')
  if (
    (!collapsedByEngine &&
      !selection.selected.startsWith('Selection sentinel')) ||
    selection.geometry.width <= 0 ||
    selection.geometry.height <= 0
  )
    throw Error(`Invalid selected range: ${result.name}`)
  const active = /-(active|returned|second-editor)$/.test(result.name)
  if (selection.active !== active)
    throw Error(`Wrong automatic presentation state: ${result.name}`)
  const second = result.name.endsWith('second-editor')
  if (second && result.fixture.selections[0].active)
    throw Error('Both editors report active selection')
  // One page has one selection: only the editor that holds it paints.
  if (result.fixture.mode === 'formatted') {
    if (result.fixture.painted.length !== 1)
      throw Error(
        `Expected one painted selection, found ${result.fixture.painted.length}: ${result.name}`,
      )
    if (second && result.pixels.blue !== 0)
      throw Error('The first editor still paints after the second took over')
  }
  // WK snapshots may omit native textarea selection, even with valid offsets.
  // Only the custom formatted highlight has a snapshot paint assertion.
  if (
    result.fixture.mode === 'formatted' &&
    result.pixels[active ? 'red' : 'blue'] < 20
  )
    throw Error(`Formatted selection colour missing: ${result.name}`)
}
evidence.verification.automaticFocusAndRange = 'passed'
evidence.verification.formattedPaint = modes.includes('formatted')
  ? 'passed'
  : 'not-run'
saveEvidence()
console.log(
  JSON.stringify(
    {
      evidence: join(output, 'evidence.json'),
      cases: cases.length,
      nativeTextPaint: cases
        .filter((result) => result.fixture.mode !== 'formatted')
        .map(({ name, pixels }) => ({ name, pixels })),
    },
    null,
    2,
  ),
)
