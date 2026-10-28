import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
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

for (const chunks of [
  [
    'ab',
    'ort: Lazy deopt after a fast API call with return value is unsupported',
    '\r\n',
  ],
  ['ordinary warning\nFA', 'TAL ERROR: Reached heap limit', '\n'],
]) {
  test(
    'stops both processes when a fatal runtime header precedes any exit',
    { timeout: 15_000 },
    async () => {
      await scenario({
        exit: `${JSON.stringify(chunks)}.forEach((chunk, index) => setTimeout(() => process.stderr.write(chunk), index * 30));
          setTimeout(() => process.exit(98), 5000)`,
        expected: 1,
        fatal: true,
      })
    },
  )
}

test('does not mistake a quoted abort message for a fatal header', async () => {
  await scenario({
    exit: "console.error('warning mentions abort: in a message'); process.exit(0)",
    expected: 1,
  })
})

test('keeps the start of a long stderr line across chunks', async () => {
  await scenario({
    exit: `process.stderr.write('x'.repeat(2048) + 'abort: ' + 'y'.repeat(1017));
      setTimeout(() => { process.stderr.write('\\n'); process.exit(0) }, 30)`,
    expected: 1,
  })
})

async function scenario({ exit, runnerExit, expected, fatal = false }) {
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
      if (fatal) {
        assert.match(log, /Playground server reported a fatal runtime error/)
      } else {
        assert.match(log, /Playground server exited unexpectedly/)
        assert.match(
          log,
          exit.includes('SIGKILL')
            ? /signal SIGKILL/
            : exit.includes('23')
              ? /code 23/
              : /code 0/,
        )
        assert.doesNotMatch(log, /reported a fatal runtime error/)
      }
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

test('signals each process group only once during crash cleanup', async () => {
  const kill = mock.method(process, 'kill')
  try {
    await scenario({ exit: 'process.exit(23)', expected: 1 })
    const groups = kill.mock.calls.map(({ arguments: [pid] }) => pid)
    assert.equal(groups.length, 2)
    assert.equal(new Set(groups).size, groups.length)
  } finally {
    kill.mock.restore()
  }
})

test('a fixture build failure never starts preview', async () => {
  const { startFixture } = await import('./browser-fixture.mjs')
  let previewStarted = false
  await assert.rejects(
    startFixture({
      mode: 'built',
      vite: {
        build: async () => {
          throw Error('fixture build failed')
        },
        preview: async () => {
          previewStarted = true
        },
      },
    }),
    /fixture build failed/,
  )
  assert.equal(previewStarted, false)
})

test('fixture modes reject misspellings instead of falling back to dev', async () => {
  const { fixtureMode } = await import('./browser-fixture.mjs')
  assert.throws(() => fixtureMode('build'), /must be dev or built/)
})

for (const [repository, sourcePrefix] of [
  ['/fixture-repository', '/@fs/fixture-repository/src/'],
  [
    '/fixture repository/café%notes',
    '/@fs/fixture%20repository/caf%C3%A9%25notes/src/',
  ],
]) {
  for (const mode of ['dev', 'built']) {
    test(`${mode} fixture routes exact entries in ${repository}`, async () => {
      const { fixtureRoutes } = await import('./browser-fixture-routes.mjs')
      const { createServer } = await import('node:http')
      let middleware
      const plugin = fixtureRoutes(repository)
      plugin[mode === 'dev' ? 'configureServer' : 'configurePreviewServer']({
        middlewares: {
          use: (handler) => {
            middleware = handler
          },
        },
      })
      const server = createServer((request, response) => {
        middleware(request, response, () => {
          response.end('static file')
        })
      })
      await new Promise((done) => server.listen(0, '127.0.0.1', done))
      const base = `http://127.0.0.1:${server.address().port}`
      try {
        for (const [source, entry] of [
          ['core.ts', 'core.js'],
          ['preserve.ts', 'preservation.js'],
        ]) {
          const [from, to] =
            mode === 'built'
              ? [sourcePrefix + source, `/_test/${entry}`]
              : [`/_test/${entry}`, sourcePrefix + source]
          const response = await fetch(base + from, { redirect: 'manual' })
          assert.equal(response.status, 307)
          assert.equal(response.headers.get('location'), to)
          const target = await fetch(
            new URL(response.headers.get('location'), base),
          )
          assert.equal(await target.text(), 'static file')
        }
        const refused = ['/@fs/%', '/@fs/%ZZ', '/@fs/%E0%A4%A', '/_test/%C0%AF']
        if (mode === 'built')
          refused.push(
            sourcePrefix + 'editor.ts',
            '/@fs/other-repository/src/core.ts',
            sourcePrefix + 'core.ts/extra',
            sourcePrefix.replace('/src/', '/%73rc%252F') + 'core.ts',
            '/_test/unknown.js',
          )
        for (const path of refused) {
          const response = await fetch(base + path)
          assert.equal(response.status, 404, path)
          assert.equal(await response.text(), 'Unknown browser fixture module')
        }
      } finally {
        await new Promise((done) => server.close(done))
      }
    })
  }
}
