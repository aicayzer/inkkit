import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
if (args.length !== 5)
  throw Error(
    'Usage: verify-literal-paste.mjs ARCHIVE BUNDLE OUTPUT HOST CLIPBOARD',
  )
const [archive, bundle, output, host, clipboard] = args.map((path) =>
  resolve(path),
)
mkdirSync(output, { recursive: true })
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const evidence = {
  contract:
    'Native pasteboard read into the host pasteAsPlainText facade; AppKit X typing. No native paste shortcut claim.',
  archive,
  archiveSha256: hash(archive),
  bundle,
  bundleSha256: hash(bundle),
  host,
  hostSha256: hash(host),
  clipboard,
  clipboardSha256: hash(clipboard),
  cases: [],
}
const backup = join(output, 'private-pasteboard-backup.json')
const restored = join(output, 'private-pasteboard-restored.json')
const clipboardCommand = (action, path) => {
  const run = spawnSync(clipboard, [action, path], {
    encoding: 'utf8',
    timeout: 15000,
  })
  if (run.status !== 0)
    throw Error('Pasteboard ' + action + ' failed: ' + run.stderr)
}
const assert = (path, equals, name) => ({
  op: 'assert',
  path,
  equals,
  ...(name ? { name } : {}),
})
const healthy = () => [assert('error', null), assert('diagnostics', [])]
const cases = [
  {
    name: 'paragraph-lf',
    source: 'before\n\ntarget\n\nafter\n',
    text: 'α\nβ',
    pasted: 'before\n\nα\\\nβ\n\nafter\n',
    completed: 'before\n\nα\\\nβX\n\nafter\n',
    readable: 'before\nα\nβX\nafter',
    selector: 'p',
    occurrence: 1,
    content: 'αβX',
    marks: null,
  },
  {
    name: 'marked-table-lf',
    source: 'before\n\n| H |\n| - |\n| **target** |\n\nafter\n',
    text: 'α\nβ',
    pasted: 'before\n\n| H |\n| - |\n| **α<br />β** |\n\nafter\n',
    completed: 'before\n\n| H |\n| - |\n| **α<br />βX** |\n\nafter\n',
    readable: 'before\nH\nα\nβX\nafter',
    selector: 'td p',
    occurrence: 0,
    content: 'αβX',
    marks: 'td strong',
    markedContent: 'αβX',
  },
  {
    name: 'marked-heading-crlf-blank-trailing',
    source: 'before\n\n# **target**\n\nafter\n',
    text: 'α\r\n\r\nβ\r\n',
    pasted: 'before\n\n# **α<br /><br />β**<br />\n\nafter\n',
    completed: 'before\n\n# **α<br /><br />β**<br />X\n\nafter\n',
    readable: 'before\nα\n\nβ\nX\nafter',
    selector: 'h1',
    occurrence: 0,
    content: 'αβX',
    marks: 'h1 strong',
    markedContent: 'αβ',
  },
  {
    name: 'source-crlf-unicode',
    source: 'before\n\ntarget\n\nafter\n',
    mode: 'source',
    text: 'α\r\n\r\nβ\r\n',
    pasted: 'before\n\nα\r\n\r\nβ\r\n\n\nafter\n',
    completed: 'before\n\nα\r\n\r\nβ\r\nX\n\nafter\n',
  },
]
let backedUp = false
try {
  clipboardCommand('save', backup)
  backedUp = true
  for (const fixture of cases) {
    const { name, source, text, pasted, completed } = fixture
    const operations = [
      ...(fixture.mode ? [{ op: 'editingMode', mode: fixture.mode }] : []),
      { op: 'selectTextRange', text: 'target', name: 'selected' },
      assert('text', 'target', 'selected'),
      {
        op: 'nativeClipboard',
        action: 'write',
        text,
        html: '<p>HTML must be ignored</p>',
        name: 'written',
      },
      { op: 'nativeClipboard', action: 'read', name: 'readBack' },
      assert('text', text, 'readBack'),
      {
        op: 'nativeClipboard',
        action: 'hostPastePlain',
        name: 'pastedClipboard',
      },
      assert('text', text, 'pastedClipboard'),
      assert('snapshot.text', pasted),
      ...healthy(),
      {
        op: 'nativeInput',
        keyCode: 7,
        characters: 'X',
        shiftKey: true,
        name: 'typed',
      },
      assert('snapshot.text', completed),
      ...healthy(),
      ...(fixture.readable
        ? [
            { op: 'textSnapshot', name: 'readable' },
            assert('text', fixture.readable, 'readable'),
            { op: 'dom', selector: fixture.selector, name: 'content' },
            assert(
              'nodes.' + fixture.occurrence + '.text',
              fixture.content,
              'content',
            ),
            ...(fixture.marks
              ? [
                  { op: 'dom', selector: fixture.marks, name: 'marks' },
                  assert('count', 1, 'marks'),
                  assert('nodes.0.text', fixture.markedContent, 'marks'),
                ]
              : []),
          ]
        : []),
      { op: 'undo' },
      assert('snapshot.text', pasted),
      { op: 'undo' },
      assert('snapshot.text', source),
      { op: 'redo' },
      assert('snapshot.text', pasted),
      { op: 'redo' },
      assert('snapshot.text', completed),
      { op: 'save', name: 'saved' },
      assert('text', completed, 'saved'),
      ...healthy(),
      { op: 'reopen', name: 'reopened' },
      assert('text', completed, 'reopened'),
      ...healthy(),
      ...(fixture.readable
        ? [
            { op: 'textSnapshot', name: 'reopenedReadable' },
            assert('text', fixture.readable, 'reopenedReadable'),
            ...(fixture.marks
              ? [
                  { op: 'dom', selector: fixture.marks, name: 'reopenedMarks' },
                  assert('count', 1, 'reopenedMarks'),
                  assert(
                    'nodes.0.text',
                    fixture.markedContent,
                    'reopenedMarks',
                  ),
                ]
              : []),
          ]
        : []),
    ]
    const input = join(output, name + '.input.json')
    const resultPath = join(output, name + '.result.json')
    writeFileSync(input, JSON.stringify({ source, operations }, null, 2))
    const run = spawnSync(host, [bundle, 'scenario', input, resultPath], {
      encoding: 'utf8',
      timeout: 60000,
    })
    let result
    try {
      result = JSON.parse(readFileSync(resultPath))
    } catch {}
    const nativeSteps =
      result?.steps?.filter((step) => step.operation === 'nativeInput') ?? []
    evidence.cases.push({
      name,
      status: run.status,
      signal: run.signal,
      error: run.error?.message,
      stderr: run.stderr,
      failedStep: result?.steps?.find((step) => !step.passed),
      diagnostics: result?.final?.diagnostics ?? [],
      nativeSteps,
      passed:
        run.status === 0 &&
        result?.passed === true &&
        !run.stderr?.includes('WKWebView:') &&
        !result.final?.error &&
        !result.final?.diagnostics?.length &&
        nativeSteps.length === 1 &&
        nativeSteps.every(
          (step) =>
            step.result?.keyWindow &&
            step.result?.active &&
            step.result.events?.some(
              (event) => event.type === 'keydown' && event.trusted,
            ),
        ),
    })
  }
} catch (error) {
  evidence.error = error.message
} finally {
  if (backedUp) {
    try {
      clipboardCommand('restore', backup)
      clipboardCommand('save', restored)
      evidence.pasteboardRestored = readFileSync(backup).equals(
        readFileSync(restored),
      )
      if (evidence.pasteboardRestored) {
        unlinkSync(backup)
        unlinkSync(restored)
      }
    } catch (error) {
      evidence.restorationError = error.message
    }
  }
  evidence.passed =
    !evidence.error &&
    evidence.pasteboardRestored === true &&
    evidence.cases.length === cases.length &&
    evidence.cases.every((test) => test.passed)
  writeFileSync(
    join(output, 'evidence.json'),
    JSON.stringify(evidence, null, 2),
  )
}
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = evidence.passed ? 0 : 1
