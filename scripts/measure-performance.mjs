import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { cpus, platform, release } from 'node:os'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const archive = resolve(process.argv[2])
const destination = resolve(process.argv[3])
await mkdir(destination, { recursive: true })
const consumer = join(destination, 'consumer')
execFileSync(
  'node',
  ['scripts/interop/build-consumer.mjs', archive, consumer],
  {
    stdio: 'inherit',
  },
)
const bundle = join(consumer, 'dist/index.html')
const version = JSON.parse(
  await readFile(
    join(consumer, 'node_modules/@aicayzer/inkkit/package.json'),
    'utf8',
  ),
).version
const minimalPreviewsDisabled =
  version.localeCompare('0.0.11', undefined, { numeric: true }) >= 0
const html = await readFile(bundle)
const browser = await chromium.launch()
const samples = []
try {
  for (const configuration of ['minimal', 'rich']) {
    for (const document of ['everyday', 'large', 'mixed']) {
      for (let repetition = 0; repetition < 3; repetition++) {
        const page = await browser.newPage()
        const requests = []
        page.on('request', (request) => {
          if (/^https?:/.test(request.url())) requests.push(request.url())
        })
        await page.goto(
          pathToFileURL(bundle).href + `?configuration=${configuration}`,
        )
        await page.waitForFunction(() => Boolean(window.interop))
        const result = await page.evaluate(
          ({ configuration, document, minimalPreviewsDisabled }) =>
            window.interop.measure(
              configuration,
              document,
              minimalPreviewsDisabled,
            ),
          { configuration, document, minimalPreviewsDisabled },
        )
        if (requests.length)
          throw Error('Performance consumer fetched network resources')
        samples.push({ configuration, document, repetition, ...result })
        await page.close()
      }
    }
  }
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const evidence = {
    measuredAt: new Date().toISOString(),
    version,
    command: process.argv,
    machine: {
      cpu: cpus()[0].model,
      platform: platform(),
      release: release(),
      node: process.version,
      browser: browser.version(),
    },
    archiveSha256: sha256(await readFile(archive)),
    bundleSha256: sha256(html),
    bundleBytes: html.length,
    bundleGzipBytes: gzipSync(html).length,
    renderedModuleBytes: JSON.parse(
      await readFile(join(consumer, 'dist/module-sizes.json'), 'utf8'),
    ),
    samples,
  }
  await writeFile(
    join(destination, 'performance.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await browser.close()
}
