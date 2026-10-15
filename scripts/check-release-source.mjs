import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function checkReleaseSource(ref, version, cwd = process.cwd()) {
  if (!ref) throw new Error('A release ref is required')
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`)
  try {
    git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main')
    return 'main'
  } catch {
    // A maintenance release excludes newer features already on main.
  }
  const maintenance = `refs/remotes/origin/release/${version}`
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    try {
      if (git('rev-parse', '--verify', maintenance) === commit)
        return `release/${version}`
    } catch {
      // An absent maintenance branch is not release authorization.
    }
  }
  throw new Error(
    `Tagged commit ${commit} is neither on main nor the tip of release/${version}`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  try {
    console.log(
      `Release source: ${checkReleaseSource(process.env.GITHUB_REF, version)}`,
    )
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}
