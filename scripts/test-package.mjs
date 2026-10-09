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
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex')

export async function checkConsumer(packageSpec, version) {
  const temp = await mkdtemp(join(tmpdir(), 'inkkit-consumer-'))
  try {
    await writeFile(
      join(temp, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: { '@aicayzer/inkkit': packageSpec },
        devDependencies: {
          typescript: '7.0.2',
          vite: '8.3.3',
          'vite-plugin-singlefile': '2.3.3',
        },
      }),
    )
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--registry=https://registry.npmjs.org/',
        '--cache',
        join(temp, 'npm-cache'),
      ],
      temp,
    )
    const installed = JSON.parse(
      await readFile(
        join(temp, 'node_modules/@aicayzer/inkkit/package.json'),
        'utf8',
      ),
    )
    if (installed.name !== '@aicayzer/inkkit' || installed.version !== version)
      throw new Error('Clean consumer installed an unexpected package version')
    await writeFile(
      join(temp, 'index.html'),
      '<html><body><div id="editor"></div><script type="module" src="/main.ts"></script></body></html>',
    )
    await writeFile(
      join(temp, 'main.ts'),
      `import {InkKitEditor, InkKitError, type DocumentSnapshot, type ImageAdapter, type PrintableDocument, type PrintableWarning, type TableCommand, type TableOptions, type EditingMode, type Heading, type EditorOptions, type TextInputPreferences, type CommandState, type EditorLabels} from '@aicayzer/inkkit';\nimport '@aicayzer/inkkit/style.css';\nconst preferences: TextInputPreferences = {spellcheck:false,autocorrect:false,autocapitalize:'none'}; const labels: Partial<EditorLabels> = {formattedEditor:'Document'}; const options: EditorOptions = {editable:true,textInput:preferences,labels,keymap:{heading6:['Mod-6'],undo:[],tableExit:[]}}; const editor = await InkKitEditor.mount(document.querySelector<HTMLElement>('#editor')!, {changed(){},stateChanged(){},commandStateChanged(state:CommandState){void state.commands.undo},copy(){},openLink(){}}, options);\neditor.loadDocument({documentId:'consumer',generation:1,format:'md',text:'# Consumer\\n'});\nconst mode: EditingMode = 'source'; editor.setEditingMode(mode,1); editor.replaceSource('# Consumer source\\nBody\\n',1); editor.replaceAll('Body','Literal $&',1); editor.undo(1); editor.redo(1); editor.setEditingMode('formatted',1); const headings: readonly Heading[] = editor.headings(1); if(headings[0]) editor.navigateHeading(headings[0]); editor.find('Body',1); editor.replace('Body','Content',1); const snapshot: DocumentSnapshot = editor.snapshot(1);\nconst printable: PrintableDocument = await editor.printableSnapshot(1);\nconst styles: string = printable.styles; const warnings: readonly PrintableWarning[] = printable.warnings; void styles; void warnings;\nconst tableCommand: TableCommand = 'sortRows'; const tableOptions: TableOptions = {column:0,comparison:'number',order:'ascending'}; editor.table(tableCommand,tableOptions);\nconst state: CommandState = editor.commandState(1); void state.commands.table.sortRows; editor.setEditable(false); const editable: boolean = editor.editable; void editable; editor.setTextInputPreferences({}); editor.setEditable(true);\nwindow.editor = editor; window.snapshot = snapshot; void InkKitError;\ndeclare global {interface Window {editor:typeof editor;snapshot:DocumentSnapshot}}\n`,
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
    run(join(temp, 'node_modules/.bin/tsc'), ['--noEmit'], temp)
    run(join(temp, 'node_modules/.bin/vite'), ['build'], temp)
    const html = await readFile(join(temp, 'dist/index.html'), 'utf8')
    if (/<script[^>]+\bsrc=|<link[^>]+\bhref=/i.test(html))
      throw new Error('The web-view consumer is not bundled offline')
    return { offlineBundleSha256: sha256(html) }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

async function testPackage() {
  const root = process.cwd()
  const temp = await mkdtemp(join(tmpdir(), 'inkkit-pack-'))
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
    const consumer = await checkConsumer(`file:${tarball}`, packed.version)
    const archive = await readFile(tarball)
    const destination = resolve('_local/release', packed.version)
    await mkdir(destination, { recursive: true })
    await copyFile(tarball, join(destination, packed.filename))
    const evidence = {
      commit: run('git', ['rev-parse', 'HEAD'], root).trim(),
      workingTreeDirty:
        run('git', ['status', '--porcelain'], root).trim() !== '',
      version: packed.version,
      filename: packed.filename,
      sha256: sha256(archive),
      integrity: packed.integrity,
      decompressedTarSha256: sha256(gunzipSync(archive)),
      ...consumer,
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
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await testPackage()
  } catch (error) {
    if (error.stdout) console.error(error.stdout.toString())
    if (error.stderr) console.error(error.stderr.toString())
    throw error
  }
}
