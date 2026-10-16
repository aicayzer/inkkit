import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runBrowserTests } from './test-browser.mjs'

for (const exit of [
  'process.exit(23)',
  "process.kill(process.pid, 'SIGKILL')",
  'process.exit(0)',
]) {
  test(
    `stops a hanging runner when the server calls ${exit}`,
    { timeout: 15_000 },
    async () => {
      await scenario({ exit, expected: 1 })
    },
  )
}

test('preserves a successful browser run', async () => {
  await scenario({ runnerExit: 0, expected: 0 })
})
test('preserves a failed browser run', async () => {
  await scenario({ runnerExit: 7, expected: 7 })
})

async function scenario({ exit, runnerExit, expected }) {
  const directory = mkdtempSync(join(tmpdir(), 'inkkit-browser-'))
  const logFile = join(directory, 'server.log')
  const serverFile = join(directory, 'server.mjs')
  const runnerFile = join(directory, 'runner.mjs')
  // A ready HTTP server exits only after the runner has started its work.
  writeFileSync(
    serverFile,
    `
    import { createServer } from 'node:http'
    createServer((request, response) => {
      response.end('ready')
      if (request.url === '/crash') {
        console.log('server stdout before exit')
        console.error('simulated fatal server dump')
        setTimeout(() => { ${exit ?? ''} }, 100)
      }
    }).listen(5363, '127.0.0.1')
  `,
  )
  writeFileSync(
    runnerFile,
    exit
      ? `
    await fetch('http://127.0.0.1:5363/crash')
    setInterval(() => {}, 1000)
  `
      : `process.exit(${runnerExit})`,
  )
  const started = Date.now()
  try {
    assert.equal(
      await runBrowserTests({
        port: 5363,
        server: [serverFile],
        runner: [runnerFile],
        logFile,
      }),
      expected,
    )
    assert.ok(
      Date.now() - started < 10_000,
      'must stop promptly instead of waiting for the runner',
    )
    const log = readFileSync(logFile, 'utf8')
    if (exit) {
      assert.match(log, /server stdout before exit/)
      assert.match(log, /simulated fatal server dump/)
      assert.match(log, /Playground server exited unexpectedly/)
      assert.match(
        log,
        exit.includes('SIGKILL')
          ? /signal SIGKILL/
          : exit.includes('23')
            ? /code 23/
            : /code 0/,
      )
    } else {
      assert.doesNotMatch(log, /exited unexpectedly/)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test(
  'reports a server exit before readiness without starting tests',
  { timeout: 15_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'inkkit-browser-startup-'))
    const logFile = join(directory, 'server.log')
    try {
      assert.equal(
        await runBrowserTests({
          port: 5363,
          server: [
            '--eval',
            "console.error('startup failure'); process.exit(23)",
          ],
          runner: ['--eval', "throw Error('must not start')"],
          logFile,
        }),
        1,
      )
      assert.match(
        readFileSync(logFile, 'utf8'),
        /startup failure[\s\S]*Playground server exited unexpectedly \(code 23\)/,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
