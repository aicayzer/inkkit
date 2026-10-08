import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = process.cwd()
const temp = await mkdtemp(join(tmpdir(), 'inkkit-consumer-'))
const run = (command, args, cwd = temp) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
try {
  const [packed] = JSON.parse(
    run('npm', ['pack', '--json', '--pack-destination', temp], root),
  )
  if (
    packed.files.some(
      (file) =>
        !/^(dist\/|LICENSE$|NOTICE$|README\.md$|package\.json$)/.test(
          file.path,
        ),
    )
  )
    throw new Error('Unexpected published files')
  const tarball = join(temp, packed.filename)
  await writeFile(
    join(temp, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@aicayzer/inkkit': `file:${tarball}` },
      devDependencies: {
        typescript: '7.0.2',
        vite: '8.3.3',
        'vite-plugin-singlefile': '2.3.3',
      },
    }),
  )
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ])
  await writeFile(
    join(temp, 'index.html'),
    '<html><body><div id="editor"></div><script type="module" src="/main.ts"></script></body></html>',
  )
  await writeFile(
    join(temp, 'main.ts'),
    `import {InkKitEditor, InkKitError, type DocumentSnapshot, type ImageAdapter} from '@aicayzer/inkkit';\nimport '@aicayzer/inkkit/style.css';\nconst editor = await InkKitEditor.mount(document.querySelector<HTMLElement>('#editor')!, {changed(){},stateChanged(){},copy(){},openLink(){}});\neditor.loadDocument({documentId:'consumer',generation:1,format:'md',text:'# Consumer\\n'});\nconst snapshot: DocumentSnapshot = editor.snapshot(1);\nwindow.editor = editor; window.snapshot = snapshot; void InkKitError;\ndeclare global {interface Window {editor:typeof editor;snapshot:DocumentSnapshot}}\n`,
  )
  await writeFile(
    join(temp, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ['vite/client'],
        lib: ['ES2022', 'DOM'],
      },
      include: ['main.ts'],
    }),
  )
  await writeFile(
    join(temp, 'vite.config.mjs'),
    "import {defineConfig} from 'vite'; import {viteSingleFile} from 'vite-plugin-singlefile'; export default defineConfig({plugins:[viteSingleFile()],build:{target:'safari18',modulePreload:false,cssCodeSplit:false}})",
  )
  run(join(temp, 'node_modules/.bin/tsc'), ['--noEmit'])
  run(join(temp, 'node_modules/.bin/vite'), ['build'])
  const html = await readFile(join(temp, 'dist/index.html'), 'utf8')
  if (/<script[^>]+\bsrc=|<link[^>]+\bhref=/i.test(html))
    throw new Error('The web-view consumer is not bundled offline')
  const destination = resolve('_local/release')
  await mkdir(destination, { recursive: true })
  await copyFile(tarball, join(destination, packed.filename))
  const sha256 = createHash('sha256')
    .update(await readFile(tarball))
    .digest('hex')
  const evidence = {
    version: packed.version,
    filename: packed.filename,
    sha256,
    integrity: packed.integrity,
    checks: [
      'allowlist',
      'fresh npm install',
      'public declarations',
      'CSS export',
      'offline Vite bundle',
    ],
  }
  await writeFile(
    join(destination, 'package-evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString())
  if (error.stderr) console.error(error.stderr.toString())
  throw error
} finally {
  await rm(temp, { recursive: true, force: true })
}
