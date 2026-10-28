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
            // Inkkit bundles lowlight and highlight.js into its highlight chunk.
            const group = /@aicayzer\/inkkit\/dist\/chunks\/highlight-/.test(id)
              ? 'highlighting'
              : 'other'
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
  resolve: {
    alias:
      process.env.INKKIT_CONSUMER_ENTRY === 'core'
        ? [
            {
              find: /^@aicayzer\/inkkit$/,
              replacement: '@aicayzer/inkkit/core',
            },
          ]
        : [],
  },
  build: { target: 'safari26', modulePreload: false, cssCodeSplit: false },
})
