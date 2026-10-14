import { chromium, webkit } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Measures opening and typing in long highlighted code blocks in the
// playground of a checkout, in Chromium and WebKit. Run it in two checkouts to
// compare them.
const root = resolve(process.argv[2] ?? '.')
const port = Number(process.env.INKKIT_PLAYGROUND_PORT ?? 4178)
const sizes = (process.env.MEASURE_SIZES ?? '4999,20000').split(',').map(Number)

const fill = (unit, length) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length)
const ordinary = 'const value = compute(1, "two") // three\n'
const blocks = {
  'ini, one word': (n) => ['ini', fill('a', n)],
  'typescript, one word': (n) => ['typescript', fill('a', n)],
  'c, lines of words': (n) => ['c', fill('the quick brown fox jumps\n', n)],
  'typescript, ordinary code': (n) => ['typescript', fill(ordinary, n)],
  'no language, one word': (n) => ['', fill('a', n)],
}
const fence = (language, code) => '```' + language + '\n' + code + '\n```\n'
const cases = []
for (const [name, make] of Object.entries(blocks))
  for (const size of sizes)
    // The caret opens at the end of the note, so typing lands in the block.
    cases.push({
      name,
      size,
      source: 'Before.\n\n' + fence(...make(size)),
    })
cases.push({
  name: '20 ini blocks of one word',
  size: 20 * 4999,
  source: Array(20)
    .fill(fence('ini', fill('a', 4999)))
    .join('\n'),
})

const server = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/vite/bin/vite.js'),
    'playground',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { cwd: root, stdio: 'ignore' },
)
const results = []
try {
  for (let i = 0; i < 100; i++) {
    try {
      if (server.exitCode !== null) throw Error('The server exited')
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break
    } catch {
      await new Promise((done) => setTimeout(done, 100))
    }
  }
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${port}/?configuration=rich`)
      await page.waitForFunction(
        () => window.inkkitPlayground?.observe().snapshot,
      )
      for (const { name, size, source } of cases) {
        const samples = await page.evaluate(async (source) => {
          const playground = window.inkkitPlayground
          const samples = []
          for (let i = 0; i < 3; i++) {
            let start = performance.now()
            playground.replaceDocument(source, 'md', `measure:${i}`)
            const open = performance.now() - start
            start = performance.now()
            await playground.operation('insertText', { text: 'x' })
            const type = performance.now() - start
            const saved = playground.observe().snapshot?.text
            if (saved !== source.replace(/\n```\n$/, 'x\n```\n'))
              throw Error('Typing did not reach the end of the last block')
            samples.push({ open, type })
          }
          return samples
        }, source)
        const median = (key) =>
          samples.map((sample) => sample[key]).sort((a, b) => a - b)[1]
        const row = {
          browser: `${engine.name()} ${browser.version()}`,
          name,
          size,
          open: median('open'),
          type: median('type'),
          samples,
        }
        results.push(row)
        console.log(
          [
            row.browser,
            name,
            size,
            row.open.toFixed(0),
            row.type.toFixed(0),
          ].join('\t'),
        )
      }
    } finally {
      await browser.close()
    }
  }
} finally {
  server.kill()
}
await mkdir('_local', { recursive: true })
await writeFile(
  '_local/highlighting-performance.json',
  JSON.stringify({ root, results }, null, 2),
)
