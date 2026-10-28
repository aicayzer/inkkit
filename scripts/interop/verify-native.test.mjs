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

test('lists all migrated cases with distinct tool requirements', () => {
  const result = run([
    '--list',
    '--group',
    'native-editing',
    '--group',
    'native-image-drag',
  ])
  assert.equal(result.status, 0, result.stderr)
  const list = JSON.parse(result.stdout)
  assert.equal(list.selected.length, 28)
  for (const [family, count] of Object.entries({
    'literal-paste': 4,
    'paste-caret': 6,
    'soft-break-spaces': 8,
    'source-redo': 2,
    'structural-deletion': 6,
    'image-drag': 2,
  }))
    assert.equal(list.groups['native-' + family].length, count)
  assert.equal(list.requirements.filter((entry) => entry.clipboard).length, 4)
  assert.equal(
    list.requirements.filter((entry) => entry.host === 'image-drag').length,
    2,
  )
  assert.ok(list.groups.legacy.every((name) => !name.startsWith('native-')))
})

test('checks native key identities, collapsed selection and beforeinput independently', async () => {
  const { validateNative } = await import('./native-results.mjs')
  const result = {
    steps: [
      {
        operation: 'nativeInput',
        result: {
          keyWindow: true,
          active: true,
          events: [
            {
              type: 'keydown',
              key: ' ',
              trusted: true,
              collapsed: true,
              selection: '',
            },
            {
              type: 'beforeinput',
              inputType: 'insertText',
              trusted: true,
              collapsed: true,
            },
          ],
        },
      },
    ],
  }
  const expected = [
    { key: ' ', collapsed: true, selection: '', beforeinput: 'insertText' },
  ]
  assert.deepEqual(validateNative(result, expected), [])
  for (const mutate of [
    (value) => {
      value.steps[0].result.events[0].trusted = false
    },
    (value) => {
      value.steps[0].result.events[0].key = 'X'
    },
    (value) => {
      value.steps[0].result.events[0].collapsed = false
    },
    (value) => {
      value.steps[0].result.events.pop()
    },
    (value) => {
      value.steps[0].result.active = false
    },
    (value) => {
      value.steps = []
    },
  ]) {
    const changed = structuredClone(result)
    mutate(changed)
    assert.ok(validateNative(changed, expected).length)
  }
})

test('history boundary changes only Date.now and restores it on every exit', async () => {
  const { withHistoryClock } = await import('./consumer/history-clock.mjs')
  const original = Object.getOwnPropertyDescriptor(Date, 'now')
  await withHistoryClock(true, async (boundary) => {
    const before = Date.now()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(Date.now(), before)
    assert.deepEqual(boundary(), { before, after: before + 1_000 })
    assert.equal(Date.now(), before + 1_000)
    assert.notEqual(new Date().getTime(), before)
  })
  assert.deepEqual(Object.getOwnPropertyDescriptor(Date, 'now'), original)
  await assert.rejects(
    withHistoryClock(true, () => {
      throw Error('setup failed')
    }),
    /setup failed/,
  )
  assert.deepEqual(Object.getOwnPropertyDescriptor(Date, 'now'), original)
  await assert.rejects(
    withHistoryClock(false, (boundary) => boundary()),
    /requires historyClock/,
  )
})

