import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { cpus, platform, release } from 'node:os'
import { chromium, webkit } from '@playwright/test'

const root = resolve(process.argv[2] ?? '.')
const port = Number(process.env.INKKIT_PLAYGROUND_PORT ?? 4195)
const url = `http://127.0.0.1:${port}`
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
const result = {
  command: process.argv,
  commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  dirty: Boolean(
    execFileSync('git', ['-C', root, 'diff', '--name-only'], {
      encoding: 'utf8',
    }).trim(),
  ),
  machine: { cpu: cpus()[0].model, platform: platform(), release: release() },
  engines: {},
}
try {
  let ready = false
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      ready = (await fetch(url)).ok
    } catch {
      /* Vite is starting. */
    }
    if (ready) break
    if (server.exitCode !== null) throw Error(`Vite exited: ${server.exitCode}`)
    await new Promise((done) => setTimeout(done, 200))
  }
  if (!ready) throw Error('Vite did not become ready')
  for (const [engine, browserType] of Object.entries({ chromium, webkit })) {
    const browser = await browserType.launch()
    try {
      const page = await browser.newPage()
      await page.goto(url)
      const measured = []
      for (const blocks of [5000, 10000]) {
        const samples = await page.evaluate(
          async ({ root, blocks }) => {
            const { InkKitEditor } = await import(`/@fs${root}/src/core.ts`)
            document.body.replaceChildren()
            const container = document.createElement('div')
            document.body.append(container)
            const editor = await InkKitEditor.mount(container, { changed() {} })
            editor.loadDocument({
              documentId: 'measurement',
              generation: 1,
              format: 'md',
              text: Array.from(
                { length: blocks },
                (_, index) => `Paragraph ${index} with ordinary text.`,
              ).join('\n\n'),
            })
            const text = editor.textSnapshot()
            const times = []
            for (let index = 0; index < 6; index++) {
              editor.selectTextRange(
                { snapshotId: text.snapshotId, from: 0, to: 0 },
                { focus: false },
              )
              await new Promise(requestAnimationFrame)
              const start = performance.now()
              editor.selectTextRange(
                { snapshotId: text.snapshotId, from: 0, to: text.text.length },
                { focus: false },
              )
              await new Promise(requestAnimationFrame)
              if (index) times.push(performance.now() - start)
            }
            await editor.destroy()
            return times
          },
          { root, blocks },
        )
        measured.push({
          blocks,
          samples,
          medianMs: [...samples].sort((a, b) => a - b)[
            Math.floor(samples.length / 2)
          ],
        })
      }
      result.engines[engine] = { version: browser.version(), measured }
    } finally {
      await browser.close()
    }
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  server.kill('SIGTERM')
}
