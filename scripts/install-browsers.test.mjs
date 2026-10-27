import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  fallbackSources,
  installBrowsers,
  useFallbackMirror,
} from './install-browsers.mjs'

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
    prepare: () => {},
    recover: () => {},
    fallback: () => {},
    log: (message) => messages.push(message),
    ...options,
  })
  return { result, runs: readFileSync(counter, 'utf8').length, messages }
}

test('succeeds on the first attempt without retrying', async () => {
  const { result, runs } = await scenario('process.exit(0)')
  assert.deepEqual([result, runs], [0, 1])
})

test('switches mirrors once, after failure and lock recovery', async () => {
  const order = []
  const { result, runs } = await scenario('process.exit(run < 3 ? 1 : 0)', {
    recover: () => order.push('recover'),
    fallback: () => order.push('fallback'),
  })
  assert.deepEqual(
    [result, runs, order],
    [0, 3, ['recover', 'fallback', 'recover']],
  )
})

test('replaces Azure and mirror-list sources without changing security sources', () => {
  assert.equal(
    fallbackSources('URIs: mirror+file:/etc/apt/apt-mirrors.txt'),
    'URIs: http://archive.ubuntu.com/ubuntu/',
  )
  assert.equal(
    fallbackSources(
      'URIs: mirror+file:///etc/apt/apt-mirrors.txt\ndeb http://azure.archive.ubuntu.com/ubuntu noble main\nURIs: http://security.ubuntu.com/ubuntu/\n',
    ),
    'URIs: http://archive.ubuntu.com/ubuntu/\ndeb http://archive.ubuntu.com/ubuntu/ noble main\nURIs: http://security.ubuntu.com/ubuntu/\n',
  )
})

test('writes changed apt sources and reports a rejected fallback', () => {
  const writes = []
  const options = {
    platform: 'linux',
    read: (path) =>
      path.endsWith('.sources')
        ? 'URIs: mirror+file:///etc/apt/apt-mirrors.txt'
        : '',
    run: (_command, args, options) => {
      writes.push([args.at(-1), options.input])
      return { status: 0 }
    },
  }
  useFallbackMirror(options)
  assert.deepEqual(writes, [
    [
      '/etc/apt/sources.list.d/ubuntu.sources',
      'URIs: http://archive.ubuntu.com/ubuntu/',
    ],
  ])
  assert.throws(
    () => useFallbackMirror({ ...options, run: () => ({ status: 1 }) }),
    /fallback mirror/,
  )
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

test('prepares once before the first attempt', async () => {
  let prepared = 0
  const { result, runs } = await scenario('process.exit(run < 2 ? 1 : 0)', {
    prepare: () => {
      prepared++
    },
    recover: () => {},
  })
  assert.deepEqual([result, runs, prepared], [0, 2, 1])
})

test('does not prepare apt when system packages are skipped', async () => {
  let prepared = 0
  const { result } = await scenario('process.exit(0)', {
    withDeps: false,
    prepare: undefined,
  })
  assert.equal(result, 0)
  assert.equal(prepared, 0)
})
