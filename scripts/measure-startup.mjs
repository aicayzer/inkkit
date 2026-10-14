import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { cpus, platform, release } from 'node:os'
import { pathToFileURL } from 'node:url'
import { chromium, webkit } from '@playwright/test'

// Compares the single-file page with Mermaid (main entry) and without it (core
// entry). WEBKIT_HOST is the compiled scripts/interop/WebKitHost.swift; without
// it, only the Playwright browsers are measured.
const [archiveArgument, destinationArgument, hostArgument] =
  process.argv.slice(2)
if (!archiveArgument || !destinationArgument)
  throw Error(
    'Usage: node scripts/measure-startup.mjs ARCHIVE OUTPUT_DIRECTORY [WEBKIT_HOST]',
  )
const archive = resolve(archiveArgument)
const destination = resolve(destinationArgument)
const host = hostArgument && resolve(hostArgument)
const runs = 10
await mkdir(destination, { recursive: true })
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

const variants = {}
const versions = {}
for (const variant of ['main', 'core']) {
  const consumer = join(destination, variant)
  execFileSync(
    'node',
    [
      'scripts/interop/build-consumer.mjs',
      archive,
      consumer,
      variant === 'core' ? 'core' : '',
    ],
    { stdio: 'inherit' },
  )
  const bundle = join(consumer, 'dist/index.html')
  const html = await readFile(bundle)
  const samples = {}
  for (const [name, type] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    const browser = await type.launch()
    versions[name] = browser.version()
    samples[name] = []
    try {
      for (let run = 0; run < runs; run++) {
        const context = await browser.newContext()
        const page = await context.newPage()
        const requests = []
        page.on('request', (request) => {
          if (/^https?:/.test(request.url())) requests.push(request.url())
        })
        await page.goto(pathToFileURL(bundle).href)
        await page.waitForFunction(() => window.ready === true)
        if (requests.length) throw Error('The page fetched network resources')
        samples[name].push(await page.evaluate(() => window.initialReadyMs))
        await context.close()
      }
    } finally {
      await browser.close()
    }
  }
  if (host) {
    samples.wkwebview = []
    for (let run = 0; run < runs; run++) {
      const output = join(destination, `${variant}-wkwebview-${run}.json`)
      execFileSync(host, [bundle, 'startup', '-', output], { stdio: 'inherit' })
      samples.wkwebview.push(JSON.parse(await readFile(output, 'utf8')))
    }
  }
  variants[variant] = {
    bundleSha256: sha256(html),
    bundleBytes: html.length,
    bundleGzipBytes: gzipSync(html).length,
    medianMs: {
      chromium: median(samples.chromium),
      webkit: median(samples.webkit),
      ...(samples.wkwebview && {
        wkwebviewPage: median(
          samples.wkwebview.map((sample) => sample.initialReadyMs),
        ),
        wkwebviewHost: median(
          samples.wkwebview.map((sample) => sample.hostReadyMs),
        ),
      }),
    },
    samples,
  }
}
const evidence = {
  measuredAt: new Date().toISOString(),
  command: process.argv,
  machine: {
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    node: process.version,
    browsers: versions,
  },
  archiveSha256: sha256(await readFile(archive)),
  runs,
  variants,
}
await writeFile(
  join(destination, 'startup.json'),
  JSON.stringify(evidence, null, 2) + '\n',
)
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(variants).map(([name, variant]) => [
        name,
        {
          bundleBytes: variant.bundleBytes,
          bundleGzipBytes: variant.bundleGzipBytes,
          medianMs: variant.medianMs,
        },
      ]),
    ),
    null,
    2,
  ),
)
