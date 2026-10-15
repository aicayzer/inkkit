import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
// @ts-expect-error The release CLI is a standalone Node script.
import { checkReleaseSource } from '../scripts/check-release-source.mjs'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true })
})

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), 'inkkit-release-source-'))
  folders.push(cwd)
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release@example.invalid')
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Published base',
  )
  const base = git('rev-parse', 'HEAD')
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Unreleased feature',
  )
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('switch', '-c', 'maintenance', base)
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Maintenance fix',
  )
  git('tag', 'v0.1.1')
  return { cwd, git, base }
}

test('a release can name a commit already on main', () => {
  const { cwd, base } = repository()
  expect(checkReleaseSource(base, '0.1.0', cwd)).toBe('main')
})

test('a maintenance release must name the matching branch tip', () => {
  const { cwd, git } = repository()
  git('update-ref', 'refs/remotes/origin/release/0.1.1', 'HEAD')
  expect(checkReleaseSource('refs/tags/v0.1.1', '0.1.1', cwd)).toBe(
    'release/0.1.1',
  )
})

test('an unmerged feature branch cannot release', () => {
  const { cwd } = repository()
  expect(() => checkReleaseSource('refs/tags/v0.1.1', '0.1.1', cwd)).toThrow(
    'neither on main',
  )
})

test('a maintenance branch for another version cannot authorize a release', () => {
  const { cwd, git } = repository()
  git('update-ref', 'refs/remotes/origin/release/0.1.2', 'HEAD')
  expect(() => checkReleaseSource('refs/tags/v0.1.1', '0.1.1', cwd)).toThrow(
    'neither on main',
  )
})

test('an obsolete maintenance candidate cannot release', () => {
  const { cwd, git } = repository()
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Reviewed correction',
  )
  git('update-ref', 'refs/remotes/origin/release/0.1.1', 'HEAD')
  expect(() => checkReleaseSource('refs/tags/v0.1.1', '0.1.1', cwd)).toThrow(
    'neither on main',
  )
})
