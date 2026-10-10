import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { writeFileSync } from 'node:fs'
let sizes = {}
export default defineConfig({
  plugins: [
    {
      name: 'consumer-module-evidence',
      generateBundle(_options, bundle) {
        sizes = {}
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue
          for (const [id, module] of Object.entries(chunk.modules)) {
            const group =
              /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(mermaid|lowlight|highlight.js)\//.exec(
                id,
              )?.[1] ?? 'other'
            sizes[group] = (sizes[group] ?? 0) + module.renderedLength
          }
        }
      },
      writeBundle() {
        writeFileSync(
          'dist/module-sizes.json',
          JSON.stringify(sizes, null, 2) + '\n',
        )
      },
    },
    viteSingleFile(),
  ],
  build: { target: 'safari26', modulePreload: false, cssCodeSplit: false },
})
