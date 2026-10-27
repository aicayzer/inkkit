import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// Own both process groups so a server crash cannot leave browser workers running.
export async function runBrowserTests({
  args = [],
  port = Number(process.env.INKKIT_PLAYGROUND_PORT ?? 4178),
  server = [
    'node_modules/vite/bin/vite.js',
    'playground',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  runner = ['node_modules/@playwright/test/cli.js', 'test', ...args],
  logFile = '_local/playwright/server.log',
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error('INKKIT_PLAYGROUND_PORT must be a port number')
  mkdirSync(resolve(logFile, '..'), { recursive: true })
  writeFileSync(logFile, '')
  const children = []
  const closed = []
  const stopped = new Set()
  let failure
  let testsFinished = false
  let stderrLine = ''
  const log = (message) => {
    appendFileSync(logFile, message)
    process.stderr.write(message)
  }
  const start = (command, stdio) => {
    const child = spawn(process.execPath, command, { detached: true, stdio })
    children.push(child)
    closed.push(new Promise((done) => child.once('close', done)))
    return child
  }
  const stop = () => {
    for (const child of children) {
      if (stopped.has(child)) continue
      stopped.add(child)
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }
  const fail = (message) => {
    if (failure || testsFinished) return
    failure = message
    log(`${message}\n`)
    stop()
  }
  const interrupt = (signal) => fail(`Browser run interrupted by ${signal}.`)
  const onInt = () => interrupt('SIGINT')
  const onTerm = () => interrupt('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  try {
    const vite = start(server, ['ignore', 'pipe', 'pipe'])
    vite.stdout.on('data', (chunk) => {
      appendFileSync(logFile, chunk)
      process.stdout.write(chunk)
    })
    vite.stderr.on('data', (chunk) => {
      appendFileSync(logFile, chunk)
      process.stderr.write(chunk)
      const output = stderrLine + chunk.toString()
      const fatal = output.match(
        /(?:^|[\r\n])((?:abort:|FATAL ERROR:)[^\r\n]*)\r?\n/,
      )
      // A runtime abort can stop serving requests before the process exits.
      if (fatal)
        fail(
          `Playground server reported a fatal runtime error (${fatal[1]}); stopping browser tests. See ${logFile}.`,
        )
      stderrLine = output.slice(output.lastIndexOf('\n') + 1).slice(0, 1024)
    })
    vite.on('error', (error) =>
      fail(`Playground server failed to start: ${error.message}`),
    )
    vite.on('exit', (code, signal) =>
      fail(
        `Playground server exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`}); stopping browser tests. See ${logFile}.`,
      ),
    )
    const deadline = Date.now() + 30_000
    while (!failure) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(1000),
        })
        await response.body?.cancel()
        if (response.ok) break
      } catch {
        // Vite may not have bound the port yet.
      }
      if (Date.now() >= deadline)
        fail('Playground server did not become ready within 30 seconds.')
      else await delay(100)
    }
    if (failure) return 1
    const playwright = start(runner, 'inherit')
    return await new Promise((done) => {
      playwright.on('error', (error) => {
        fail(`Playwright failed to start: ${error.message}`)
        done(1)
      })
      playwright.on('exit', (code) => {
        testsFinished = true
        done(failure ? 1 : (code ?? 1))
      })
    })
  } finally {
    testsFinished = true
    stop()
    await Promise.all(closed)
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.env.INKKIT_EXTERNAL_PLAYGROUND = '1'
  process.exitCode = await runBrowserTests({ args: process.argv.slice(2) })
}