const withFakeNative = async (callback) => {
  const directory = mkdtempSync(join(tmpdir(), 'inkkit-native-tools-'))
  try {
    const bundle = join(directory, 'index.html')
    const archive = join(directory, 'candidate.tgz')
    const host = join(directory, 'host.mjs')
    const clipboard = join(directory, 'clipboard.mjs')
    const board = join(directory, 'board.json')
    const original = '{"items":[{"text":"original","custom":"bytes"}]}'
    writeFileSync(bundle, '<html>candidate</html>')
    writeFileSync(archive, 'archive')
    writeFileSync(board, original)
    writeFileSync(
      join(directory, 'consumer-evidence.json'),
      JSON.stringify({
        version: '9.8.7',
        entry: 'index',
        tarballSha256: createHash('sha256').update('archive').digest('hex'),
        bundleSha256: createHash('sha256')
          .update('<html>candidate</html>')
          .digest('hex'),
      }),
    )
    writeFileSync(
      host,
      `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs'
const fixture = JSON.parse(readFileSync(process.argv[4], 'utf8'))
if (fixture.clipboard) writeFileSync(${JSON.stringify(board)}, 'changed')
if (fixture.crash) process.exit(2)
if (fixture.noOutput) process.exit(0)
writeFileSync(process.argv[5], fixture.malformed ? '{' : JSON.stringify({ passed: true, steps: [], pageErrors: [] }))
`,
      { mode: 0o755 },
    )
    writeFileSync(
      clipboard,
      `#!${process.execPath}
import { copyFileSync } from 'node:fs'
if (process.argv[2] === 'save') copyFileSync(${JSON.stringify(board)}, process.argv[3])
else copyFileSync(process.argv[3], ${JSON.stringify(board)})
`,
      { mode: 0o755 },
    )
    const { runScenarios } = await import('./runner.mjs')
    let count = 0
    const execute = (descriptor, extra = {}) =>
      runScenarios({
        bundle,
        host,
        tools: { archive, clipboard },
        destination: join(directory, 'results-' + count++),
        scenarios: { example: descriptor },
        selected: ['example'],
        requestedGroups: [],
        command: ['test'],
        ...extra,
      })
    await callback({
      directory,
      bundle,
      archive,
      host,
      clipboard,
      board,
      original,
      execute,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('protects pasteboard on success, child failure and validation failure', async () => {
  await withFakeNative(async ({ execute, board, original }) => {
    for (const descriptor of [
      { fixture: { clipboard: true } },
      { fixture: { clipboard: true, crash: true } },
      {
        fixture: { clipboard: true },
        validate: () => ['required native event absent'],
      },
    ]) {
      const evidence = await execute({ ...descriptor, clipboard: true })
      assert.equal(evidence.pasteboardRestored, true)
      assert.equal(readFileSync(board, 'utf8'), original)
      assert.equal(
        evidence.passed,
        !descriptor.fixture.crash && !descriptor.validate,
      )
    }
  })
})

test('restoration mismatch fails and preserves the private recovery backup', async () => {
  await withFakeNative(async ({ execute, clipboard, directory }) => {
    writeFileSync(
      clipboard,
      `#!${process.execPath}
import { writeFileSync } from 'node:fs'
if (process.argv[2] === 'save') writeFileSync(process.argv[3], process.argv[3].includes('-restored.') ? 'different' : 'original')
`,
      { mode: 0o755 },
    )
    const evidence = await execute({ fixture: {}, clipboard: true })
    assert.equal(evidence.passed, false)
    assert.equal(evidence.pasteboardRestored, false)
    assert.equal(
      readFileSync(
        join(directory, 'results-0/private-pasteboard-backup.json'),
        'utf8',
      ),
      'original',
    )
    const blocked = await execute(
      { fixture: {}, clipboard: true },
      { destination: join(directory, 'results-0') },
    )
    assert.match(blocked.error, /Retained pasteboard backup exists/)
  })
})

test('rejects missing tools, mismatched archives and stale or malformed results', async () => {
  await withFakeNative(async ({ execute, archive, directory }) => {
    await assert.rejects(
      execute({ fixture: {}, clipboard: true }, { tools: {} }),
      /require --clipboard/,
    )
    await assert.rejects(
      execute(
        { fixture: { variant: 'block' }, hostKind: 'image-drag' },
        { tools: {} },
      ),
      /requires --image-drag-host/,
    )
    writeFileSync(archive, 'other archive')
    await assert.rejects(execute({ fixture: {} }), /archive does not match/)
    writeFileSync(archive, 'archive')
    for (const fixture of [
      { malformed: true },
      { noOutput: true },
      { crash: true },
    ]) {
      const destination = join(directory, 'stale')
      const { mkdirSync } = await import('node:fs')
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'example.result.json'), '{"passed":true}')
      const evidence = await execute({ fixture }, { destination })
      assert.equal(evidence.passed, false)
      assert.ok(
        evidence.scenarios[0].validationFailures.some((failure) =>
          failure.startsWith('Cannot read native result'),
        ),
      )
    }
  })
})

test('uses the specialised drag arguments and preserves destination validation', async () => {
  await withFakeNative(async ({ execute, directory, archive }) => {
    const drag = join(directory, 'drag.mjs')
    writeFileSync(
      drag,
      `#!${process.execPath}
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[3], JSON.stringify({ variant: process.argv[4] }))
`,
      { mode: 0o755 },
    )
    const descriptor = {
      hostKind: 'image-drag',
      fixture: { variant: 'inline' },
      validate: (result) =>
        result?.variant === 'inline' ? [] : ['wrong variant'],
    }
    const evidence = await execute(descriptor, {
      tools: { archive, 'image-drag-host': drag },
    })
    assert.equal(evidence.passed, true)
    assert.equal(evidence.scenarios[0].host, drag)
    const { validateImageDrag } = await import('./scenarios/image-drag.mjs')
    const fixture = { variant: 'inline' }
    const snapshot = {
      text: 'Before ![Drag label](private-authored-image.png) after.\n',
      revision: 0,
    }
    const result = {
      before: { snapshot, displayURL: 'data:image/png;base64,fixture' },
      after: { snapshot, diagnostics: [] },
      acceptedDrop: false,
      events: [
        { type: 'dragstart', trusted: true },
        { type: 'dragend', trusted: true },
      ],
      destination: [
        {
          phase: 'draggingEntered',
          text: 'Drag label',
          html: '<p>Drag label</p>',
        },
      ],
    }
    assert.deepEqual(validateImageDrag(result, fixture), [])
    result.destination[0].html += 'data:image/png;base64,fixture'
    assert.ok(
      validateImageDrag(result, fixture).some((failure) =>
        failure.includes('leaked'),
      ),
    )
    result.after = { snapshot: { ...snapshot, revision: 1 } }
    assert.ok(
      validateImageDrag(result, fixture).some((failure) =>
        failure.includes('source or revision'),
      ),
    )
  })
})

test('fails when clipboard restoration exits unsuccessfully', async () => {
  await withFakeNative(async ({ execute, clipboard }) => {
    writeFileSync(
      clipboard,
      `#!${process.execPath}
import { writeFileSync } from 'node:fs'
if (process.argv[2] === 'save') writeFileSync(process.argv[3], 'original')
else process.exit(2)
`,
      { mode: 0o755 },
    )
    const evidence = await execute({ fixture: {}, clipboard: true })
    assert.equal(evidence.passed, false)
    assert.match(evidence.restorationError, /Pasteboard restore failed/)
  })
})

test('requires final diagnostics for strict native scenarios', async () => {
  await withFakeNative(async ({ execute }) => {
    const evidence = await execute({ fixture: {}, strict: true })
    assert.equal(evidence.passed, false)
    assert.ok(
      evidence.scenarios[0].validationFailures.includes(
        'Native editor reported errors or diagnostics',
      ),
    )
  })
})
