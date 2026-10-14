import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// The package ships its dependencies bundled, so hosts run the exact tree
// that InkKit tests. Mermaid stays a dependency: it draws previews and never
// changes saved bytes, and bundling it would multiply the package size.
const external = /^mermaid(?:\/|$)/

// MIT, BSD and similar licences require their notices to travel with copies,
// so the build collects them from every bundled package.
function thirdPartyNotices(): Plugin {
  return {
    name: 'inkkit-third-party-notices',
    generateBundle(_, bundle) {
      const packages = new Map<string, string>()
      for (const output of Object.values(bundle))
        if (output.type === 'chunk')
          for (const id of output.moduleIds) {
            const root = packageRoot(id)
            if (root) packages.set(root, root)
          }
      const notices = [...packages.keys()]
        .map((root) => {
          const manifest = JSON.parse(
            readFileSync(join(root, 'package.json'), 'utf8'),
          ) as {
            name: string
            version: string
            license?: string
            author?: string | { name: string }
            repository?: string | { url: string }
          }
          if (!manifest.license)
            throw new Error(`${manifest.name} declares no licence`)
          const file = readdirSync(root).find((name) =>
            /^(?:licen[cs]e|copying)(?:\.|$)/i.test(name),
          )
          const author =
            typeof manifest.author === 'object'
              ? manifest.author.name
              : manifest.author
          const repository =
            typeof manifest.repository === 'object'
              ? manifest.repository.url
              : manifest.repository
          return {
            title: `${manifest.name}@${manifest.version} (${manifest.license})`,
            // A few packages ship no licence file; name the licence, the
            // author and the source instead.
            text: file
              ? readFileSync(join(root, file), 'utf8').trim()
              : [
                  `Licensed under ${manifest.license}. The package includes no licence text.`,
                  author && `Author: ${author}`,
                  repository && `Source: ${repository}`,
                ]
                  .filter(Boolean)
                  .join('\n'),
          }
        })
        .sort((a, b) => a.title.localeCompare(b.title))
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-NOTICES.txt',
        source:
          'InkKit bundles these packages. Each keeps its own licence.\n\n' +
          notices
            .map(({ title, text }) => `${title}\n\n${text}\n`)
            .join('\n' + '-'.repeat(72) + '\n\n'),
      })
    },
  }
}

// The directory of the installed package that holds a bundled module.
function packageRoot(id: string): string | undefined {
  const path = id.replace(/^\0/, '').split('?')[0]!
  const marker = path.lastIndexOf('/node_modules/')
  if (marker < 0) return undefined
  const rest = path.slice(marker + '/node_modules/'.length).split('/')
  const name = rest[0]!.startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)
  return join(path.slice(0, marker), 'node_modules', ...name)
}

export default defineConfig({
  plugins: [thirdPartyNotices()],
  // Fixed here so the bundle runs the same whatever the host's build defines.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    lib: {
      entry: { index: 'src/index.ts', core: 'src/core.ts' },
      formats: ['es'],
    },
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      external: (id) => external.test(id),
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
})
