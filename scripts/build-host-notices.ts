import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'vite'
import { thirdPartyNotices } from './third-party-notices.ts'

// The package keeps Mermaid external. Collect the actual modules a host
// bundles, including dynamic diagram imports, without shipping another copy.
const fileName = 'THIRD-PARTY-NOTICES-FULL.txt'
const core = await readFile('dist/THIRD-PARTY-NOTICES.txt', 'utf8')
const result = await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [
    thirdPartyNotices(
      fileName,
      'Full-entry reference for the Inkkit release lockfile.\n' +
        'Hosts must also generate notices for their own resolved bundle.\n\n' +
        core +
        '\n' +
        '-'.repeat(72) +
        '\n\n' +
        'Mermaid and its bundled dependencies:\n\n',
    ),
  ],
  build: {
    lib: { entry: 'dist/index.js', formats: ['es'] },
    write: false,
    copyPublicDir: false,
    minify: false,
    sourcemap: false,
  },
})
const outputs = Array.isArray(result) ? result : [result]
const notice = outputs
  .flatMap((output) => ('output' in output ? output.output : []))
  .find((output) => output.type === 'asset' && output.fileName === fileName)
if (!notice || notice.type !== 'asset')
  throw new Error('The full-entry notices were not emitted')
await writeFile(`dist/${fileName}`, notice.source)
