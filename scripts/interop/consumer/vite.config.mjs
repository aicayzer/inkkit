import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'safari26', modulePreload: false, cssCodeSplit: false },
})
