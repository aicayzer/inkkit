import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { installBrowsers } from './install-browsers.mjs'

// Each run appends to a counter file, then behaves as `body` says.
async function scenario(body, options) {
  const directory = mkdtempSync(join(tmpdir(), 'inkkit-install-'))
  const counter = join(directory, 'runs')
  const script = join(directory, 'install.mjs')
  writeFileSync(
    script,
    `import { appendFileSync, readFileSync } from 'node:fs'
     appendFileSync(${JSON.stringify(counter)}, 'x')
     const run = readFileSync(${JSON.stringify(counter)}, 'utf8').length
     ${body}`,
  )
  const messages = []
  const result = await installBrowsers({
    command: [process.execPath, script],
    log: (message) => messages.push(message),
    ...options,
  })
  return { result, runs: readFileSync(counter, 'utf8').length, messages }
}

test('succeeds on the first attempt without retrying', async () => {
  const { result, runs } = await scenario('process.exit(0)')
  assert.deepEqual([result, runs], [0, 1])
})

test('retries a failed attempt and then succeeds', async () => {
  const { result, runs, messages } = await scenario(
    'process.exit(run < 3 ? 1 : 0)',
  )
  assert.deepEqual([result, runs, messages.length], [0, 3, 2])
})

test('stops a hanging attempt and fails after the last one', async () => {
  const { result, runs } = await scenario('setInterval(() => {}, 1000)', {
    timeoutMs: 300,
  })
  assert.deepEqual([result, runs], [1, 3])
})

test('recovers the package lock between attempts but not after the last', async () => {
  let recoveries = 0
  const { result, runs } = await scenario('process.exit(1)', {
    recover: () => {
      recoveries++
    },
  })
  assert.deepEqual([result, runs, recoveries], [1, 3, 2])
})
