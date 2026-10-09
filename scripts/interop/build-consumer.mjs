import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const script = dirname(fileURLToPath(import.meta.url))
const tarball = resolve(
  process.argv[2] ?? '_local/release/aicayzer-inkkit-0.0.1.tgz',
)
const destination = resolve(process.argv[3] ?? '_local/interop/consumer')
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
})
const html = await readFile(join(destination, 'dist/index.html'), 'utf8')
if (/<script[^>]+\bsrc=|<link[^>]+\bhref=/i.test(html))
  throw Error('Consumer bundle is not self-contained')
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
