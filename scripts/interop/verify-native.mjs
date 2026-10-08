import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const version = process.argv[5] ?? '0.0.2'
if (!['0.0.2', '0.0.3'].includes(version))
  throw Error('Native fixture version must be 0.0.2 or 0.0.3')
const bundle = resolve(
  process.argv[2] ?? '_local/interop/consumer/dist/index.html',
)
const destination = resolve(
  process.argv[3] ?? `_local/interop/regression-${version}`,
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
  'markdown-precedence': {
    source:
      '[Destination][Original] and [Retained][Original]\n\n[Original]: https://example.com/destination\n',
    operations: [
      { op: 'select', text: 'Destination' },
      {
        op: 'paste',
        input: {
          text: 'https://example.com/plaintext-ignored',
          markdown:
            '[Revised][Original]\n\n[Original]: https://example.com/original\n',
        },
      },
      contains('snapshot.text', 'Revised'),
      contains('snapshot.text', '[Retained][Original]'),
      contains('snapshot.text', 'https://example.com/destination'),
      contains('snapshot.text', 'https://example.com/original'),
      {
        op: 'assert',
        path: 'snapshot.text',
        excludes: 'https://example.com/plaintext-ignored',
      },
      { op: 'save' },
      { op: 'reopen' },
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
const excludes = (path, value, name) => ({
  op: 'assert',
  path,
  excludes: value,
  name,
})
const same = (path, resultName, resultPath, name) => ({
  op: 'assert',
  path,
  name,
  equalsFrom: { name: resultName, path: resultPath },
})
const calloutSource =
  '> [!NOTE]\n> Native note body.\n>  Indented &amp; native source.\n\n> [!TIP]+ Native custom title\n> Native tip body.\n\n> [!IMPORTANT]\n> Native important body.\n\n> [!WARNING]- Native folded title\n> Native folded body.\n\n> [!CAUTION]\n> Native caution body.\n\n> [!TODO]\n> Unsupported native callout.\n\n> [!NOTE] + Spaced fold stays literal\n> Unsupported native fold.\n'
const commentSource =
  'Public [link][Shared] <!--INLINE_SECRET <script>window.commentExecuted=true</script>--> beside %%OBSIDIAN_SECRET%% text.\n\n<!--\nBLOCK_SECRET\n-->\n\n%%\nOBSIDIAN_BLOCK_SECRET\n%%\n\n[Shared]: https://example.com/shared\n'
if (version === '0.0.3')
  Object.assign(scenarios, {
    'callout-lifecycle': {
      source: calloutSource,
      operations: [
        assert('snapshot.text', calloutSource),
        { op: 'dom', selector: '[data-inkkit-callout]', name: 'callouts' },
        assert('count', 5, 'callouts'),
        {
          op: 'dom',
          selector:
            '[data-inkkit-callout="WARNING"] [data-inkkit-callout-toggle]',
          name: 'fold',
        },
        assert('nodes.0.attributes.aria-expanded', 'false', 'fold'),
        { op: 'snapshot', name: 'beforeFold' },
        {
          op: 'domKeyDown',
          selector:
            '[data-inkkit-callout="WARNING"] [data-inkkit-callout-toggle]',
          key: 'Enter',
          name: 'expanded',
        },
        assert('nodes.0.attributes.aria-expanded', 'true', 'expanded'),
        same('snapshot.text', 'beforeFold', 'text'),
        same('snapshot.revision', 'beforeFold', 'revision'),
        same('snapshot.dirty', 'beforeFold', 'dirty'),
        {
          op: 'domKeyDown',
          selector:
            '[data-inkkit-callout="WARNING"] [data-inkkit-callout-toggle]',
          key: ' ',
          name: 'collapsed',
        },
        assert('nodes.0.attributes.aria-expanded', 'false', 'collapsed'),
        { op: 'export', name: 'foldedExport' },
        contains('text', 'Native folded body.', 'foldedExport'),
        contains('html', 'Native folded body.', 'foldedExport'),
        excludes('html', 'data-inkkit-callout-toggle', 'foldedExport'),
        excludes('html', '<button', 'foldedExport'),
        {
          op: 'select',
          text: 'Native note body.',
          selector: '[data-inkkit-callout="NOTE"] .inkkit-callout-body',
        },
        { op: 'insertText', text: 'Edited native note body.' },
        contains('snapshot.text', '> [!NOTE]\n> Edited native note body.'),
        contains('snapshot.text', '> [!WARNING]- Native folded title'),
        contains('snapshot.text', '>  Indented &amp; native source.'),
        contains('snapshot.text', '> [!TODO]\n> Unsupported native callout.'),
        contains('snapshot.text', '> [!NOTE] + Spaced fold stays literal'),
        { op: 'save' },
        { op: 'reopen' },
        assert('snapshot.dirty', false),
        {
          op: 'select',
          text: 'Edited native note body.',
          selector: '[data-inkkit-callout="NOTE"] .inkkit-callout-body',
        },
        { op: 'export', all: false, name: 'calloutSelection' },
        contains('text', 'Edited native note body.', 'calloutSelection'),
        { op: 'load', source: 'Replacement document' },
        assert('snapshot.text', 'Replacement document'),
      ],
    },
    'highlight-lifecycle': {
      source:
        'Before ==marked== **bold**==adjacent== and \\==escaped\\== plus `==code==`.\n',
      operations: [
        assert(
          'snapshot.text',
          'Before ==marked== **bold**==adjacent== and \\==escaped\\== plus `==code==`.\n',
        ),
        { op: 'dom', selector: 'mark', name: 'marks' },
        assert('count', 2, 'marks'),
        { op: 'select', text: 'marked' },
        { op: 'capture', name: 'highlightCaret' },
        contains('caretState.marks', 'highlight', 'highlightCaret'),
        { op: 'insertText', text: 'edited' },
        contains('snapshot.text', '==edited=='),
        contains('snapshot.text', '**bold**==adjacent=='),
        contains('snapshot.text', '\\==escaped\\=='),
        contains('snapshot.text', '`==code==`'),
        { op: 'select', text: 'Before' },
        { op: 'format', command: 'highlight' },
        contains('snapshot.text', '==Before=='),
        { op: 'keyDown', key: 'z', code: 'KeyZ', metaKey: true },
        excludes('snapshot.text', '==Before=='),
        { op: 'setKeymap', bindings: { highlight: ['Mod-Shift-h'] } },
        { op: 'select', text: 'Before' },
        {
          op: 'keyDown',
          key: 'h',
          code: 'KeyH',
          metaKey: true,
          shiftKey: true,
          name: 'shortcut',
        },
        assert('', true, 'shortcut'),
        contains('snapshot.text', '==Before=='),
        { op: 'export', name: 'highlightExport' },
        contains('html', '<mark>', 'highlightExport'),
        { op: 'save' },
        { op: 'reopen' },
        contains('snapshot.text', '==Before=='),
        assert('snapshot.dirty', false),
        { op: 'select', text: 'edited' },
        { op: 'export', all: false, name: 'highlightSelection' },
        contains('markdown', '==edited==', 'highlightSelection'),
        contains('html', '<mark>', 'highlightSelection'),
        {
          op: 'paste',
          input: { text: 'incoming', html: '<mark>incoming</mark>' },
        },
        contains('snapshot.text', '==incoming=='),
      ],
    },
    'comments-lifecycle': {
      source: commentSource,
      operations: [
        assert('snapshot.text', commentSource),
        { op: 'dom', selector: '.inkkit-comment', name: 'hiddenComments' },
        assert('count', 4, 'hiddenComments'),
        assert('nodes.0.display', 'none', 'hiddenComments'),
        { op: 'snapshot', name: 'beforeVisibility' },
        { op: 'setCommentsVisible', visible: true },
        same('snapshot.text', 'beforeVisibility', 'text'),
        same('snapshot.revision', 'beforeVisibility', 'revision'),
        same('snapshot.dirty', 'beforeVisibility', 'dirty'),
        { op: 'dom', selector: '.inkkit-comment', name: 'visibleComments' },
        assert('count', 4, 'visibleComments'),
        assert('nodes.0.display', 'inline', 'visibleComments'),
        assert('nodes.2.display', 'block', 'visibleComments'),
        {
          op: 'select',
          text: 'INLINE_SECRET',
          selector: '[data-inkkit-comment="html"]',
        },
        { op: 'insertText', text: 'EDITED_SECRET' },
        contains('snapshot.text', '<!--EDITED_SECRET'),
        {
          op: 'select',
          text: 'OBSIDIAN_SECRET',
          selector: '[data-inkkit-comment="obsidian"]',
        },
        { op: 'export', all: false, name: 'commentSelection' },
        assert('text', '', 'commentSelection'),
        excludes('html', 'OBSIDIAN_SECRET', 'commentSelection'),
        contains('markdown', 'OBSIDIAN_SECRET', 'commentSelection'),
        { op: 'insertText', text: 'EDITED_OBSIDIAN_SECRET' },
        contains('snapshot.text', '%%EDITED_OBSIDIAN_SECRET%%'),
        {
          op: 'select',
          text: 'BLOCK_SECRET',
          selector: '.inkkit-comment-block[data-inkkit-comment="html"]',
        },
        { op: 'insertText', text: 'EDITED_BLOCK_SECRET' },
        contains('snapshot.text', '<!--\nEDITED_BLOCK_SECRET\n-->'),
        { op: 'export', name: 'revealedExport' },
        contains('markdown', 'EDITED_SECRET', 'revealedExport'),
        contains('markdown', 'BLOCK_SECRET', 'revealedExport'),
        excludes('text', 'SECRET', 'revealedExport'),
        excludes('html', 'SECRET', 'revealedExport'),
        excludes('html', 'commentExecuted', 'revealedExport'),
        { op: 'dom', selector: 'script', name: 'scripts' },
        assert('count', 0, 'scripts'),
        { op: 'snapshot', name: 'beforeHide' },
        { op: 'setCommentsVisible', visible: false },
        same('snapshot.text', 'beforeHide', 'text'),
        same('snapshot.revision', 'beforeHide', 'revision'),
        same('snapshot.dirty', 'beforeHide', 'dirty'),
        { op: 'save' },
        { op: 'reopen' },
        contains('snapshot.text', 'EDITED_SECRET'),
        assert('snapshot.dirty', false),
        { op: 'export', name: 'hiddenExport' },
        excludes('text', 'SECRET', 'hiddenExport'),
        excludes('html', 'SECRET', 'hiddenExport'),
        { op: 'save', name: 'beforeCommentPaste' },
        { op: 'select', text: 'Public' },
        {
          op: 'paste',
          input: {
            text: 'Incoming',
            markdown:
              'Incoming <!--PASTED_SECRET--> %%PASTED_OBSIDIAN_SECRET%%',
          },
        },
        contains('snapshot.text', 'PASTED_SECRET'),
        { op: 'export', name: 'pastedComments' },
        excludes('html', 'PASTED_SECRET', 'pastedComments'),
        excludes('text', 'PASTED_SECRET', 'pastedComments'),
        { op: 'keyDown', key: 'z', code: 'KeyZ', metaKey: true },
        same('snapshot.text', 'beforeCommentPaste', 'text'),
        { op: 'load', source: '' },
        { op: 'pasteExport', sourceName: 'hiddenExport' },
        excludes('snapshot.text', 'SECRET'),
        contains('snapshot.text', 'Public'),
        contains('snapshot.text', 'https://example.com/shared'),
        { op: 'load', source: '' },
        { op: 'pasteExport', sourceName: 'hiddenExport', markdown: true },
        contains('snapshot.text', 'EDITED_SECRET'),
        contains('snapshot.text', '%%EDITED_OBSIDIAN_SECRET%%'),
        { op: 'load', source: 'Incomplete <!-- open and %% unfinished' },
        assert('snapshot.text', 'Incomplete <!-- open and %% unfinished'),
        { op: 'export', name: 'incomplete' },
        contains('text', 'open', 'incomplete'),
        contains('text', 'unfinished', 'incomplete'),
      ],
    },
    'comment-reference-provenance': {
      source:
        '[Visible <!--REFERENCE_SECRET-->][Shared] and [Collapsed %%LABEL_SECRET%%][].\n\nPublic[^note]\n\n[^note]: Required [destination <!--DEFINITION_SECRET-->][Shared].\n\n[Shared]: https://example.com/shared\n\n[Collapsed %%LABEL_SECRET%%]: https://example.com/collapsed\n',
      operations: [
        { op: 'export', name: 'referenceCopy' },
        excludes('text', 'SECRET', 'referenceCopy'),
        excludes('html', 'SECRET', 'referenceCopy'),
        excludes('html', 'secret', 'referenceCopy'),
        contains('markdown', 'REFERENCE_SECRET', 'referenceCopy'),
        contains('markdown', 'LABEL_SECRET', 'referenceCopy'),
        contains('html', 'https://example.com/shared', 'referenceCopy'),
        contains('html', 'https://example.com/collapsed', 'referenceCopy'),
        { op: 'select', text: 'Publicnote' },
        { op: 'export', all: false, name: 'requiredDefinitionCopy' },
        excludes('text', 'SECRET', 'requiredDefinitionCopy'),
        excludes('html', 'SECRET', 'requiredDefinitionCopy'),
        excludes('html', 'secret', 'requiredDefinitionCopy'),
        contains('markdown', 'DEFINITION_SECRET', 'requiredDefinitionCopy'),
        contains(
          'html',
          'https://example.com/shared',
          'requiredDefinitionCopy',
        ),
        { op: 'load', source: '' },
        { op: 'pasteExport', sourceName: 'referenceCopy' },
        excludes('snapshot.text', 'SECRET'),
        excludes('snapshot.text', 'secret'),
        contains('snapshot.text', 'https://example.com/shared'),
        contains('snapshot.text', 'https://example.com/collapsed'),
        {
          op: 'load',
          source: '[A&amp;B][]\n\n[A&amp;B]: https://example.com/safe-label\n',
        },
        { op: 'export', name: 'safeProvenance' },
        { op: 'load', source: '' },
        { op: 'pasteExport', sourceName: 'safeProvenance' },
        contains('snapshot.text', '[A&amp;B][]'),
        contains('snapshot.text', '[A&amp;B]: https://example.com/safe-label'),
      ],
    },
    'comments-and-folds-print': {
      mode: 'print',
      source:
        '> [!NOTE]- Print title\n> PRINT_VISIBLE_BODY.\n\nPublic PRINT_VISIBLE_TEXT <!--PRINT_HTML_SECRET--> %%PRINT_OBSIDIAN_SECRET%%.\n',
      operations: [
        { op: 'setCommentsVisible', visible: true },
        { op: 'export', name: 'ordinary' },
        contains('text', 'PRINT_VISIBLE_BODY', 'ordinary'),
        excludes('text', 'SECRET', 'ordinary'),
      ],
      printIncludes: [
        'PRINT_VISIBLE_BODY',
        'PRINT_VISIBLE_TEXT',
        'Print title',
      ],
      printExcludes: [
        'PRINT_HTML_SECRET',
        'PRINT_OBSIDIAN_SECRET',
        'Expand',
        'Collapse',
      ],
    },
  })
const evidence = {
  version,
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
  const run = spawnSync(
    host,
    [bundle, fixture.mode ?? 'scenario', input, output],
    {
      timeout: 120_000,
      encoding: 'utf8',
    },
  )
  let result
  try {
    result = JSON.parse(await readFile(output, 'utf8'))
  } catch {}
  const printFailures =
    fixture.mode === 'print'
      ? [
          ...(fixture.printIncludes ?? [])
            .filter((value) => !result?.print?.text?.includes(value))
            .map((value) => `Printed PDF omitted ${value}`),
          ...(fixture.printExcludes ?? [])
            .filter((value) => result?.print?.text?.includes(value))
            .map((value) => `Printed PDF included ${value}`),
        ]
      : []
  evidence.scenarios.push({
    name,
    passed:
      run.status === 0 && result?.passed === true && printFailures.length === 0,
    status: run.status,
    error: run.error?.message ?? run.stderr.trim(),
    input,
    output,
    steps: result?.steps.length ?? 0,
    ...(fixture.mode === 'print'
      ? { print: result?.print, printFailures }
      : {}),
  })
}
evidence.passed = evidence.scenarios.every((scenario) => scenario.passed)
await writeFile(
  join(destination, 'evidence.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
)
console.log(JSON.stringify(evidence, null, 2))
if (!evidence.passed) process.exitCode = 1
