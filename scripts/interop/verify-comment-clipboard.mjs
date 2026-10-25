import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const [archiveArg, bundleArg, outputArg, hostArg, clipboardArg] =
  process.argv.slice(2)
if (!archiveArg || !bundleArg || !outputArg || !hostArg || !clipboardArg)
  throw Error(
    'Usage: verify-comment-clipboard.mjs ARCHIVE BUNDLE OUTPUT HOST CLIPBOARD',
  )
const [archive, bundle, output, host] = [
  archiveArg,
  bundleArg,
  outputArg,
  hostArg,
].map((path) => resolve(path))
mkdirSync(output, { recursive: true })
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const clipboard = resolve(clipboardArg)
const backup = join(output, 'private-pasteboard-backup.json')
const restored = join(output, 'private-pasteboard-restored.json')
const clipboardCommand = (action, path) => {
  const run = spawnSync(clipboard, [action, path], {
    encoding: 'utf8',
    timeout: 15000,
  })
  if (run.status !== 0)
    throw Error(`Pasteboard ${action} failed: ${run.stderr}`)
}
clipboardCommand('save', backup)
const evidence = {
  archive,
  archiveSha256: hash(archive),
  bundle,
  bundleSha256: hash(bundle),
  host,
  hostSha256: hash(host),
  cases: [],
}
try {
  for (const [syntax, comment] of [
    ['percent', '%%PRIVATE_217%%'],
    ['html', '<!--PRIVATE_217-->'],
  ]) {
    for (const visible of [false, true]) {
      for (const path of ['native', 'host']) {
        for (const mode of ['formatted', 'source']) {
          const name = `${path}-${mode}-comment-cut-${syntax}-${visible ? 'revealed' : 'hidden'}`
          const source = `Move ${comment} here.\n\nTarget.\n`
          const operations = [
            { op: 'setCommentsVisible', visible },
            { op: 'editingMode', mode },
            mode === 'source'
              ? { op: 'selectSourceRange', from: 0, to: source.indexOf('\n') }
              : { op: 'selectContents', selector: 'p', occurrence: 0 },
            { op: 'assert', path: 'selection', includes: 'Move ' },
            ...(path === 'host'
              ? [
                  {
                    op: 'nativeClipboard',
                    action: 'hostCopy',
                    name: 'clipboard',
                  },
                  { op: 'insertText', text: '' },
                ]
              : [{ op: 'nativeClipboard', action: 'cut', name: 'clipboard' }]),
            {
              op: 'assert',
              name: 'clipboard',
              path: 'text',
              excludes: 'PRIVATE_217',
            },
            {
              op: 'assert',
              name: 'clipboard',
              path: 'html',
              excludes: 'PRIVATE_217',
            },
            { op: 'assert', path: 'snapshot.text', excludes: 'PRIVATE_217' },
            { op: 'snapshot', name: 'cut' },
            ...(mode === 'source'
              ? [{ op: 'selectSourceRange', from: '\n\nTarget.'.length }]
              : [{ op: 'select', text: 'Target.', from: 7, to: 7 }]),
            {
              op: 'nativeClipboard',
              action: path === 'host' ? 'hostPaste' : 'paste',
              name: 'pastedClipboard',
            },
            { op: 'assert', path: 'snapshot.text', includes: comment },
            { op: 'assert', path: 'snapshot.text', includes: 'Move ' },
            { op: 'snapshot', name: 'pasted' },
            { op: 'undo' },
            {
              op: 'assert',
              path: 'snapshot.text',
              equalsFrom: { name: 'cut', path: 'text' },
            },
            { op: 'undo' },
            { op: 'assert', path: 'snapshot.text', equals: source },
            { op: 'redo' },
            { op: 'redo' },
            { op: 'save', name: 'saved' },
            {
              op: 'assert',
              name: 'saved',
              path: 'text',
              equalsFrom: { name: 'pasted', path: 'text' },
            },
            { op: 'reopen', name: 'reopened' },
            {
              op: 'assert',
              name: 'reopened',
              path: 'text',
              equalsFrom: { name: 'saved', path: 'text' },
            },
          ]
          const input = join(output, name + '.input.json')
          const resultPath = join(output, name + '.result.json')
          writeFileSync(input, JSON.stringify({ source, operations }, null, 2))
          const run = spawnSync(host, [bundle, 'scenario', input, resultPath], {
            encoding: 'utf8',
            timeout: 60000,
          })
          const result = (() => {
            try {
              return JSON.parse(readFileSync(resultPath))
            } catch {
              return null
            }
          })()
          evidence.cases.push({
            name,
            status: run.status,
            signal: run.signal,
            error: run.error?.message,
            stderr: run.stderr,
            passed:
              run.status === 0 &&
              result?.passed === true &&
              !run.stderr?.includes('WKWebView:') &&
              !result.final?.error &&
              !result.final?.diagnostics?.length,
            diagnostics: result?.final?.diagnostics ?? [],
            failedStep: result?.steps?.find((step) => !step.passed),
          })
        }
      }
    }
  }
} finally {
  clipboardCommand('restore', backup)
  clipboardCommand('save', restored)
  evidence.pasteboardRestored = readFileSync(backup).equals(
    readFileSync(restored),
  )
  if (evidence.pasteboardRestored) {
    unlinkSync(backup)
    unlinkSync(restored)
  }
}
evidence.passed =
  evidence.pasteboardRestored && evidence.cases.every((test) => test.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = evidence.passed ? 0 : 1
