import assert from 'node:assert/strict'
import test from 'node:test'
import { scope } from './ci-scope.mjs'

test('prose skips editor and website builds', () => {
  assert.deepEqual(scope(['docs/api.md', 'README.md', 'AGENTS.md']), {
    editor: false,
    site: false,
  })
})
test('Mintlify pages and configuration build the website', () => {
  assert.deepEqual(
    scope(['docs/index.mdx', 'docs/docs.json', 'docs/.mintignore']),
    { editor: false, site: true },
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
    })
  }
})
test('empty changes fail safe; moves out of docs retain editor checks', () => {
  assert.equal(scope([]).editor, true)
  assert.equal(scope(['docs/example.md', 'src/example.md']).editor, true)
})
