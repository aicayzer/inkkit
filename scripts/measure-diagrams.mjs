import { chromium, webkit } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const baseline = process.argv[2]
if (!baseline)
  throw Error(
    'Usage: node scripts/measure-diagrams.mjs BASELINE_CHECKOUT [OUTPUT_JSON]',
  )
const engine = process.env.MEASURE_BROWSER ?? 'webkit'
if (!['chromium', 'webkit'].includes(engine))
  throw Error('MEASURE_BROWSER must be chromium or webkit')
const runs = Number(process.env.MEASURE_RUNS ?? 3)
if (!Number.isInteger(runs) || runs < 1 || runs > 10)
  throw Error('MEASURE_RUNS must be between 1 and 10')
const output = resolve(
  process.argv[3] ?? `_local/diagram-measurements-${engine}.json`,
)
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}
const document = (run) =>
  'Typing target\n\n' +
  Array.from(
    { length: 100 },
    (_, index) =>
      `~~~mermaid\nflowchart LR\nStart${run}_${index}[Start ${index}] --> Finish${run}_${index}[Finish ${index}]\n~~~\n`,
  ).join('\n')
const report = {
  engine,
  runs,
  diagramCount: 100,
  scope:
    'Built offline playground pages. Each sample opens a fresh page. Preview time includes document replacement and sequentially revealing every preview, until all 100 settle. Clipboard and print follow that warm-up in that order. Typing is a separate fresh-page run with real keyboard input; beforeinput-to-requestAnimationFrame excludes browser delivery time before beforeinput. Pending-preview counts report how much work remained at input. Page bytes are the built single HTML file, gzip level 9.',
  results: [],
}
const browser = await (engine === 'webkit' ? webkit : chromium).launch({
  headless: true,
})

async function open(root) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const failures = []
  page.on('pageerror', (error) => failures.push(error.message))
  const url = pathToFileURL(resolve(root, '_local/playground/index.html'))
  url.search = '?fixture=everyday&configuration=rich'
  await page.goto(url.href)
  await page.waitForFunction(() =>
    Boolean(window.inkkitPlayground?.observe().snapshot),
  )
  return { page, failures }
}

try {
  for (const [label, root] of [
    ['baseline', resolve(baseline)],
    ['candidate', process.cwd()],
  ]) {
    const bytes = await readFile(resolve(root, '_local/playground/index.html'))
    const result = {
      label,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      pageSha256: createHash('sha256').update(bytes).digest('hex'),
      checkoutDirty: Boolean(
        execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
      ),
      pageBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      samples: [],
    }
    for (let run = 0; run < runs; run++) {
      const text = document(run)
      const { page, failures } = await open(root)
      try {
        const previewMs = await page.evaluate(async (text) => {
          const start = performance.now()
          window.inkkitPlayground.replaceDocument(text, 'md')
          const previews = [
            ...document.querySelectorAll('#editor .inkkit-mermaid-preview'),
          ]
          if (previews.length !== 100)
            throw Error(`Expected 100 previews, got ${previews.length}`)
          for (const preview of previews) {
            preview.scrollIntoView({ block: 'center', behavior: 'instant' })
            while (!['ready', 'error'].includes(preview.dataset.state)) {
              if (performance.now() - start > 120_000)
                throw Error('Diagram warm-up exceeded 120 seconds')
              await new Promise(requestAnimationFrame)
            }
            if (preview.dataset.state !== 'ready')
              throw Error(preview.textContent)
          }
          return performance.now() - start
        }, text)
        const exports = await page.evaluate(async (text) => {
          let start = performance.now()
          const clipboard = await window.inkkitPlayground.operation('clipboard')
          const clipboardMs = performance.now() - start
          if (
            clipboard.diagrams?.length !== 100 ||
            clipboard.diagrams.some((item) => !item.image || item.error)
          )
            throw Error('Clipboard did not export all 100 diagrams')
          start = performance.now()
          const print = await window.inkkitPlayground.operation('printable')
          const printMs = performance.now() - start
          const html = new DOMParser().parseFromString(print.html, 'text/html')
          if (
            print.warnings.length ||
            html.querySelectorAll('figure img').length !== 100
          )
            throw Error('Print did not export all 100 diagrams')
          if (window.inkkitPlayground.observe().snapshot.text !== text)
            throw Error('Export changed the saved source')
          return { clipboardMs, printMs }
        }, text)
        if (failures.length) throw Error(failures.join('\n'))
        result.samples.push({ previewMs, ...exports })
      } finally {
        await page.close()
      }
      const typing = await open(root)
      try {
        await typing.page.evaluate((text) => {
          window.diagramInputMeasurement = null
          const root = document.getElementById('editor')
          root.addEventListener(
            'beforeinput',
            (event) => {
              if (event.inputType !== 'insertText' || event.data !== 'x') return
              const start = performance.now()
              const pendingPreviews = root.querySelectorAll(
                '.inkkit-mermaid-preview:not([data-state="ready"]):not([data-state="error"])',
              ).length
              requestAnimationFrame(() => {
                window.diagramInputMeasurement = {
                  elapsedMs: performance.now() - start,
                  pendingPreviews,
                  trusted: event.isTrusted,
                }
              })
            },
            { capture: true },
          )
          window.inkkitPlayground.replaceDocument(text, 'md')
          window.inkkitPlayground.operation('find', { text: 'Typing target' })
        }, text)
        await typing.page.keyboard.press('ArrowRight')
        await typing.page.keyboard.type('x')
        await typing.page.waitForFunction(
          () => window.diagramInputMeasurement !== null,
        )
        const input = await typing.page.evaluate((text) => {
          if (
            window.inkkitPlayground.observe().snapshot.text !==
            text.replace('Typing target', 'Typing targetx')
          )
            throw Error('Keyboard input did not preserve the expected source')
          return window.diagramInputMeasurement
        }, text)
        if (!input.trusted) throw Error('Input was not a real keyboard event')
        if (typing.failures.length) throw Error(typing.failures.join('\n'))
        Object.assign(result.samples.at(-1), {
          inputMs: input.elapsedMs,
          pendingAtInput: input.pendingPreviews,
        })
      } finally {
        await typing.page.close()
      }
    }
    result.medians = Object.fromEntries(
      ['previewMs', 'clipboardMs', 'printMs', 'inputMs'].map((key) => [
        key,
        median(result.samples.map((sample) => sample[key])),
      ]),
    )
    report.results.push(result)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify(report, null, 2) + '\n')
    console.log(
      JSON.stringify({
        label,
        pageBytes: result.pageBytes,
        gzipBytes: result.gzipBytes,
        medians: result.medians,
      }),
    )
  }
} finally {
  await browser.close()
}
console.log(`Evidence saved to ${output}`)
