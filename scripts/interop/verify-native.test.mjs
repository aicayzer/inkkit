import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const runner = fileURLToPath(new URL('./verify-native.mjs', import.meta.url))
const run = (args, env = {}) =>
  spawnSync(process.execPath, [runner, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })

test('defaults to current core without a fixture version or installed bundle', () => {
  const result = run(['--list'])
  assert.equal(result.status, 0, result.stderr)
  const list = JSON.parse(result.stdout)
  assert.deepEqual(list.selected, list.groups.core)
  assert.ok(list.selected.includes('source-three-inputs-shared-history'))
  assert.ok(
    Object.values(list.groups).every(
      (names) => !names.some((name) => name.startsWith('intentional-')),
    ),
  )
  for (const args of [
    ['--group', 'missing'],
    ['--scenario', 'missing'],
    ['a', 'b', 'c', '0.3.1'],
  ])
    assert.notEqual(run([...args, '--list']).status, 0)
})

test('records the built package version and refuses mismatched metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inkkit-native-runner-'))
  try {
    const bundle = join(directory, 'index.html')
    const host = join(directory, 'host.mjs')
    const destination = join(directory, 'results')
    writeFileSync(bundle, '<html>candidate</html>')
    writeFileSync(
      host,
      `#!${process.execPath}
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[5], JSON.stringify({ passed: true, steps: [], pageErrors: process.env.PAGE_ERROR ? ['uncaught failure'] : [] }))
if (process.env.STDERR_ERROR) process.stderr.write('WKWebView page error: unhandled rejection\\n')
`,
      { mode: 0o755 },
    )
    const metadata = {
      version: '9.8.7',
      entry: 'core',
      tarballSha256: 'archive-hash',
      bundleSha256: createHash('sha256')
        .update('<html>candidate</html>')
        .digest('hex'),
    }
    writeFileSync(
      join(directory, 'consumer-evidence.json'),
      JSON.stringify(metadata),
    )
    const args = [bundle, destination, host, '--group', 'core']
    const result = run(args)
    assert.equal(result.status, 0, result.stderr)
    const evidence = JSON.parse(
      readFileSync(join(destination, 'evidence.json'), 'utf8'),
    )
    assert.equal(evidence.version, '9.8.7')
    assert.equal(evidence.entry, 'core')
    assert.equal(evidence.tarballSha256, 'archive-hash')
    assert.notEqual(run(args, { PAGE_ERROR: '1' }).status, 0)
    assert.notEqual(run(args, { STDERR_ERROR: '1' }).status, 0)
    writeFileSync(bundle, '<html>other</html>')
    assert.match(run(args).stderr, /does not match this bundle/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
