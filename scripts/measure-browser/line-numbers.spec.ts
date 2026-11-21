import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { execFileSync } from 'node:child_process'

/**
 * `display.codeLineNumbers` on one code block of 30,000 unhighlighted lines. Chromium only,
 * because the heap comes from the DevTools protocol. Each run is a fresh page, and the time runs
 * from `loadDocument` until two frames have painted. The heap is read after two forced garbage
 * collections: `usedSize` is the JavaScript heap and `embedderHeapUsedSize` is the browser's own
 * memory for DOM and layout objects. `docs/maintainers/performance.md` records which one it
 * reports.
 */
const output = process.env.INKKIT_MEASURE ?? '_local/measure'
const lines = Number(process.env.INKKIT_MEASURE_LINES ?? 30000)
const runs = Number(process.env.INKKIT_MEASURE_RUNS ?? 3)
const moduleUrl = `/@fs${process.cwd()}/src/core.ts`
test.setTimeout(10 * 60_000)

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

test('code line numbers cost', async ({ browser, browserName }) => {
  test.skip(
    browserName !== 'chromium',
    'the heap comes from the DevTools protocol',
  )
  const states = [
    { name: 'off', numbers: false, wrapped: false },
    { name: 'on, no wrapping', numbers: true, wrapped: false },
    { name: 'on, wrapping', numbers: true, wrapped: true },
  ]
  const results: Record<string, Record<string, number>> = {}
  for (const state of states) {
    const samples: Record<string, number[]> = {}
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto('/')
      await page.waitForFunction(() => Boolean(window.inkkitPlayground))
      const client = await context.newCDPSession(page)
      const time = await page.evaluate(
        async ({ moduleUrl, lines, numbers, wrapped }) => {
          const { InkKitEditor } = await import(moduleUrl)
          document.body.replaceChildren()
          document.body.style.cssText = 'margin:0;padding:10px;width:620px'
          const root = document.createElement('div')
          document.body.append(root)
          const editor = await InkKitEditor.mount(
            root,
            { changed() {} },
            { display: { codeLineNumbers: numbers } },
          )
          const frames = () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            )
          const text =
            '```\n' +
            Array.from(
              { length: lines },
              (_, index) => `const value${index} = ${index} // line`,
            ).join('\n') +
            '\n```\n'
          const start = performance.now()
          editor.loadDocument({
            documentId: 'measure',
            generation: 1,
            format: 'md',
            text,
          })
          await frames()
          if (wrapped) {
            root
              .querySelector<HTMLButtonElement>('[aria-label="Code language"]')!
              .click()
            document
              .querySelector<HTMLButtonElement>('[aria-label="Wrap code"]')!
              .click()
            await frames()
          }
          return performance.now() - start
        },
        { moduleUrl, lines, numbers: state.numbers, wrapped: state.wrapped },
      )
      await client.send('HeapProfiler.collectGarbage')
      await client.send('HeapProfiler.collectGarbage')
      const heap = (await client.send('Runtime.getHeapUsage')) as {
        usedSize: number
        embeddedHeapUsedSize?: number
        embedderHeapUsedSize?: number
      }
      for (const [name, value] of Object.entries({
        timeMs: time,
        usedSizeMiB: heap.usedSize / 2 ** 20,
        embedderHeapUsedSizeMiB:
          (heap.embedderHeapUsedSize ?? heap.embeddedHeapUsedSize ?? 0) /
          2 ** 20,
      }))
        (samples[name] ??= []).push(value)
      await context.close()
    }
    results[state.name] = Object.fromEntries(
      Object.entries(samples).map(([name, values]) => [name, median(values)]),
    )
  }
  mkdirSync(output, { recursive: true })
  writeFileSync(
    `${output}/line-numbers-${browserName}.json`,
    JSON.stringify(
      {
        command: process.argv,
        commit: (() => {
          try {
            return execFileSync('git', ['rev-parse', 'HEAD'], {
              encoding: 'utf8',
            }).trim()
          } catch {
            return 'unknown'
          }
        })(),
        machine: {
          cpu: cpus()[0]?.model,
          platform: platform(),
          release: release(),
        },
        lines,
        runs,
        medians: results,
      },
      null,
      2,
    ),
  )
})
