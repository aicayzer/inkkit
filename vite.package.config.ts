import { defineConfig } from 'vite'
import { thirdPartyNotices } from './scripts/third-party-notices'

// Mermaid stays external; the other runtime dependencies are bundled.
const external = /^mermaid(?:\/|$)/

export default defineConfig({
  plugins: [thirdPartyNotices()],
  // Fixed here so the bundle runs the same whatever the host's build defines.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
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
