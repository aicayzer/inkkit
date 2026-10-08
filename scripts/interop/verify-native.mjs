import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const bundle = resolve(
  process.argv[2] ?? '_local/interop/consumer/dist/index.html',
)
const destination = resolve(
  process.argv[3] ?? '_local/interop/regression-0.0.2',
)
const host = resolve(process.argv[4] ?? '_local/interop/webkit-host')
await mkdir(destination, { recursive: true })
const assert = (path, equals, name) => ({ op: 'assert', path, equals, name })
const contains = (path, includes, name) => ({
  op: 'assert',
  path,
  includes,
  name,
})
const source =
  '\uFEFF# Preserved heading\r\n\r\nBefore [Alpha][Authored] and [Authored][] and [Authored], repeated[^Note].\r\n\r\n[Authored]: <https://example.com/original> "Shared title"\r\n\r\n[^Note]: Footnote body with [nested][Authored].\r\n\r\n    Second paragraph.\r\n\r\n[Unused]: https://example.com/unused\r\n\r\n[Unresolved][Missing]\r\n'
const scenarios = {
  'reference-lifecycle': {
    source,
    operations: [
      assert('snapshot.text', source),
      { op: 'select', text: 'Alpha' },
      { op: 'insertText', text: 'Beta' },
      contains('snapshot.text', '[Beta][Authored]'),
      contains('snapshot.text', '[Authored][] and [Authored]'),
      contains('snapshot.text', '[Unused]: https://example.com/unused'),
      contains('snapshot.text', '[Unresolved][Missing]'),
      {
        op: 'editReferenceDefinition',
        label: 'Authored',
        destination: 'https://example.com/updated',
        title: 'Updated title',
      },
      contains('snapshot.text', 'https://example.com/updated'),
      contains('snapshot.text', 'Updated title'),
      { op: 'save', name: 'saved' },
      { op: 'reopen' },
      assert('snapshot.dirty', false),
      contains('snapshot.text', '[Beta][Authored]'),
      contains('snapshot.text', 'https://example.com/updated'),
      { op: 'snapshot', generation: 1, expectedError: 'stale-document' },
      { op: 'export', name: 'full' },
      contains('markdown', '[Beta][Authored]', 'full'),
      contains('markdown', '[^Note]:', 'full'),
    ],
  },
  'collapsed-selection': {
    source:
      '[Original][] and [Original].\n\n[Original]: https://example.com/original\n',
    operations: [
      { op: 'select', text: 'Original', occurrence: 0 },
      { op: 'insertText', text: 'Revised' },
      contains('snapshot.text', '[Revised][Original] and [Original]'),
      { op: 'select', text: 'Revised' },
      { op: 'export', all: false, name: 'partial' },
      contains('markdown', '[Revised][Original]', 'partial'),
      contains('markdown', '[Original]:', 'partial'),
      { op: 'keyDown', key: 'z', code: 'KeyZ', metaKey: true, name: 'undo' },
      assert('', true, 'undo'),
      assert(
        'snapshot.text',
        '[Original][] and [Original].\n\n[Original]: https://example.com/original\n',
      ),
    ],
  },
  'footnote-lifecycle': {
    source,
    operations: [
      {
        op: 'select',
        text: 'Footnote body',
        selector: '[data-inkkit-footnote-definition]',
      },
      { op: 'navigateFootnote', target: 'reference', name: 'reference' },
      assert('', true, 'reference'),
      { op: 'navigateFootnote', target: 'definition', name: 'definition' },
      assert('', true, 'definition'),
      {
        op: 'select',
        text: 'Footnote body',
        selector: '[data-inkkit-footnote-definition]',
      },
      { op: 'insertText', text: 'Edited footnote' },
      contains(
        'snapshot.text',
        '[^Note]: Edited footnote with [nested][Authored]',
      ),
      contains('snapshot.text', '    Second paragraph.'),
      { op: 'save' },
      { op: 'reopen' },
      contains('snapshot.text', '[^Note]: Edited footnote'),
      { op: 'select', text: 'Before ', from: 7, to: 7 },
      { op: 'insertFootnote', label: 'Fresh' },
      contains('snapshot.text', '[^Fresh]'),
      contains('snapshot.text', '[^Fresh]:'),
      { op: 'keyDown', key: 'z', code: 'KeyZ', metaKey: true, name: 'undo' },
      assert('', true, 'undo'),
      { op: 'assert', path: 'snapshot.text', excludes: '[^Fresh]' },
    ],
  },
  'label-collision': {
    source:
      '[Destination][Original]\n\n[Original]: https://example.com/destination\n',
    operations: [
      { op: 'select', text: 'Destination', from: 11, to: 11 },
      {
        op: 'paste',
        input: {
          text: 'Revised',
          markdown:
            '[Revised][Original]\n\n[Original]: https://example.com/original\n',
        },
      },
      contains('snapshot.text', 'https://example.com/destination'),
      contains('snapshot.text', 'https://example.com/original'),
      { op: 'save' },
      { op: 'reopen' },
      contains('snapshot.text', 'https://example.com/destination'),
      contains('snapshot.text', 'https://example.com/original'),
      { op: 'export', name: 'full' },
      contains('html', 'https://example.com/destination', 'full'),
      contains('html', 'https://example.com/original', 'full'),
    ],
  },
  'literal-txt': {
    source: 'Literal [reference][Label]\r\n[^note]: unchanged\r\n',
    format: 'txt',
    operations: [
      assert(
        'snapshot.text',
        'Literal [reference][Label]\r\n[^note]: unchanged\r\n',
      ),
      { op: 'select', text: 'reference' },
      { op: 'insertText', text: 'edited' },
      contains('snapshot.text', '[edited][Label]'),
      { op: 'save' },
      { op: 'reopen' },
      assert('snapshot.dirty', false),
      { op: 'export', name: 'full' },
      contains('text', '[edited][Label]', 'full'),
    ],
  },
}
const evidence = {
  bundle,
  bundleSha256: createHash('sha256')
    .update(await readFile(bundle))
    .digest('hex'),
  host,
  hostSha256: createHash('sha256')
    .update(await readFile(host))
    .digest('hex'),
  testedAt: new Date().toISOString(),
  scenarios: [],
}
for (const [name, fixture] of Object.entries(scenarios)) {
  const input = join(destination, `${name}.input.json`)
  const output = join(destination, `${name}.result.json`)
  await writeFile(input, `${JSON.stringify(fixture, null, 2)}\n`)
  const run = spawnSync(host, [bundle, 'scenario', input, output], {
    timeout: 120_000,
    encoding: 'utf8',
  })
  let result
  try {
    result = JSON.parse(await readFile(output, 'utf8'))
  } catch {}
  evidence.scenarios.push({
    name,
    passed: run.status === 0 && result?.passed === true,
    status: run.status,
    error: run.error?.message ?? run.stderr.trim(),
    input,
    output,
    steps: result?.steps.length ?? 0,
  })
}
evidence.passed = evidence.scenarios.every((scenario) => scenario.passed)
await writeFile(
  join(destination, 'evidence.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
)
console.log(JSON.stringify(evidence, null, 2))
if (!evidence.passed) process.exitCode = 1
