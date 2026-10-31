import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function scope(paths) {
  const prose = (path) =>
    /^(README|AGENTS|CLAUDE)\.md$/.test(path) || /^docs\/.*\.md$/.test(path)
  const site = (path) =>
    path.startsWith('docs/') &&
    (/\.(mdx|css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/.test(path) ||
      /^docs\/(docs\.json|\.mintignore)$/.test(path))
  // The Swift package reads the shared RTF fixtures; the workflow edits that
  // define its job must also run it.
  const swift = (path) =>
    path === 'Package.swift' ||
    path === '.github/workflows/ci.yml' ||
    path.startsWith('apple/') ||
    path.startsWith('test/formats/rtf/fixtures/')
  // The playground and demo specs run in their own lane. The demo snippet is
  // site content, so this lane does not depend on the editor lane.
  const playground = (path) =>
    path.startsWith('playground/') ||
    path.startsWith('docs/snippets/') ||
    path === 'src/style.css' ||
    path.startsWith('src/themes/') ||
    path.startsWith('scripts/interop/consumer/') ||
    /^test\/browser\/(playground-.*|docs-demo-.*|fixtures)\.(spec\.)?ts$/.test(
      path,
    ) ||
    /^(playwright.*\.ts|vite.*\.(ts|mjs)|package\.json|pnpm-lock\.yaml)$/.test(
      path,
    ) ||
    /^scripts\/(browser-fixture.*|test-browser|ci-scope)\.mjs$/.test(path) ||
    path === '.github/workflows/ci.yml'
  return {
    editor:
      paths.length === 0 || paths.some((path) => !prose(path) && !site(path)),
    site: paths.some(site),
    swift: paths.length === 0 || paths.some(swift),
    playground: paths.length === 0 || paths.some(playground),
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { EVENT, BASE, HEAD, GITHUB_OUTPUT } = process.env
  let result = { editor: true, site: true, swift: true, playground: true }
  // Tags, manual/reusable release runs and missing history retain every gate.
  if (EVENT === 'pull_request' && BASE && !/^0+$/.test(BASE) && HEAD) {
    const paths = execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', '-z', `${BASE}...${HEAD}`],
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
    `editor=${result.editor}\nsite=${result.site}\nswift=${result.swift}\nplayground=${result.playground}\n`,
  )
}
