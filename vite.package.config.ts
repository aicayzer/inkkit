import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// The package ships its dependencies bundled, so hosts run the exact tree
// that InkKit tests. Mermaid stays a dependency: it draws previews and never
// changes saved bytes, and bundling it would multiply the package size.
const external = /^mermaid(?:\/|$)/

// A few packages ship no licence file. Their MIT notice comes from the
// upstream repository's licence, with its copyright line.
const missingLicenceCopyright: Record<string, string> = {
  // https://github.com/shlroland/remark-highlight-mark/blob/master/License
  'mdast-util-highlight-mark': 'Copyright (c) 2024 remark-highlight-mark',
  'micromark-extension-highlight-mark':
    'Copyright (c) 2024 remark-highlight-mark',
}

const mit = (copyright: string) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

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
          ) as { name: string; version: string; license?: string }
          if (!manifest.license)
            throw new Error(`${manifest.name} declares no licence`)
          const file = readdirSync(root).find((name) =>
            /^(?:licen[cs]e|copying)(?:\.|$)/i.test(name),
          )
          const copyright = missingLicenceCopyright[manifest.name]
          if (!file && (manifest.license !== 'MIT' || !copyright))
            throw new Error(
              `${manifest.name} ships no licence file; add its copyright line to missingLicenceCopyright`,
            )
          return {
            title: `${manifest.name}@${manifest.version} (${manifest.license})`,
            text: file
              ? readFileSync(join(root, file), 'utf8').trim()
              : mit(copyright!),
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
  // Fixed here so the bundle runs the same whatever the host's build defines,
  // and the bundled Vue sets no feature flags on the host's window.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
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
