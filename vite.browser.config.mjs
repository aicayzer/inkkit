import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { fixtureRoutes } from './scripts/browser-fixture-routes.mjs'

const repository = fileURLToPath(new URL('.', import.meta.url))

// All entries share one graph: fault injection must reach the playground's class.
export default defineConfig({
  root: resolve(repository, 'playground'),
  appType: 'mpa',
  plugins: [fixtureRoutes(repository)],
  build: {
    target: 'es2022',
    outDir: resolve(repository, '_local/browser-fixture'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      input: {
        playground: resolve(repository, 'playground/index.html'),
        core: resolve(repository, 'src/core.ts'),
        preservation: resolve(repository, 'src/preserve.ts'),
      },
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: (chunk) =>
          ['core', 'preservation'].includes(chunk.name)
            ? '_test/[name].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
})
