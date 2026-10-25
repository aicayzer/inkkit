import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
if (args.length !== 4)
  throw Error('Usage: verify-soft-break-spaces.mjs ARCHIVE BUNDLE OUTPUT HOST')
const [archive, bundle, output, host] = args.map((path) => resolve(path))
mkdirSync(output, { recursive: true })
const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const evidence = {
  archive,
  archiveSha256: hash(archive),
  bundle,
  bundleSha256: hash(bundle),
  host,
  hostSha256: hash(host),
  cases: [],
}
const assert = (path, equals, extra = {}) => ({
  op: 'assert',
  path,
  equals,
  ...extra,
})
for (const ending of ['\n', '\r\n'])
  for (const container of ['paragraph', 'quote'])
    for (const side of ['before', 'after']) {
      const body = container === 'quote' ? '> αlpha\n> βeta' : 'αlpha\nβeta'
      const source = (
        '__Before__ &amp;\n\n' +
        body +
        '\n\nAfter&#33;\n'
      ).replaceAll('\n', ending)
      const expected =
        side === 'before'
          ? source.replace('αlpha', 'αlpha&#x20;')
          : source.replace('βeta', '&#x20;βeta')
      const name = [container, ending === '\n' ? 'lf' : 'crlf', side].join('-')
      const inputPath = join(output, name + '.input.json')
      const resultPath = join(output, name + '.result.json')
      const text = side === 'before' ? 'αlpha' : 'βeta'
      const operations = [
        assert('snapshot.text', source),
        {
          op: 'selectTextRange',
          text,
          offset: side === 'before' ? text.length : 0,
          length: 0,
          options: { focus: true },
          name: 'caret',
        },
        assert('text', '', { name: 'caret' }),
        { op: 'nativeInput', keyCode: 49, characters: ' ' },
        assert('error', null),
        assert('diagnostics', []),
        assert('snapshot.text', expected),
        { op: 'textSnapshot', name: 'editedText' },
        { op: 'undo' },
        assert('snapshot.text', source),
        { op: 'redo' },
        assert('snapshot.text', expected),
        { op: 'save', name: 'saved' },
        assert('text', expected, { name: 'saved' }),
        assert('error', null),
        assert('diagnostics', []),
        { op: 'reopen', name: 'reopened' },
        assert('text', expected, { name: 'reopened' }),
        { op: 'textSnapshot', name: 'reopenedText' },
        {
          op: 'assert',
          name: 'reopenedText',
          path: 'text',
          equalsFrom: { name: 'editedText', path: 'text' },
        },
      ]
      writeFileSync(inputPath, JSON.stringify({ source, operations }, null, 2))
      const run = spawnSync(host, [bundle, 'scenario', inputPath, resultPath], {
        encoding: 'utf8',
        timeout: 60000,
      })
      let result
      try {
        result = JSON.parse(readFileSync(resultPath, 'utf8'))
      } catch {}
      const nativeSteps =
        result?.steps?.filter((step) => step.operation === 'nativeInput') ?? []
      const trustedSpace =
        nativeSteps.length === 1 &&
        nativeSteps.every(
          (step) =>
            step.result?.keyWindow &&
            step.result?.active &&
            step.result?.events?.some(
              (event) =>
                event.type === 'keydown' &&
                event.key === ' ' &&
                event.trusted &&
                event.collapsed === true &&
                event.selection === '',
            ) &&
            step.result?.events?.some(
              (event) =>
                event.type === 'beforeinput' &&
                event.inputType === 'insertText' &&
                event.trusted &&
                event.collapsed === true,
            ),
        )
      evidence.cases.push({
        name,
        source,
        expected,
        status: run.status,
        signal: run.signal,
        error: run.error?.message,
        stderr: run.stderr,
        trustedSpace,
        nativeSteps,
        failedSteps: result?.steps?.filter((step) => !step.passed),
        diagnostics: result?.final?.diagnostics,
        passed:
          run.status === 0 &&
          result?.passed === true &&
          !run.stderr.includes('WKWebView:') &&
          trustedSpace &&
          !result?.final?.error &&
          result?.final?.diagnostics?.length === 0,
      })
    }
evidence.passed = evidence.cases.every((test) => test.passed)
writeFileSync(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
process.exitCode = evidence.passed ? 0 : 1
