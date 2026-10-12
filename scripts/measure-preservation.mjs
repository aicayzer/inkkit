import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const baseline = process.argv[2]
if (!baseline)
  throw Error('Usage: node scripts/measure-preservation.mjs BASELINE_CHECKOUT')
const results = []
for (const [name, root, port] of [
  ['baseline', resolve(baseline), 4194],
  ['candidate', process.cwd(), 4195],
]) {
  const server = spawn(
    process.execPath,
    [
      root + '/node_modules/vite/bin/vite.js',
      'playground',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: root, stdio: 'ignore' },
  )
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    for (let i = 0; i < 100; i++) {
      try {
        if (server.exitCode !== null) throw Error('Measurement server exited')
        const response = await fetch(`http://127.0.0.1:${port}`)
        if (!response.ok) throw Error('Measurement server is not ready')
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/?configuration=minimal`)
    await page.locator('#editor .ProseMirror').waitFor()
    for (const [blocks, kind] of [
      [100, 'plain'],
      [500, 'plain'],
      [1000, 'plain'],
      [500, 'code'],
      [500, 'marked'],
      [500, 'heading'],
      [500, 'mixed'],
    ]) {
      const setup = await page.evaluate(
        async ({ root, blocks, kind }) => {
          if (window.measuredEditor) await window.measuredEditor.destroy()
          const { InkKitEditor } = await import(`/@fs${root}/src/index.ts`)
          const { Preservation } = await import(`/@fs${root}/src/preserve.ts`)
          if (!window.measureWrapped) {
            const original = Preservation.prototype.serialize
            Preservation.prototype.serialize = function (...args) {
              const start = performance.now()
              try {
                return original.apply(this, args)
              } finally {
                window.preservationTimes.push(performance.now() - start)
              }
            }
            window.measureWrapped = true
          }
          document.body.innerHTML =
            '<main id="probe" style="width:800px;height:600px;overflow:auto"></main>'
          window.preservationTimes = []
          window.inputTimes = []
          window.inputStart = 0
          const editor = await InkKitEditor.mount(
            document.querySelector('#probe'),
            {
              changed() {
                if (window.inputStart)
                  window.inputTimes.push(performance.now() - window.inputStart)
              },
              stateChanged() {},
              openLink() {},
              copy() {},
            },
            { rendering: { diagramPreview: false } },
          )
          const paragraph =
            'A paragraph with enough words to cover several lines in this editor. '.repeat(
              5,
            ) + '\n\n'
          const codeBlock =
            '```typescript\n' +
            'const value = items.map((item) => item.name).filter(Boolean);\n'.repeat(
              5,
            ) +
            '```\n\n'
          const text =
            (['heading', 'mixed'].includes(kind) ? '# Heading\n\n' : '') +
            (kind === 'code'
              ? codeBlock
              : kind === 'marked'
                ? '__Authored bold__ and _emphasis_. ' + paragraph
                : paragraph
            ).repeat(blocks) +
            (kind === 'mixed'
              ? '| A | B |\n| - | - |\n| one | two |\n\n```ts\nconst x = 1;\n```\n\n[Retained][ref]\n\n[ref]: /target\n\n<section>unsupported</section>\n'
              : '')
          const start = performance.now()
          editor.loadDocument({
            documentId: 'performance',
            generation: 1,
            format: 'md',
            text,
          })
          const load = performance.now() - start
          window.measuredEditor = editor
          editor.focus()
          if (['heading', 'mixed'].includes(kind)) {
            const heading = document.querySelector('#probe h1')
            const selection = window.getSelection()
            selection.collapse(heading.firstChild, heading.textContent.length)
          }
          document
            .querySelector('.ProseMirror')
            .addEventListener(
              'beforeinput',
              () => (window.inputStart = performance.now()),
            )
          window.preservationTimes = []
          return { load, chars: text.length }
        },
        { root, blocks, kind },
      )
      for (let i = 0; i < 10; i++) await page.keyboard.insertText('x')
      const times = await page.evaluate(() => ({
        preservation: window.preservationTimes,
        input: window.inputTimes,
        saved: window.measuredEditor.snapshot().text.includes('xxxxxxxxxx'),
      }))
      if (
        !times.saved ||
        times.input.length !== 10 ||
        times.preservation.length < 10
      )
        throw Error(
          `The measurement did not preserve all ten ordinary inputs: ${JSON.stringify(times)}`,
        )
      results.push({
        name,
        blocks,
        kind,
        browser: browser.version(),
        node: process.version,
        ...setup,
        ...times,
      })
      console.log(JSON.stringify(results.at(-1)))
    }
  } finally {
    await browser?.close()
    server.kill('SIGTERM')
  }
}
await mkdir('_local', { recursive: true })
await writeFile(
  '_local/preservation-performance.json',
  JSON.stringify(results, null, 2) + '\n',
)
