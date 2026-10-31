import assert from 'node:assert/strict'
import test from 'node:test'
import { scope } from './ci-scope.mjs'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('prose skips editor and website builds', () => {
  assert.deepEqual(scope(['docs/api.md', 'README.md', 'AGENTS.md']), {
    editor: false,
    site: false,
    swift: false,
    playground: false,
  })
})
test('Mintlify pages and configuration build the website', () => {
  assert.deepEqual(
    scope(['docs/index.mdx', 'docs/docs.json', 'docs/.mintignore']),
    { editor: false, site: true, swift: false, playground: false },
  )
})
test('website branding does not run editor tests', () => {
  assert.deepEqual(
    scope(['docs/logo.svg', 'docs/styles.css', 'docs/fonts/body.woff2']),
    {
      editor: false,
      site: true,
      swift: false,
      playground: false,
    },
  )
})
test('mixed, unknown and workflow changes retain editor checks', () => {
  for (const path of [
    'src/core.ts',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    'docs/example.ts',
    'scripts/ci-scope.mjs',
  ]) {
    assert.deepEqual(scope(['docs/index.mdx', path]), {
      editor: true,
      site: true,
      swift: path === '.github/workflows/ci.yml',
      playground: [
        'pnpm-lock.yaml',
        '.github/workflows/ci.yml',
        'scripts/ci-scope.mjs',
      ].includes(path),
    })
  }
})
test('the Swift package, its fixtures and its job run the swift job', () => {
  for (const path of [
    'Package.swift',
    'apple/Sources/InkKitRTF/Reader.swift',
    'apple/Tests/InkKitRTFTests/ReaderTests.swift',
    'test/formats/rtf/fixtures/basic.json',
    '.github/workflows/ci.yml',
  ]) {
    assert.equal(scope([path]).swift, true, path)
    assert.equal(scope(['docs/api.md', path]).swift, true, path)
  }
})
test('editor, prose and website changes skip the swift job', () => {
  for (const path of [
    'src/core.ts',
    'docs/api.md',
    'docs/index.mdx',
    'test/formats/rtf/other.json',
    'applesauce/file.ts',
    'Package.swift.md',
  ]) {
    assert.equal(scope([path]).swift, false, path)
  }
})
test('an engine change runs the editor lane without the playground lane', () => {
  assert.deepEqual(scope(['src/core.ts', 'test/format.test.ts']), {
    editor: true,
    site: false,
    swift: false,
    playground: false,
  })
})
test('playground, demo and preset changes run the playground lane', () => {
  for (const path of [
    'playground/main.ts',
    'src/style.css',
    'src/themes/calm.css',
    'test/browser/playground-tools.spec.ts',
    'test/browser/docs-demo-themes.spec.ts',
    'test/browser/fixtures.ts',
    'playwright.config.ts',
    'pnpm-lock.yaml',
  ])
    assert.equal(scope([path]).playground, true, path)
  assert.deepEqual(scope(['docs/snippets/editor-demo.mdx']), {
    editor: false,
    site: true,
    swift: false,
    playground: true,
  })
})
test('empty changes fail safe; moves out of docs retain editor checks', () => {
  assert.equal(scope([]).editor, true)
  assert.equal(scope([]).swift, true)
  assert.equal(scope([]).playground, true)
  assert.equal(scope(['docs/example.md', 'src/example.md']).editor, true)
})

test('real branches exclude unrelated main changes and preserve release gates', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'inkkit-ci-scope-'))
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const commit = (path, text) => {
    writeFileSync(join(cwd, path), text)
    git('add', '.')
    git(
      '-c',
      'user.name=CI test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'fixture',
    )
    return git('rev-parse', 'HEAD')
  }
  const output = join(cwd, 'outputs')
  const run = (event, ref, base, head) => {
    writeFileSync(output, '')
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./ci-scope.mjs', import.meta.url))],
      {
        cwd,
        env: {
          ...process.env,
          EVENT: event,
          REF: ref,
          BASE: base,
          HEAD: head,
          GITHUB_OUTPUT: output,
        },
        encoding: 'utf8',
      },
    )
    return { status: result.status, output: readFileSync(output, 'utf8') }
  }
  try {
    git('init', '-q', '-b', 'main')
    const start = commit('README.md', 'Original\n')
    git('switch', '-qc', 'docs')
    const head = commit('README.md', 'Revised\n')
    git('switch', '-q', 'main')
    const base = commit('editor.js', 'export const changed = true\n')
    assert.deepEqual(run('pull_request', 'refs/pull/1/merge', base, head), {
      status: 0,
      output: 'editor=false\nsite=false\nswift=false\nplayground=false\n',
    })
    assert.deepEqual(run('push', 'refs/tags/v1', start, head), {
      status: 0,
      output: 'editor=true\nsite=true\nswift=true\nplayground=true\n',
    })
    assert.deepEqual(run('workflow_dispatch', 'refs/heads/main', start, head), {
      status: 0,
      output: 'editor=true\nsite=true\nswift=true\nplayground=true\n',
    })
    assert.notEqual(
      run('pull_request', 'refs/pull/1/merge', 'missing-ref', head).status,
      0,
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
