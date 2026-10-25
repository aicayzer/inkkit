import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function scope(paths) {
  const prose = (path) =>
    /^(README|AGENTS|CLAUDE)\.md$/.test(path) || /^docs\/.*\.md$/.test(path)
  const site = (path) =>
    path.startsWith('docs/') &&
    (/\.mdx$/.test(path) || /^docs\/(docs\.json|\.mintignore)$/.test(path))
  return {
    editor:
      paths.length === 0 || paths.some((path) => !prose(path) && !site(path)),
    site: paths.some(site),
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { EVENT, REF, BASE, HEAD, GITHUB_OUTPUT } = process.env
  let result = { editor: true, site: true }
  // Tags, manual/reusable release runs and missing history retain every gate.
  if (
    (EVENT === 'pull_request' ||
      (EVENT === 'push' && REF === 'refs/heads/main')) &&
    BASE &&
    !/^0+$/.test(BASE) &&
    HEAD
  ) {
    const range =
      EVENT === 'pull_request' ? [`${BASE}...${HEAD}`] : [BASE, HEAD]
    const paths = execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', ...range],
      {
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean)
    result = scope(paths)
  }
  appendFileSync(
    GITHUB_OUTPUT,
    `editor=${result.editor}\nsite=${result.site}\n`,
  )
}
