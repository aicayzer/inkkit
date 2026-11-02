import { writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { build } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { editorDemoHtml } from './docs-demo.mjs'

const output = resolve('_local/docs-demo')
const scratch = resolve('_local/docs-demo-build')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
try {
  for (const kind of ['full', 'compact']) {
    const source = resolve(scratch, kind)
    await mkdir(source, { recursive: true })
    await cp('dist', resolve(source, 'inkkit-package'), { recursive: true })
    const html = editorDemoHtml({ fullPage: kind === 'full' }).replace(
      '<head>',
      `<head><meta name="inkkit-revision" content="${revision}">`,
    )
    await writeFile(resolve(source, 'index.html'), html)
    await build({
      configFile: false,
      root: source,
      base: './',
      plugins: [viteSingleFile()],
      build: {
        target: 'safari18',
        modulePreload: false,
        cssCodeSplit: false,
        outDir: resolve(source, 'built'),
      },
    })
    await cp(
      resolve(source, 'built/index.html'),
      resolve(output, `${kind}.html`),
    )
  }
  await cp(
    'dist/THIRD-PARTY-NOTICES.txt',
    resolve(output, 'THIRD-PARTY-NOTICES.txt'),
  )
  await cp('LICENSE', resolve(output, 'LICENSE.txt'))
  await writeFile(resolve(output, '.nojekyll'), '')
  await writeFile(
    resolve(output, 'revision.json'),
    JSON.stringify({ revision }) + '\n',
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}
