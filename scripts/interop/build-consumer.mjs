import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const script = dirname(fileURLToPath(import.meta.url))
if (!process.argv[2])
  throw Error(
    'Usage: build-consumer.mjs CANDIDATE_ARCHIVE [OUTPUT_DIRECTORY] [core]',
  )
const tarball = resolve(process.argv[2])
const destination = resolve(process.argv[3] ?? '_local/interop/consumer')
// `core` builds the consumer against the core entry, without Pele or DOMPurify.
const core = process.argv[4] === 'core'
const archive = await readFile(tarball)
const tarballSha256 = createHash('sha256').update(archive).digest('hex')
const consumerTarball = join(destination, `inkkit-${tarballSha256}.tgz`)
await mkdir(destination, { recursive: true })
await writeFile(consumerTarball, archive)
await writeFile(
  join(destination, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies: { '@aicayzer/inkkit': `file:${consumerTarball}` },
    devDependencies: { vite: '8.3.3', 'vite-plugin-singlefile': '2.3.3' },
  }),
)
for (const filename of [
  'main.ts',
  'fixtures.ts',
  'history-clock.mjs',
  'index.html',
  'vite.config.mjs',
])
  await copyFile(
    join(script, 'consumer', filename),
    join(destination, filename),
  )
execFileSync(
  'npm',
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ],
  { cwd: destination, stdio: 'inherit' },
)
execFileSync(join(destination, 'node_modules/.bin/vite'), ['build'], {
  cwd: destination,
  stdio: 'inherit',
  env: { ...process.env, INKKIT_CONSUMER_ENTRY: core ? 'core' : '' },
})
const html = await readFile(join(destination, 'dist/index.html'), 'utf8')
if (/<script[^>]+\bsrc=|<link[^>]+\bhref=/i.test(html))
  throw Error('Consumer bundle is not self-contained')
const { version } = JSON.parse(
  await readFile(
    join(destination, 'node_modules/@aicayzer/inkkit/package.json'),
    'utf8',
  ),
)
await writeFile(
  join(destination, 'dist/consumer-evidence.json'),
  JSON.stringify(
    {
      version,
      entry: core ? 'core' : 'index',
      tarballSha256,
      bundleSha256: createHash('sha256').update(html).digest('hex'),
    },
    null,
    2,
  ) + '\n',
)
console.log(
  JSON.stringify(
    {
      tarballSha256,
      bundle: join(destination, 'dist/index.html'),
    },
    null,
    2,
  ),
)
