import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const positional = []
const requestedGroups = []
const requestedScenarios = []
let list = false
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index]
  if (argument === '--list') list = true
  else if (argument === '--group' || argument === '--scenario') {
    const value = process.argv[++index]
    if (!value || value.startsWith('--'))
      throw Error(`Missing value for ${argument}`)
    ;(argument === '--group' ? requestedGroups : requestedScenarios).push(value)
  } else if (argument.startsWith('--'))
    throw Error(`Unknown option: ${argument}`)
  else positional.push(argument)
}
if (positional.length > 4)
  throw Error('Expected at most BUNDLE OUTPUT_DIRECTORY HOST_BINARY VERSION')
const version = positional[3] ?? '0.0.2'
const versions = [
  '0.0.2',
  '0.0.3',
  '0.0.4',
  '0.0.5',
  '0.0.6',
  '0.0.7',
  '0.0.8',
  '0.0.9',
  '0.0.10',
  '0.0.11',
]
if (!versions.includes(version))
  throw Error(`Native fixture version must be one of ${versions.join(', ')}`)
const releaseAtLeast = (target) =>
  versions.indexOf(version) >= versions.indexOf(target)
const bundle = resolve(
  positional[0] ?? '_local/interop/consumer/dist/index.html',
)
const destination = resolve(
  positional[1] ?? `_local/interop/regression-${version}`,
)
const host = resolve(positional[2] ?? '_local/interop/webkit-host')
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
  '> [!NOTE] Native &#13; title\n> Native note body.\n>  Indented &amp; native source.\n\n> [!TIP]+ Native &#10; title\n> Native tip body.\n\n> [!IMPORTANT]\n> Native important body.\n\n> [!WARNING]- Native folded title\n> Native folded body.\n\n- > [!CAUTION] Native nested title\n  > Native caution body.\n\n> [!TODO]\n> Unsupported native callout.\n\n> [!NOTE] + Spaced fold stays literal\n> Unsupported native fold.\n'
const commentSource =
  'Public [link][Shared] <!--INLINE_SECRET <script>window.commentExecuted=true</script>--> beside %%OBSIDIAN_SECRET%% text.\n\n<!--\nBLOCK_SECRET\n-->\n\n%%\nOBSIDIAN_BLOCK_SECRET\n%%\n\n[Shared]: https://example.com/shared\n'
if (releaseAtLeast('0.0.3'))
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
        contains(
          'snapshot.text',
          '> [!NOTE] Native &#13; title\n> Edited native note body.',
        ),
        contains('snapshot.text', '> [!WARNING]- Native folded title'),
        contains('snapshot.text', '>  Indented &amp; native source.'),
        contains('snapshot.text', '> [!TODO]\n> Unsupported native callout.'),
        contains('snapshot.text', '> [!NOTE] + Spaced fold stays literal'),
        {
          op: 'select',
          text: 'Native caution body.',
          selector: '[data-inkkit-callout="CAUTION"] .inkkit-callout-body',
        },
        { op: 'insertText', text: 'Edited native caution body.' },
        contains(
          'snapshot.text',
          '- > [!CAUTION] Native nested title\n  > Edited native caution body.',
        ),
        {
          op: 'select',
          text: 'Native tip body.',
          selector: '[data-inkkit-callout="TIP"] .inkkit-callout-body',
        },
        { op: 'insertText', text: 'Edited native tip body.' },
        contains(
          'snapshot.text',
          '> [!TIP]+ Native &#10; title\n> Edited native tip body.',
        ),
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
        { op: 'export', name: 'authoredCalloutTitles' },
        { op: 'load', source: '' },
        { op: 'pasteExport', sourceName: 'authoredCalloutTitles' },
        contains('snapshot.text', '> [!NOTE] Native &#13; title'),
        contains('snapshot.text', '> [!TIP]+ Native &#10; title'),
        contains('snapshot.text', '- > [!CAUTION] Native nested title'),
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
        { op: 'selectContents', selector: 'p', text: 'Public' },
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
        '> [!NOTE]- Print title\n> PRINTVISIBLEBODY.\n>\n' +
        Array.from(
          { length: 45 },
          (_, index) =>
            `> Printed continuation ${index + 1} across the complete folded body.`,
        ).join('\n>\n') +
        '\n>\n> PRINTFINALSENTINEL.\n\nPublic PRINTVISIBLETEXT <!--PRINTHTMLSECRET--> %%PRINTOBSIDIANSECRET%%.\n',
      operations: [
        { op: 'setCommentsVisible', visible: true },
        { op: 'export', name: 'ordinary' },
        contains('text', 'PRINTVISIBLEBODY', 'ordinary'),
        excludes('text', 'SECRET', 'ordinary'),
      ],
      printIncludes: [
        'PRINTVISIBLEBODY',
        'PRINTVISIBLETEXT',
        'Print title',
        'PRINTFINALSENTINEL',
      ],
      printMinPages: 2,
      printExcludes: [
        'PRINTHTMLSECRET',
        'PRINTOBSIDIANSECRET',
        'Expand',
        'Collapse',
      ],
    },
  })
if (releaseAtLeast('0.0.4')) {
  const flowchart = 'flowchart TD\n    A[Start] --> B[Finish]'
  const authored = `\uFEFFBefore **bold**.\r\n\r\n~~~~mermaid\r\n${flowchart.replaceAll('\n', '\r\n')}\r\n~~~~\r\n\r\nAfter &amp; preserved.\r\n`
  const editedSurrounding = authored.replace('Before', 'Changed')
  const exportedImage = (name) => [
    assert('diagrams.length', 1, name),
    contains('diagrams.0.source', 'flowchart TD', name),
    assert('diagrams.0.image.mimeType', 'image/png', name),
    contains('diagrams.0.image.bytesBase64', 'iVBOR', name),
    assert('images.length', 1, name),
    assert('images.0.image.mimeType', 'image/png', name),
    contains('html', '<img', name),
    excludes('html', '<svg', name),
  ]
  Object.assign(scenarios, {
    'mermaid-source-lifecycle': {
      source: authored,
      operations: [
        assert('snapshot.text', authored),
        { op: 'select', text: 'Before', selector: 'p' },
        { op: 'insertText', text: 'Changed' },
        assert('snapshot.text', editedSurrounding),
        { op: 'save', name: 'surrounding' },
        { op: 'reopen' },
        same('snapshot.text', 'surrounding', 'text'),
        { op: 'awaitDOM', selector: '.inkkit-mermaid-preview svg' },
        { op: 'select', text: 'Start', selector: 'pre code' },
        { op: 'insertText', text: 'Beginning' },
        assert(
          'snapshot.text',
          editedSurrounding.replace('Start', 'Beginning'),
        ),
        { op: 'keyDown', key: 'z', code: 'KeyZ', metaKey: true },
        assert('snapshot.text', editedSurrounding),
        { op: 'select', text: 'Start', selector: 'pre code' },
        { op: 'insertText', text: 'Beginning' },
        { op: 'save', name: 'edited' },
        { op: 'reopen' },
        assert('snapshot.dirty', false),
        same('snapshot.text', 'edited', 'text'),
        { op: 'export', name: 'savedDiagram' },
        same('markdown', 'edited', 'text', 'savedDiagram'),
        contains('diagrams.0.source', 'Beginning', 'savedDiagram'),
        { op: 'load', source: 'Replacement document' },
        assert('snapshot.text', 'Replacement document'),
        { op: 'awaitDOM', selector: '.inkkit-mermaid-preview', count: 0 },
        { op: 'export', name: 'replacement' },
        assert('diagrams.length', 0, 'replacement'),
        assert('images.length', 0, 'replacement'),
      ],
    },
    'mermaid-clipboard-selections': {
      source: authored,
      operations: [
        { op: 'export', name: 'whole' },
        assert('markdown', authored, 'whole'),
        ...exportedImage('whole'),
        contains('text', 'Before', 'whole'),
        contains('text', 'After', 'whole'),
        { op: 'selectContents', selector: 'pre' },
        { op: 'export', all: false, name: 'diagramOnly' },
        ...exportedImage('diagramOnly'),
        contains('markdown', '~~~~mermaid', 'diagramOnly'),
        contains('markdown', 'A[Start] --> B[Finish]', 'diagramOnly'),
        excludes('markdown', 'Before', 'diagramOnly'),
        excludes('markdown', 'After', 'diagramOnly'),
        { op: 'selectBlocks', fromSelector: 'p', toSelector: 'pre' },
        { op: 'export', all: false, name: 'mixed' },
        ...exportedImage('mixed'),
        contains('markdown', 'Before **bold**.', 'mixed'),
        contains('markdown', '~~~~mermaid', 'mixed'),
        contains('html', '<strong>bold</strong>', 'mixed'),
        excludes('markdown', 'After', 'mixed'),
        { op: 'load', source: '' },
        { op: 'paste', input: { text: flowchart, markdown: authored } },
        contains('snapshot.text', '~~~~mermaid'),
        { op: 'export', name: 'pasted' },
        ...exportedImage('pasted'),
      ],
    },
    'mermaid-sequence': {
      source:
        '```mermaid\nsequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Welcome\n```\n',
      operations: [
        { op: 'awaitDOM', selector: '.inkkit-mermaid-preview svg' },
        { op: 'export', name: 'sequence' },
        assert('diagrams.length', 1, 'sequence'),
        contains('diagrams.0.source', 'sequenceDiagram', 'sequence'),
        assert('diagrams.0.image.mimeType', 'image/png', 'sequence'),
        contains('diagrams.0.image.bytesBase64', 'iVBOR', 'sequence'),
        contains('markdown', 'Bob-->>Alice: Welcome', 'sequence'),
        { op: 'security', name: 'safe' },
        assert('externalResources.length', 0, 'safe'),
        assert('activeElements', 0, 'safe'),
      ],
    },
    'mermaid-literal-txt': {
      source: authored,
      format: 'txt',
      operations: [
        assert('snapshot.text', authored),
        { op: 'select', text: 'Start' },
        { op: 'insertText', text: 'Plain' },
        assert('snapshot.text', authored.replace('Start', 'Plain')),
        { op: 'save' },
        { op: 'reopen' },
        { op: 'export', name: 'literal' },
        contains('text', '~~~~mermaid', 'literal'),
        contains('text', 'A[Plain] --> B[Finish]', 'literal'),
        assert('images.length', 0, 'literal'),
      ],
    },
  })
  for (const [name, source] of Object.entries({
    invalid: 'flowchart TD\nA[Unclosed',
    unsupported: 'unsupportedDiagram\nretained source',
    directive: '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA-->B',
    callback: 'flowchart TD\nA-->B\nclick A inkkitUnsafeCallback',
    external: 'flowchart TD\nA-->B\nclick A "https://example.com/inkkit-probe"',
    html: 'flowchart TD\nA["<img src=https://example.com/inkkit-probe onerror=window.inkkitUnsafeCallback=true>"]',
  })) {
    const markdown = `Before fallback.\n\n~~~mermaid\n${source}\n~~~\n\nAfter fallback.\n`
    scenarios[`mermaid-fallback-${name}`] = {
      source: markdown,
      operations: [
        assert('snapshot.text', markdown),
        { op: 'export', name: 'fallback' },
        assert('markdown', markdown, 'fallback'),
        assert('diagrams.length', 1, 'fallback'),
        {
          op: 'assert',
          path: 'diagrams.0.error',
          truthy: true,
          name: 'fallback',
        },
        assert('images.length', 0, 'fallback'),
        contains('text', source, 'fallback'),
        contains('html', 'Before fallback.', 'fallback'),
        contains('html', 'After fallback.', 'fallback'),
        { op: 'security', name: 'protected' },
        assert('callbackExecuted', false, 'protected'),
        assert('externalResources.length', 0, 'protected'),
        assert('activeElements', 0, 'protected'),
        { op: 'save', name: 'retained' },
        { op: 'reopen' },
        same('snapshot.text', 'retained', 'text'),
        { op: 'load', source: 'Safe replacement' },
        assert('snapshot.text', 'Safe replacement'),
      ],
    }
  }
}
if (releaseAtLeast('0.0.5')) {
  const imageData =
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAYAAABpYH0BAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAUKADAAQAAAABAAAAKAAAAADbisV7AAAAlUlEQVRoBe3SMQ0AIQAEQR4X6MC/Nj5BAtvO9dtM7jtrn2HPAvO5FF4BgPEIAAFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPjIA/2VgCmiePpoIAAAAASUVORK5CYII='
  const imageSource =
    'Before image.\n\n![Authored](images/fixture.png)\n\nAfter image.\n'
  const longBody = Array.from(
    { length: 65 },
    (_, index) =>
      `> Folded paragraph ${index + 1}: Full printed body spans pages and retains the authored source even when its editor presentation is collapsed.\n>\n`,
  ).join('')
  const unbroken =
    'UNBROKEN_START_' + '0123456789abcdef'.repeat(50) + '_UNBROKEN_END'
  const markdown = `# Frozen print heading\n\nBefore latest edit with [Reference][Shared], footnote[^Note] and ==PRINT_HIGHLIGHT==. <!--PRINT_PRIVATE_HTML--> %%PRINT_PRIVATE_OBSIDIAN%%\n\n![Authored](images/fixture.png)\n\n![Portrait](images/portrait.png)\n\n\`\`\`mermaid\nflowchart TD\nA[Printed start] --> B[Printed finish]\n\`\`\`\n\n> [!WARNING]- PRINT_FOLDED_TITLE\n${longBody}> PRINT_FOLDED_LAST\n\n| Column | Content |\n| --- | --- |\n| PRINT_TABLE | ${unbroken} |\n\n\`\`\`text\n${unbroken}\n\`\`\`\n\nPRINT_FINAL_SENTINEL\n\n[Shared]: https://example.com/printed "Printed reference"\n\n[^Note]: PRINT_FOOTNOTE_BODY with **formatting**.\n\n    PRINT_FOOTNOTE_CONTINUATION\n`
  Object.assign(scenarios, {
    'printable-frozen-multipage': {
      printPortrait: { width: 120, height: 2400 },
      source: markdown,
      mode: 'printable',
      printMinPages: 4,
      printMinImages: 3,
      printIncludes: [
        'Frozen print heading',
        'Latest captured edit',
        'Reference',
        'PRINT_HIGHLIGHT',
        'PRINT_FOLDED_TITLE',
        'Folded paragraph 1:',
        'Folded paragraph 65:',
        'PRINT_FOLDED_LAST',
        'PRINT_TABLE',
        'UNBROKEN_START_',
        '_UNBROKEN_END',
        'PRINT_FOOTNOTE_BODY',
        'PRINT_FOOTNOTE_CONTINUATION',
        'PRINT_FINAL_SENTINEL',
      ],
      printExcludes: [
        'PRINT_PRIVATE_HTML',
        'PRINT_PRIVATE_OBSIDIAN',
        'LIVE_EDITOR_REPLACEMENT_NOT_IN_PDF',
        'Expand callout',
        'Collapse callout',
      ],
      operations: [
        {
          op: 'imageFixture',
          reference: 'images/portrait.png',
          width: 120,
          height: 2400,
          name: 'portrait',
        },
        { op: 'setCommentsVisible', visible: true },
        { op: 'dom', selector: '[data-inkkit-callout-toggle]', name: 'folded' },
        assert('nodes.0.attributes.aria-expanded', 'false', 'folded'),
        { op: 'select', text: 'Before latest edit' },
        {
          op: 'insertPrintable',
          text: 'Latest captured edit',
          name: 'printable',
        },
        assert('documentId', 'interop', 'printable'),
        assert('format', 'md', 'printable'),
        same(
          'generation',
          'printable',
          'sourceSnapshot.generation',
          'printable',
        ),
        same('revision', 'printable', 'sourceSnapshot.revision', 'printable'),
        assert('sourceSnapshot.dirty', true, 'printable'),
        contains('sourceSnapshot.text', 'Latest captured edit', 'printable'),
        contains('html', '<!DOCTYPE html>', 'printable'),
        contains('html', '<style>', 'printable'),
        contains('html', '<mark>PRINT_HIGHLIGHT</mark>', 'printable'),
        contains('html', '<table>', 'printable'),
        contains('html', 'https://example.com/printed', 'printable'),
        contains('html', 'Folded paragraph 65:', 'printable'),
        ...[
          'PRINT_PRIVATE_HTML',
          'PRINT_PRIVATE_OBSIDIAN',
          'contenteditable',
          '<button',
          '.ProseMirror',
          'memo-image:',
          '<svg',
          'data-inkkit-callout-toggle',
        ].map((value) => excludes('html', value, 'printable')),
        assert('warnings.length', 0, 'printable'),
        assert('assets.length', 3, 'printable'),
        assert('htmlImageCount', 3, 'printable'),
        assert('assets.0.bytesBase64', imageData, 'printable'),
        assert('assetGeometry.0.width', 80, 'printable'),
        assert('assetGeometry.0.height', 40, 'printable'),
        same('assets.1.bytesBase64', 'portrait', 'bytesBase64', 'printable'),
        assert('assetGeometry.1.width', 120, 'printable'),
        assert('assetGeometry.1.height', 2400, 'printable'),
        ...[0, 1, 2].flatMap((index) => [
          assert(`assets.${index}.mimeType`, 'image/png', 'printable'),
          assert(`assetGeometry.${index}.htmlBytesMatch`, true, 'printable'),
        ]),
        {
          op: 'assert',
          path: 'assetGeometry.2.width',
          truthy: true,
          name: 'printable',
        },
        {
          op: 'assert',
          path: 'assetGeometry.2.height',
          truthy: true,
          name: 'printable',
        },
        { op: 'load', source: 'LIVE_EDITOR_REPLACEMENT_NOT_IN_PDF' },
        assert('snapshot.text', 'LIVE_EDITOR_REPLACEMENT_NOT_IN_PDF'),
      ],
    },
    'printable-invalid-diagram': {
      source:
        'Before fallback.\n\n```mermaid\nflowchart TD\nA[Unclosed\n```\n\nAfter fallback.\n',
      mode: 'printable',
      printIncludes: [
        'Before fallback.',
        'flowchart TD',
        'A[Unclosed',
        'After fallback.',
      ],
      operations: [
        { op: 'printable', name: 'printable' },
        assert('warnings.length', 1, 'printable'),
        assert('warnings.0.code', 'diagram-unavailable', 'printable'),
        {
          op: 'assert',
          path: 'warnings.0.message',
          truthy: true,
          name: 'printable',
        },
        assert('assets.length', 0, 'printable'),
        contains('html', 'A[Unclosed', 'printable'),
        { op: 'load', source: 'Safe replacement' },
      ],
    },
    'printable-literal-txt': {
      source:
        '\uFEFF# Literal **Markdown**\r\n<script>PRINT_LITERAL_SCRIPT</script>\r\n%%PRINT_LITERAL_COMMENT%%\r\nPRINT_TXT_FINAL\r\n',
      format: 'txt',
      mode: 'printable',
      printIncludes: [
        '# Literal **Markdown**',
        '<script>PRINT_LITERAL_SCRIPT</script>',
        '%%PRINT_LITERAL_COMMENT%%',
        'PRINT_TXT_FINAL',
      ],
      operations: [
        { op: 'snapshot', name: 'source' },
        { op: 'printable', name: 'printable' },
        assert('format', 'txt', 'printable'),
        same('generation', 'source', 'generation', 'printable'),
        same('revision', 'source', 'revision', 'printable'),
        assert('assets.length', 0, 'printable'),
        assert('warnings.length', 0, 'printable'),
        contains(
          'html',
          '&lt;script&gt;PRINT_LITERAL_SCRIPT&lt;/script&gt;',
          'printable',
        ),
        excludes('html', '<script>', 'printable'),
        { op: 'load', source: 'Live TXT replacement' },
      ],
    },
    'printable-lifecycle-failures': {
      source: 'Printable lifecycle text',
      operations: [
        { op: 'printable', generation: 0, expectedError: 'stale-document' },
        { op: 'composition', active: true },
        { op: 'printable', expectedError: 'composition' },
        { op: 'composition', active: false },
        { op: 'printable', name: 'afterComposition' },
        contains('html', 'Printable lifecycle text', 'afterComposition'),
        { op: 'startImagePaste' },
        { op: 'printable', expectedError: 'operation-pending' },
        { op: 'finishImagePaste' },
        { op: 'printable', name: 'afterPaste' },
        assert('assets.length', 1, 'afterPaste'),
      ],
    },
    'printable-image-failures': {
      source: imageSource,
      operations: [
        { op: 'imageExport', mode: 'reject' },
        { op: 'printable', expectedError: 'image-unavailable' },
        { op: 'imageExport', mode: 'corrupt' },
        { op: 'printable', expectedError: 'image-unavailable' },
        { op: 'imageExport', mode: 'normal' },
        { op: 'printable', name: 'recovered' },
        assert('assets.length', 1, 'recovered'),
        assert('assetGeometry.0.width', 80, 'recovered'),
        { op: 'load', source: 'Safe replacement' },
      ],
    },
    'printable-revision-race': {
      source: imageSource,
      operations: [
        { op: 'imageExport', mode: 'hold' },
        { op: 'startPrintable' },
        { op: 'select', text: 'Before image.' },
        { op: 'insertText', text: 'Changed during export.' },
        { op: 'finishPrintable', expectedError: 'stale-document' },
        { op: 'imageExport', mode: 'normal' },
        { op: 'printable', name: 'current' },
        contains('html', 'Changed during export.', 'current'),
      ],
    },
    'printable-generation-race': {
      source: imageSource,
      operations: [
        { op: 'imageExport', mode: 'hold' },
        { op: 'startPrintable' },
        {
          op: 'load',
          source: 'Replacement during export.',
          documentId: 'replacement',
        },
        { op: 'finishPrintable', expectedError: 'stale-document' },
        { op: 'imageExport', mode: 'normal' },
        { op: 'printable', name: 'current' },
        assert('documentId', 'replacement', 'current'),
        contains('html', 'Replacement during export.', 'current'),
      ],
    },
  })
}

if (releaseAtLeast('0.0.6')) {
  const richTable =
    '\uFEFFBefore table.\r\n\r\n| Name | Value | Detail |\r\n| :--- | ---: | :---: |\r\n| Bravo | 2 | **bold** [ref][Shared] and note[^Note] |\r\n| Alpha | 1 | `code` ==highlight== ![opaque](images/fixture.png) |\r\n| Equal | 2 | third detail |\r\n\r\nAfter table.\r\n\r\n[Shared]: https://example.com/shared "Authored"\r\n\r\n[^Note]: Retained footnote.\r\n'
  const undo = { op: 'keyDown', key: 'z', code: 'KeyZ', metaKey: true }
  Object.assign(scenarios, {
    'table-row-movement': {
      source: richTable,
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'select', text: 'Name' },
        { op: 'table', command: 'moveRowDown', name: 'headerMove' },
        assert('', false, 'headerMove'),
        same('snapshot.text', 'original', 'text'),
        { op: 'select', text: 'Alpha' },
        { op: 'table', command: 'moveRowUp', name: 'moved' },
        assert('', true, 'moved'),
        { op: 'tableCells', name: 'rows' },
        assert('0.0.0.text', 'Name', 'rows'),
        assert('0.1.0.text', 'Alpha', 'rows'),
        assert('0.2.0.text', 'Bravo', 'rows'),
        contains('0.1.2.html', '<code>code</code>', 'rows'),
        contains('0.1.2.html', '<mark>highlight</mark>', 'rows'),
        contains('0.2.2.html', '<strong>bold</strong>', 'rows'),
        contains('snapshot.text', '[ref][Shared]'),
        contains('snapshot.text', '[^Note]'),
        contains('snapshot.text', '![opaque](images/fixture.png)'),
        contains(
          'snapshot.text',
          '[Shared]: https://example.com/shared "Authored"',
        ),
        undo,
        same('snapshot.text', 'original', 'text'),
        { op: 'select', text: 'Alpha' },
        { op: 'table', command: 'moveRowDown' },
        { op: 'export', name: 'copied' },
        contains('html', '<strong>bold</strong>', 'copied'),
        contains('html', '<mark>highlight</mark>', 'copied'),
        assert('images.length', 1, 'copied'),
        { op: 'save', name: 'saved' },
        { op: 'reopen' },
        same('snapshot.text', 'saved', 'text'),
        assert('snapshot.dirty', false),
      ],
    },
    'table-column-movement': {
      source: richTable,
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'tableCells', name: 'originalCells' },
        { op: 'select', text: 'Value' },
        { op: 'table', command: 'moveColumnLeft', name: 'moved' },
        assert('', true, 'moved'),
        { op: 'tableCells', name: 'columns' },
        assert('0.0.0.text', 'Value', 'columns'),
        assert('0.0.1.text', 'Name', 'columns'),
        assert('0.1.0.text', '2', 'columns'),
        same('0.0.0.alignment', 'originalCells', '0.0.1.alignment', 'columns'),
        same('0.0.1.alignment', 'originalCells', '0.0.0.alignment', 'columns'),
        contains('snapshot.text', '[ref][Shared]'),
        undo,
        same('snapshot.text', 'original', 'text'),
        { op: 'select', text: 'Value' },
        { op: 'table', command: 'moveColumnRight' },
        { op: 'save', name: 'saved' },
        { op: 'reopen' },
        same('snapshot.text', 'saved', 'text'),
        { op: 'tableCells', name: 'reopened' },
        assert('0.0.2.text', 'Value', 'reopened'),
      ],
    },
    'table-sort-order': {
      source:
        '| Name | Number |\n| :--- | ---: |\n| tenth | 10 |\n| second | 2 |\n| tied | 2 |\n| blank | |\n',
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'select', text: 'tenth' },
        {
          op: 'table',
          command: 'sortRows',
          options: { column: 1, comparison: 'number', order: 'ascending' },
        },
        { op: 'tableCells', name: 'ascending' },
        ...['Name', 'second', 'tied', 'tenth', 'blank'].map((text, row) =>
          assert(`0.${row}.0.text`, text, 'ascending'),
        ),
        undo,
        same('snapshot.text', 'original', 'text'),
        { op: 'select', text: 'tenth' },
        {
          op: 'table',
          command: 'sortRows',
          options: { column: 1, comparison: 'number', order: 'descending' },
        },
        { op: 'tableCells', name: 'descending' },
        ...['Name', 'tenth', 'second', 'tied', 'blank'].map((text, row) =>
          assert(`0.${row}.0.text`, text, 'descending'),
        ),
        { op: 'save', name: 'saved' },
        { op: 'reopen' },
        same('snapshot.text', 'saved', 'text'),
        { op: 'select', text: 'tenth' },
        {
          op: 'table',
          command: 'sortRows',
          options: { column: 1, comparison: 'text', order: 'ascending' },
        },
        { op: 'tableCells', name: 'text' },
        ...['Name', 'tenth', 'second', 'tied', 'blank'].map((text, row) =>
          assert(`0.${row}.0.text`, text, 'text'),
        ),
      ],
    },
    'table-sort-rich-rows': {
      source: richTable,
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'select', text: 'Bravo' },
        {
          op: 'table',
          command: 'sortRows',
          options: { column: 0, comparison: 'text', order: 'ascending' },
        },
        { op: 'tableCells', name: 'sorted' },
        ...['Name', 'Alpha', 'Bravo', 'Equal'].map((text, row) =>
          assert(`0.${row}.0.text`, text, 'sorted'),
        ),
        contains('0.1.2.html', '<code>code</code>', 'sorted'),
        contains('0.2.2.html', '<strong>bold</strong>', 'sorted'),
        contains('snapshot.text', '[ref][Shared]'),
        contains('snapshot.text', '![opaque](images/fixture.png)'),
        { op: 'export', name: 'copied' },
        contains('html', 'https://example.com/shared', 'copied'),
        contains('markdown', '[^Note]: Retained footnote.', 'copied'),
        undo,
        same('snapshot.text', 'original', 'text'),
      ],
    },
    'table-spreadsheet-growth': {
      source: '| A | B |\n| :--- | ---: |\n| old | retained |\n',
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'select', text: 'retained' },
        { op: 'paste', input: { text: 'one\ttwo\r\nthree\tfour\r\n' } },
        { op: 'tableCells', name: 'pasted' },
        assert('0.length', 3, 'pasted'),
        assert('0.0.length', 3, 'pasted'),
        assert('0.1.0.text', 'old', 'pasted'),
        assert('0.1.1.text', 'one', 'pasted'),
        assert('0.1.2.text', 'two', 'pasted'),
        assert('0.2.1.text', 'three', 'pasted'),
        assert('0.2.2.text', 'four', 'pasted'),
        undo,
        same('snapshot.text', 'original', 'text'),
        { op: 'select', text: 'old' },
        {
          op: 'domPaste',
          types: {
            'text/plain': '"literal **bold**"\t"quoted ""value"""\nnext\tlast',
          },
          name: 'nativeEvent',
        },
        assert('prevented', true, 'nativeEvent'),
        { op: 'tableCells', name: 'literal' },
        assert('0.1.0.text', 'literal **bold**', 'literal'),
        excludes('0.1.0.html', '<strong>', 'literal'),
        assert('0.1.1.text', 'quoted "value"', 'literal'),
        assert('0.2.0.text', 'next', 'literal'),
        { op: 'export', name: 'copied' },
        contains('text', 'quoted "value"', 'copied'),
        { op: 'save', name: 'saved' },
        { op: 'reopen' },
        same('snapshot.text', 'saved', 'text'),
      ],
    },
    'table-spreadsheet-html': {
      source: '| A | B |\n| --- | --- |\n| old | retained |\n',
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'select', text: 'old' },
        {
          op: 'paste',
          input: {
            text: 'rich\tlink\nnext\tlast',
            html: '<table><tr><td><strong>rich</strong></td><td><a href="https://example.com/cell">link</a></td></tr><tr><td><code>next</code></td><td>last</td></tr></table>',
          },
        },
        { op: 'tableCells', name: 'rich' },
        contains('0.1.0.html', '<strong>rich</strong>', 'rich'),
        contains('0.1.1.html', 'href="https://example.com/cell"', 'rich'),
        contains('0.2.0.html', '<code>next</code>', 'rich'),
        undo,
        same('snapshot.text', 'original', 'text'),
        { op: 'select', text: 'old' },
        {
          op: 'paste',
          input: {
            text: 'broken\tinput',
            html: '<table><tr><td colspan="2">merged</td></tr></table>',
          },
          expectedError: 'preservation',
        },
        same('snapshot.text', 'original', 'text'),
        {
          op: 'paste',
          input: { text: '"unfinished\tcell' },
          expectedError: 'preservation',
        },
        same('snapshot.text', 'original', 'text'),
      ],
    },
    'table-mixed-unsupported-comment': {
      source: '',
      operations: [
        { op: 'snapshot', name: 'original' },
        {
          op: 'paste',
          input: {
            text: 'Before head cell After',
            html: '<p>Before</p><table><!--PRIVATE_TABLE_COMMENT--><tr><th>head</th></tr><tr><td>cell</td></tr></table><p>After</p>',
          },
        },
        contains('snapshot.text', '<table><!--PRIVATE_TABLE_COMMENT-->'),
        contains('snapshot.text', '<td>cell</td>'),
        contains('snapshot.text', 'Before'),
        contains('snapshot.text', 'After'),
        { op: 'export', name: 'copied' },
        contains('markdown', '<!--PRIVATE_TABLE_COMMENT-->', 'copied'),
        excludes('text', 'PRIVATE_TABLE_COMMENT', 'copied'),
        excludes('html', 'PRIVATE_TABLE_COMMENT', 'copied'),
        contains('text', 'head', 'copied'),
        contains('text', 'cell', 'copied'),
        { op: 'save', name: 'saved' },
        undo,
        same('snapshot.text', 'original', 'text'),
        { op: 'reopen' },
        same('snapshot.text', 'saved', 'text'),
        { op: 'export', name: 'reopened' },
        excludes('text', 'PRIVATE_TABLE_COMMENT', 'reopened'),
        excludes('html', 'PRIVATE_TABLE_COMMENT', 'reopened'),
        { op: 'load', source: '' },
        {
          op: 'domPaste',
          types: {
            'text/plain': 'Before head cell After',
            'text/html':
              '<p>Before</p><table><!--PRIVATE_TABLE_COMMENT--><tr><th>head</th></tr><tr><td>cell</td></tr></table><p>After</p>',
          },
          name: 'event',
        },
        assert('prevented', true, 'event'),
        contains('snapshot.text', '<!--PRIVATE_TABLE_COMMENT-->'),
        undo,
        assert('snapshot.text', ''),
      ],
    },
    'table-sort-invalid-number': {
      source: '| Key | Value |\n| --- | --- |\n| one | 1 |\n| bad | 2x |\n',
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'select', text: 'one' },
        {
          op: 'table',
          command: 'sortRows',
          options: { column: 1, comparison: 'number' },
          expectedError: 'finite decimal',
        },
        same('snapshot.text', 'original', 'text'),
      ],
    },
    'table-outside-and-txt': {
      source: 'Outside table',
      operations: [
        { op: 'table', command: 'moveRowDown', name: 'outside' },
        assert('', false, 'outside'),
        { op: 'load', format: 'txt', source: '| Literal | **source** |\r\n' },
        { op: 'snapshot', name: 'literal' },
        {
          op: 'table',
          command: 'sortRows',
          options: { comparison: 'number' },
          name: 'txt',
        },
        assert('', false, 'txt'),
        same('snapshot.text', 'literal', 'text'),
      ],
    },
  })
}

if (releaseAtLeast('0.0.7')) {
  const raw =
    '\uFEFF# Authored  \r\n\r\n[Label](<https://example.com>) and **bold**.\r\n\r\n<div data-private="untouched">unsupported\r\n\r\n~~~mermaid\r\nflowchart LR\r\nA -->\r\n'
  const original = '# Heading\n\n[Label](https://example.com)\n'
  const spelling = '# Heading\n\n[Label](<https://example.com>)\n'
  const incompleteDiagramDiagnostic =
    "Parse error on line 3:\nflowchart LRA -->\n-----------------^\nExpecting 'AMP', 'COLON', 'PIPE', 'TESTSTR', 'DOWN', 'DEFAULT', 'NUM', 'COMMA', 'NODE_STRING', 'BRKT', 'MINUS', 'MULT', 'UNICODE_TEXT', got 'EOF'"
  const distantSource =
    '# Start\n\n' +
    Array.from(
      { length: 250 },
      (_, index) =>
        `Line ${index}${index % 7 === 0 ? ' wrapped'.repeat(50) : ''}\n\n`,
    ).join('') +
    '## Distant\n'
  Object.assign(scenarios, {
    'source-complete-preservation': {
      source: raw,
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'editingMode', mode: 'source', name: 'switched' },
        assert('', true, 'switched'),
        same('snapshot', 'original', ''),
        assert('editingMode', 'source'),
        { op: 'select', text: 'unsupported' },
        { op: 'insertText', text: 'raw replacement' },
        assert('snapshot.text', raw.replace('unsupported', 'raw replacement')),
        { op: 'undo', name: 'undo' },
        assert('', true, 'undo'),
        assert('snapshot.text', raw),
        { op: 'redo' },
        assert('snapshot.text', raw.replace('unsupported', 'raw replacement')),
        { op: 'editingMode', mode: 'formatted' },
        assert('snapshot.text', raw.replace('unsupported', 'raw replacement')),
        { op: 'save', name: 'saved' },
        { op: 'reopen' },
        same('snapshot.text', 'saved', 'text'),
        assert('snapshot.dirty', false),
        {
          op: 'awaitDOM',
          selector: '.inkkit-mermaid-preview[data-state="error"]',
        },
        assert('errorCode', 'diagram-unavailable'),
        assert('error', incompleteDiagramDiagnostic),
        {
          op: 'acknowledgeError',
          code: 'diagram-unavailable',
          message: incompleteDiagramDiagnostic,
        },
      ],
    },
    'source-spelling-cross-mode-history': {
      source: original,
      operations: [
        { op: 'editingMode', mode: 'source' },
        { op: 'replaceSource', text: spelling },
        assert('snapshot.text', spelling),
        assert('snapshot.dirty', true),
        { op: 'snapshot', name: 'spelled' },
        { op: 'editingMode', mode: 'formatted' },
        same('snapshot', 'spelled', ''),
        { op: 'select', text: 'Label' },
        { op: 'insertText', text: 'Edited' },
        contains('snapshot.text', '[Edited]'),
        { op: 'editingMode', mode: 'source' },
        { op: 'undo' },
        assert('snapshot.text', spelling),
        { op: 'undo' },
        assert('snapshot.text', original),
        assert('snapshot.dirty', false),
        { op: 'redo' },
        assert('snapshot.text', spelling),
        { op: 'redo' },
        contains('snapshot.text', '[Edited]'),
      ],
    },
    'source-input-composition-and-generations': {
      source: 'Before',
      operations: [
        { op: 'editingMode', mode: 'source' },
        { op: 'select', text: 'Before' },
        { op: 'sourceInput', text: '# Typed\n\nUnclosed **source' },
        assert('snapshot.text', '# Typed\n\nUnclosed **source'),
        { op: 'activeKeyDown', key: 'z', metaKey: true, name: 'nativeUndo' },
        assert('prevented', true, 'nativeUndo'),
        assert('snapshot.text', 'Before'),
        {
          op: 'activeKeyDown',
          key: 'z',
          metaKey: true,
          shiftKey: true,
          name: 'nativeRedo',
        },
        assert('prevented', true, 'nativeRedo'),
        assert('snapshot.text', '# Typed\n\nUnclosed **source'),
        { op: 'composition', active: true },
        {
          op: 'sourceInput',
          value: '# Composed 日本語\n\nUnclosed **source',
          composing: true,
        },
        { op: 'snapshot', expectedError: 'composition' },
        { op: 'editingMode', mode: 'formatted', expectedError: 'composition' },
        { op: 'composition', active: false },
        assert('snapshot.text', '# Composed 日本語\n\nUnclosed **source'),
        { op: 'save', name: 'saved' },
        { op: 'load', source: 'Other', documentId: 'other' },
        {
          op: 'replaceSource',
          text: 'STALE',
          generation: 1,
          expectedError: 'stale-document',
        },
        {
          op: 'editingMode',
          mode: 'source',
          generation: 1,
          expectedError: 'stale-document',
        },
        { op: 'undo', generation: 1, expectedError: 'stale-document' },
        assert('snapshot.text', 'Other'),
      ],
    },
    'source-literal-paste-and-txt': {
      source: 'Before <!--PRIVATE_SOURCE--> after',
      operations: [
        { op: 'editingMode', mode: 'source' },
        { op: 'select', text: 'PRIVATE_SOURCE', from: 3, to: 9 },
        { op: 'export', all: false, name: 'privateSelection' },
        excludes('text', 'VATE_S', 'privateSelection'),
        excludes('html', 'VATE_S', 'privateSelection'),
        { op: 'select', text: 'Before' },
        {
          op: 'domPaste',
          types: {
            'text/plain': '| Literal | **source** |\r\n',
            'text/html': '<h1>Wrong HTML</h1>',
          },
          name: 'pasted',
        },
        assert('prevented', true, 'pasted'),
        contains('snapshot.text', '| Literal | **source** |\r\n'),
        excludes('snapshot.text', 'Wrong HTML'),
        { op: 'undo' },
        assert('snapshot.text', 'Before <!--PRIVATE_SOURCE--> after'),
        { op: 'load', format: 'txt', source: '# Literal **text**\r\n' },
        assert('editingMode', 'source'),
        { op: 'surface', name: 'txtSurface' },
        assert('sourceHidden', false, 'txtSurface'),
        excludes('sourceDisplay', 'none', 'txtSurface'),
        assert('formattedHidden', true, 'txtSurface'),
        assert('formattedDisplay', 'none', 'txtSurface'),
        { op: 'editingMode', mode: 'formatted', name: 'mode' },
        assert('', false, 'mode'),
        { op: 'replaceSource', text: '<table>Unclosed\r\n# Literal' },
        assert('snapshot.text', '<table>Unclosed\r\n# Literal'),
        { op: 'undo' },
        assert('snapshot.text', '# Literal **text**\r\n'),
        { op: 'reload', format: 'txt', source: 'Reloaded **literal**\r\n' },
        { op: 'surface', name: 'reloadedSurface' },
        assert('sourceHidden', false, 'reloadedSurface'),
        excludes('sourceDisplay', 'none', 'reloadedSurface'),
        assert('formattedHidden', true, 'reloadedSurface'),
        assert('formattedDisplay', 'none', 'reloadedSurface'),
      ],
    },
    'source-reload-and-crlf-replacement': {
      source: '# Heading\r\n\r\nAlpha\r\nBeta\r\n',
      operations: [
        { op: 'editingMode', mode: 'source' },
        { op: 'find', text: 'Alpha\r\nBeta', name: 'found' },
        assert('', 'Alpha\nBeta', 'found'),
        {
          op: 'replace',
          search: 'Alpha\r\nBeta',
          replacement: 'First\r\nSecond',
        },
        assert('snapshot.text', '# Heading\r\n\r\nFirst\r\nSecond\r\n'),
        { op: 'undo' },
        assert('snapshot.text', '# Heading\r\n\r\nAlpha\r\nBeta\r\n'),
        { op: 'select', text: 'Alpha', from: 2, to: 2 },
        { op: 'sourceState', name: 'caret' },
        { op: 'reload', source: '# Heading\r\n\r\nAlpha\r\nUpdated\r\n' },
        assert('editingMode', 'source'),
        { op: 'sourceState', name: 'reloaded' },
        same('start', 'caret', 'start', 'reloaded'),
        same('end', 'caret', 'end', 'reloaded'),
        { op: 'surface', name: 'reloadedSurface' },
        assert('sourceHidden', false, 'reloadedSurface'),
        assert('formattedHidden', true, 'reloadedSurface'),
        {
          op: 'load',
          format: 'txt',
          source: 'Before\r\nAlpha\r\nBeta\r\nAfter',
        },
        { op: 'find', text: 'Alpha\r\nBeta', name: 'txtFound' },
        assert('', 'Alpha\nBeta', 'txtFound'),
        { op: 'export', all: false, name: 'txtSelection' },
        assert('text', 'Alpha\r\nBeta', 'txtSelection'),
        assert('markdown', 'Alpha\r\nBeta', 'txtSelection'),
        {
          op: 'replace',
          search: 'Alpha\r\nBeta',
          replacement: 'Literal\r\n**raw**',
        },
        assert('snapshot.text', 'Before\r\nLiteral\r\n**raw**\r\nAfter'),
        { op: 'undo' },
        assert('snapshot.text', 'Before\r\nAlpha\r\nBeta\r\nAfter'),
        { op: 'selectSourceRange', from: 0 },
        { op: 'find', text: '\r' },
        { op: 'replace', search: '\r', replacement: 'R' },
        assert('snapshot.text', 'BeforeR\nAlpha\r\nBeta\r\nAfter'),
        { op: 'undo' },
        assert('snapshot.text', 'Before\r\nAlpha\r\nBeta\r\nAfter'),
        { op: 'selectSourceRange', from: 0 },
        { op: 'find', text: '\n' },
        { op: 'replace', search: '\n', replacement: 'N' },
        assert('snapshot.text', 'Before\rNAlpha\r\nBeta\r\nAfter'),
        { op: 'undo' },
        assert('snapshot.text', 'Before\r\nAlpha\r\nBeta\r\nAfter'),
        {
          op: 'load',
          source: 'Before\r\nAlpha\r\nBeta\r\nAfter',
          format: 'md',
        },
        { op: 'editingMode', mode: 'source' },
        { op: 'selectSourceRange', from: 0 },
        { op: 'find', text: '\r' },
        { op: 'replace', search: '\r', replacement: 'R' },
        assert('snapshot.text', 'BeforeR\nAlpha\r\nBeta\r\nAfter'),
        { op: 'undo' },
        { op: 'selectSourceRange', from: 0 },
        { op: 'find', text: '\n' },
        { op: 'replace', search: '\n', replacement: 'N' },
        assert('snapshot.text', 'Before\rNAlpha\r\nBeta\r\nAfter'),
      ],
    },
    'replacement-literal-unicode-and-newlines': {
      source: 'Café cafe\u0301 CAFÉ\nK K k\nDollar $&\nnext\n',
      operations: [
        { op: 'editingMode', mode: 'source' },
        { op: 'snapshot', name: 'original' },
        { op: 'replaceAll', search: 'café', replacement: '$&', name: 'accent' },
        assert('', 2, 'accent'),
        assert('snapshot.text', '$& cafe\u0301 $&\nK K k\nDollar $&\nnext\n'),
        {
          op: 'replaceAll',
          search: 'k',
          replacement: 'literal',
          name: 'folded',
        },
        assert('', 3, 'folded'),
        {
          op: 'replace',
          search: '$&\nnext',
          replacement: '$1\n*raw*',
          name: 'multiline',
        },
        assert('', true, 'multiline'),
        contains('snapshot.text', 'Dollar $1\n*raw*\n'),
        { op: 'undo' },
        contains('snapshot.text', 'Dollar $&\nnext\n'),
        { op: 'undo' },
        contains('snapshot.text', 'K K k'),
        { op: 'undo' },
        same('snapshot.text', 'original', 'text'),
        { op: 'replaceAll', search: '', replacement: 'NO', name: 'empty' },
        assert('', 0, 'empty'),
        {
          op: 'replaceAll',
          search: 'Café',
          replacement: 'Café',
          name: 'unchanged',
        },
        assert('', 1, 'unchanged'),
        contains('snapshot.text', 'cafe\u0301'),
        {
          op: 'replaceAll',
          search: 'Dollar',
          replacement: 'Dollar',
          name: 'noChange',
        },
        assert('', 0, 'noChange'),
        { op: 'load', format: 'txt', source: '**ONE**\nTwo\n**one**' },
        {
          op: 'replaceAll',
          search: '**one**',
          replacement: '# $&',
          name: 'txt',
        },
        assert('', 2, 'txt'),
        assert('snapshot.text', '# $&\nTwo\n# $&'),
        { op: 'undo' },
        assert('snapshot.text', '**ONE**\nTwo\n**one**'),
      ],
    },
    'replacement-structured-boundaries-and-privacy': {
      source:
        '**bold** plain.\n\nneedle ![opaque](images/native.png) needle\n\n<!--private needle-->\n\n| H |\n| --- |\n| needle |\n',
      operations: [
        { op: 'snapshot', name: 'original' },
        {
          op: 'replace',
          search: 'bold plain',
          replacement: 'Joined',
          name: 'marks',
        },
        assert('', true, 'marks'),
        contains('snapshot.text', 'Joined'),
        { op: 'undo' },
        same('snapshot.text', 'original', 'text'),
        {
          op: 'replaceAll',
          search: 'needle  needle',
          replacement: 'LOST',
          name: 'atomBoundary',
        },
        assert('', 0, 'atomBoundary'),
        {
          op: 'replaceAll',
          search: 'needle',
          replacement: 'two\nlines',
          expectedError: 'preservation',
        },
        same('snapshot.text', 'original', 'text'),
        {
          op: 'replaceAll',
          search: 'private needle',
          replacement: 'PRIVATE_REPLACED',
          name: 'comment',
        },
        assert('', 1, 'comment'),
        contains('snapshot.text', '<!--PRIVATE_REPLACED-->'),
        { op: 'export', name: 'ordinary' },
        excludes('text', 'PRIVATE_REPLACED', 'ordinary'),
        excludes('html', 'PRIVATE_REPLACED', 'ordinary'),
        contains('markdown', '<!--PRIVATE_REPLACED-->', 'ordinary'),
        { op: 'undo' },
        same('snapshot.text', 'original', 'text'),
        { op: 'select', text: 'bold' },
        { op: 'replace', search: 'bold', replacement: 'first\nsecond' },
        { op: 'dom', selector: 'p br', name: 'breaks' },
        assert('count', 1, 'breaks'),
        { op: 'save', name: 'saved' },
        { op: 'reopen' },
        same('snapshot.text', 'saved', 'text'),
      ],
    },
    'replacement-selection-composition-and-switching': {
      source: 'one ONE one',
      operations: [
        { op: 'select', text: 'ONE' },
        { op: 'replace', search: 'one', replacement: '$&', name: 'selected' },
        assert('', true, 'selected'),
        assert('selection', '$&'),
        contains('snapshot.text', 'one $& one'),
        { op: 'undo' },
        assert('snapshot.text', 'one ONE one'),
        {
          op: 'replaceAll',
          search: 'one',
          replacement: 'changed',
          name: 'all',
        },
        assert('', 3, 'all'),
        assert('snapshot.text', 'changed changed changed'),
        { op: 'undo' },
        assert('snapshot.text', 'one ONE one'),
        { op: 'composition', active: true },
        {
          op: 'replace',
          search: 'one',
          replacement: 'NO',
          expectedError: 'composition',
        },
        {
          op: 'replaceAll',
          search: 'one',
          replacement: 'NO',
          expectedError: 'composition',
        },
        { op: 'composition', active: false },
        assert('snapshot.text', 'one ONE one'),
        { op: 'load', source: 'other document', documentId: 'other' },
        {
          op: 'find',
          text: 'other',
          generation: 1,
          expectedError: 'stale-document',
        },
        {
          op: 'replaceAll',
          search: 'other',
          replacement: 'NO',
          generation: 1,
          expectedError: 'stale-document',
        },
        assert('snapshot.text', 'other document'),
        { op: 'undo', name: 'clearedHistory' },
        assert('', false, 'clearedHistory'),
      ],
    },
    'outline-current-navigation-and-stale-entries': {
      source:
        '# Root\n\n## Duplicate\n\n> [!NOTE]- Folded\n> ### Nested\n> body\n\n## Duplicate\n\n```md\n# Code exclusion\n```\n',
      operations: [
        { op: 'headings', name: 'initial' },
        assert('length', 4, 'initial'),
        assert('0.text', 'Root', 'initial'),
        assert('1.text', 'Duplicate', 'initial'),
        assert('2.text', 'Nested', 'initial'),
        assert('2.level', 3, 'initial'),
        assert('3.text', 'Duplicate', 'initial'),
        { op: 'snapshot', name: 'beforeNavigation' },
        {
          op: 'navigateHeading',
          sourceName: 'initial',
          index: 2,
          name: 'navigated',
        },
        assert('', true, 'navigated'),
        same('snapshot', 'beforeNavigation', ''),
        {
          op: 'dom',
          selector: '[data-inkkit-callout="NOTE"] [data-inkkit-callout-toggle]',
          name: 'revealed',
        },
        assert('nodes.0.attributes.aria-expanded', 'true', 'revealed'),
        { op: 'select', text: 'Root' },
        { op: 'insertText', text: 'Edited' },
        {
          op: 'navigateHeading',
          sourceName: 'initial',
          expectedError: 'stale-document',
        },
        { op: 'headings', name: 'edited' },
        assert('0.text', 'Edited', 'edited'),
        { op: 'editingMode', mode: 'source' },
        {
          op: 'navigateHeading',
          sourceName: 'edited',
          expectedError: 'stale-document',
        },
        { op: 'headings', name: 'raw' },
        { op: 'navigateHeading', sourceName: 'raw', index: 1 },
        { op: 'sourceState', name: 'caret' },
        assert('start', 10, 'caret'),
        assert('end', 10, 'caret'),
        assert('focused', true, 'caret'),
        { op: 'reload', source: '# Reloaded\n' },
        {
          op: 'navigateHeading',
          sourceName: 'raw',
          expectedError: 'stale-document',
        },
        { op: 'headings', name: 'reloaded' },
        assert('0.text', 'Reloaded', 'reloaded'),
        { op: 'load', source: '# Other\n', documentId: 'other' },
        {
          op: 'navigateHeading',
          sourceName: 'reloaded',
          expectedError: 'stale-document',
        },
        { op: 'load', source: '# Literal\n', format: 'txt' },
        { op: 'headings', name: 'txt' },
        assert('length', 0, 'txt'),
      ],
    },
    'outline-source-readable-headings-and-literal-exclusions': {
      source:
        '\uFEFFTitle\r\n=====\r\n\r\n# **Strong** <!--PRIVATE_HEADING--> ![Alt](images/native.png) [ref][x] [^n]\r\n\r\n<div>\r\n# Raw ignored\r\n</div>\r\n\r\n~~~md\r\n# Code ignored\r\n~~~\r\n\r\n[x]: https://example.com/reference\r\n[^n]: Note body\r\n',
      operations: [
        { op: 'headings', name: 'formatted' },
        assert('length', 2, 'formatted'),
        assert('0.text', 'Title', 'formatted'),
        assert('0.level', 1, 'formatted'),
        contains('1.text', 'Strong', 'formatted'),
        contains('1.text', 'Alt', 'formatted'),
        contains('1.text', 'ref', 'formatted'),
        contains('1.text', '[n]', 'formatted'),
        excludes('1.text', 'PRIVATE_HEADING', 'formatted'),
        { op: 'editingMode', mode: 'source' },
        { op: 'headings', name: 'source' },
        assert('length', 2, 'source'),
        same('1.text', 'formatted', '1.text', 'source'),
        {
          op: 'replaceSource',
          text: '# New\n\nUnclosed fence\n```md\n# Ignored incomplete\n',
        },
        { op: 'headings', name: 'incomplete' },
        assert('length', 1, 'incomplete'),
        assert('0.text', 'New', 'incomplete'),
        {
          op: 'navigateHeading',
          sourceName: 'source',
          expectedError: 'stale-document',
        },
        { op: 'navigateHeading', sourceName: 'incomplete' },
        { op: 'sourceState', name: 'caret' },
        assert('start', 0, 'caret'),
        assert('end', 0, 'caret'),
        { op: 'composition', active: true },
        { op: 'headings', expectedError: 'composition' },
        {
          op: 'navigateHeading',
          sourceName: 'incomplete',
          expectedError: 'composition',
        },
        { op: 'composition', active: false },
      ],
    },
    'outline-source-distant-heading-viewport': {
      source: distantSource,
      operations: [
        { op: 'editingMode', mode: 'source' },
        { op: 'selectSourceRange', from: 0, scrollTop: 0 },
        { op: 'sourceState', name: 'top' },
        assert('scrollTop', 0, 'top'),
        { op: 'snapshot', name: 'original' },
        { op: 'headings', name: 'outline' },
        assert('length', 2, 'outline'),
        assert('1.text', 'Distant', 'outline'),
        { op: 'navigateHeading', sourceName: 'outline', index: 1 },
        { op: 'sourceState', name: 'distant' },
        { op: 'sourceViewport', name: 'viewport' },
        { op: 'assert', path: 'scrollTop', truthy: true, name: 'distant' },
        assert('inView', true, 'viewport'),
        { op: 'navigateHeading', sourceName: 'outline', index: 0 },
        { op: 'sourceState', name: 'returned' },
        assert('start', 0, 'returned'),
        assert('scrollTop', 0, 'returned'),
        { op: 'sourceViewport', name: 'returnedViewport' },
        assert('inView', true, 'returnedViewport'),
        same('snapshot', 'original', ''),
        { op: 'find', text: 'Distant', name: 'found' },
        assert('', 'Distant', 'found'),
        { op: 'sourceViewport', name: 'foundViewport' },
        assert('inView', true, 'foundViewport'),
        { op: 'sourceScroll', top: 0 },
        { op: 'replace', search: 'Distant', replacement: 'Replaced heading' },
        assert('selection', 'Replaced heading'),
        assert(
          'snapshot.text',
          distantSource.replace('Distant', 'Replaced heading'),
        ),
        { op: 'sourceViewport', name: 'replacedViewport' },
        assert('inView', true, 'replacedViewport'),
        { op: 'sourceScroll', top: 0 },
        { op: 'undo' },
        same('snapshot.text', 'original', 'text'),
        { op: 'sourceViewport', name: 'undoViewport' },
        assert('inView', true, 'undoViewport'),
        { op: 'sourceState', name: 'beforeReload' },
        { op: 'assert', name: 'beforeReload', path: 'scrollTop', truthy: true },
        { op: 'reload', source: distantSource },
        assert('editingMode', 'source'),
        same('snapshot.text', 'original', 'text'),
        { op: 'sourceState', name: 'afterReload' },
        same('start', 'beforeReload', 'start', 'afterReload'),
        same('end', 'beforeReload', 'end', 'afterReload'),
        same('scrollTop', 'beforeReload', 'scrollTop', 'afterReload'),
        same('scrollLeft', 'beforeReload', 'scrollLeft', 'afterReload'),
        { op: 'sourceViewport', name: 'reloadViewport' },
        assert('inView', true, 'reloadViewport'),
      ],
    },
  })
}

if (releaseAtLeast('0.0.8')) {
  Object.assign(scenarios, {
    'host-task-marker-layout': {
      source: '- [ ] First task\n- [x] Finished task\n',
      operations: [
        { op: 'dom', selector: 'li[data-item-type="task"]', name: 'tasks' },
        assert('nodes.0.markerInGutter', true, 'tasks'),
        assert('nodes.1.markerInGutter', true, 'tasks'),
        assert('nodes.1.tickInsideMarker', true, 'tasks'),
        assert('snapshot.dirty', false),
      ],
    },
    'host-read-only-history-and-input': {
      source: '# Host controls\n\nOriginal text.\n',
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'editingMode', mode: 'source' },
        { op: 'selectSourceRange', from: 0 },
        {
          op: 'textInput',
          preferences: {
            spellcheck: false,
            autocorrect: false,
            autocapitalize: 'off',
          },
        },
        { op: 'inputAttributes', name: 'attributes' },
        assert('spellcheck', 'false', 'attributes'),
        assert('autocorrect', 'off', 'attributes'),
        assert('autocapitalize', 'off', 'attributes'),
        assert('focused', true, 'attributes'),
        { op: 'replaceSource', text: '# Host controls\n\nChanged text.\n' },
        { op: 'editable', editable: false },
        { op: 'commandState', name: 'readonly' },
        assert('editable', false, 'readonly'),
        assert('commands.undo', false, 'readonly'),
        { op: 'replaceSource', text: 'NO', expectedError: 'read-only' },
        { op: 'insertText', text: 'NO', expectedError: 'read-only' },
        { op: 'undo', expectedError: 'read-only' },
        { op: 'paste', input: { text: 'NO' }, expectedError: 'read-only' },
        { op: 'find', text: 'Changed' },
        assert('selection', 'Changed'),
        { op: 'editingMode', mode: 'formatted' },
        { op: 'format', command: 'bold', expectedError: 'read-only' },
        { op: 'table', command: 'insert', expectedError: 'read-only' },
        { op: 'editable', editable: true },
        { op: 'undo' },
        {
          op: 'assert',
          path: 'snapshot.text',
          equalsFrom: { name: 'original', path: 'text' },
        },
        { op: 'commandState', name: 'restored' },
        assert('commands.redo', true, 'restored'),
        { op: 'load', documentId: 'replacement', source: '# Replacement\n' },
        { op: 'commandState', generation: 1, expectedError: 'stale-document' },
        { op: 'commandState', name: 'replacement' },
        assert('documentId', 'replacement', 'replacement'),
        assert('commands.undo', false, 'replacement'),
      ],
    },
    'host-composition-transitions-and-availability': {
      source: 'Composing text',
      operations: [
        { op: 'editingMode', mode: 'source' },
        { op: 'selectSourceRange', from: 0 },
        { op: 'composition', active: true },
        { op: 'commandState', name: 'composing' },
        assert('composing', true, 'composing'),
        assert('commands.insertText', false, 'composing'),
        { op: 'editable', editable: false, expectedError: 'composition' },
        {
          op: 'textInput',
          preferences: { spellcheck: false },
          expectedError: 'composition',
        },
        { op: 'composition', active: false },
        assert('snapshot.text', 'Composing text'),
        assert('editable', true),
        { op: 'editable', editable: false },
        { op: 'inputAttributes', name: 'readonly' },
        assert('readOnly', true, 'readonly'),
        assert('focused', true, 'readonly'),
      ],
    },
    'host-delayed-import-editability-epoch': {
      source: 'Before import',
      operations: [
        { op: 'select', text: 'Before import', from: 13 },
        { op: 'startImagePaste' },
        { op: 'commandState', name: 'pending' },
        assert('pending', true, 'pending'),
        { op: 'editable', editable: false },
        { op: 'editable', editable: true },
        { op: 'finishImagePaste', expectedError: 'stale-document' },
        assert('snapshot.text', 'Before import'),
        { op: 'commandState', name: 'after' },
        assert('pending', false, 'after'),
        assert('commands.undo', false, 'after'),
      ],
    },
    'intentional-assertion-failure': {
      source: 'Controlled failure',
      operations: [
        assert('snapshot.text', 'Intentionally incorrect expected text'),
      ],
    },
  })
}
if (releaseAtLeast('0.0.9')) {
  scenarios['native-search-scoped-unicode'] = {
    source:
      'Unicode A😀B é 中文.\n\n**Formatted match**.\n\n> [!NOTE]- Folded\n> Hidden body match.\n\n<!-- hidden author comment -->\n\n![Opaque image](images/native.png)\n',
    operations: [
      { op: 'textSnapshot', name: 'before' },
      contains('text', 'A😀B é 中文', 'before'),
      {
        op: 'assert',
        path: 'text',
        excludes: 'hidden author comment',
        name: 'before',
      },
      {
        op: 'selectTextRange',
        sourceName: 'before',
        text: '😀',
        name: 'emoji',
      },
      assert('text', '😀', 'emoji'),
      {
        op: 'selectTextRange',
        sourceName: 'before',
        text: '😀',
        length: 1,
        expectedError: 'invalid-range',
      },
      {
        op: 'replaceTextRange',
        sourceName: 'before',
        text: '😀',
        replacement: '界',
      },
      contains('snapshot.text', 'A界B é'),
      {
        op: 'selectTextRange',
        sourceName: 'before',
        text: '😀',
        expectedError: 'stale-document',
      },
      { op: 'undo' },
      { op: 'textSnapshot', name: 'restored' },
      {
        op: 'selectTextRange',
        sourceName: 'restored',
        text: 'é',
        name: 'accent',
      },
      assert('text', 'é', 'accent'),
      {
        op: 'textRangeRects',
        sourceName: 'restored',
        text: 'Hidden body match',
        name: 'folded',
      },
      assert('', [], 'folded'),
      {
        op: 'replaceTextRange',
        sourceName: 'restored',
        text: 'Opaque image',
        replacement: 'NO',
        expectedError: 'invalid-range',
      },
      { op: 'composition', active: true },
      { op: 'textSnapshot', expectedError: 'composition' },
      {
        op: 'selectTextRange',
        sourceName: 'restored',
        text: 'é',
        expectedError: 'composition',
      },
      { op: 'composition', active: false },
      { op: 'editingMode', mode: 'source' },
      { op: 'textSnapshot', name: 'source' },
      {
        op: 'selectTextRange',
        sourceName: 'source',
        text: '😀',
        name: 'sourceEmoji',
      },
      assert('text', '😀', 'sourceEmoji'),
      {
        op: 'replaceTextRange',
        sourceName: 'source',
        text: '😀',
        replacement: '界',
      },
      { op: 'undo' },
      { op: 'editingMode', mode: 'formatted' },
      {
        op: 'textRangeRects',
        sourceName: 'restored',
        text: 'é',
        expectedError: 'stale-document',
      },
      { op: 'mountSecond' },
      {
        op: 'selectTextRange',
        instance: 'second',
        sourceName: 'source',
        text: '😀',
        expectedError: 'stale-document',
      },
      { op: 'load', format: 'txt', source: 'A😀B é 中文.\r\nSecond line\r\n' },
      { op: 'textSnapshot', name: 'txt' },
      assert('text', 'A😀B é 中文.\nSecond line\n', 'txt'),
      {
        op: 'selectTextRange',
        sourceName: 'txt',
        text: '😀',
        name: 'txtEmoji',
      },
      assert('text', '😀', 'txtEmoji'),
      {
        op: 'replaceTextRange',
        sourceName: 'txt',
        text: '😀',
        replacement: '界',
      },
      { op: 'undo' },
      assert('snapshot.text', 'A😀B é 中文.\r\nSecond line\r\n'),
    ],
  }
  const wrappedText =
    'Wrapped match spans several visual lines so its first and final character must both fit below the host search header and above the bottom inset.'
  const layoutSource =
    '# Layout\n\n' +
    Array.from(
      { length: 36 },
      (_, index) =>
        `Paragraph ${index + 1}: scrollable fixture.\n${index === 28 ? `\n${wrappedText}\n` : ''}`,
    ).join('\n') +
    '\nFinal navigation target.\n'
  for (const mode of ['formatted', 'source']) {
    scenarios[`native-layout-${mode}`] = {
      source: layoutSource,
      operations: [
        ...(mode === 'source' ? [{ op: 'editingMode', mode }] : []),
        { op: 'layout', height: 340, width: 500 },
        { op: 'hostFocus' },
        { op: 'textSnapshot', name: 'before' },
        {
          op: 'setViewport',
          insets: { top: 36, bottom: 28, left: 12, right: 10 },
        },
        {
          op: 'selectTextRange',
          sourceName: 'before',
          text: 'Final navigation target.',
        },
        { op: 'viewportState', name: 'quiet' },
        assert('hostFocused', true, 'quiet'),
        assert('viewport.scrollTop', 0, 'quiet'),
        {
          op: 'selectTextRange',
          sourceName: 'before',
          text: 'Final navigation target.',
          options: { focus: true, reveal: true },
        },
        {
          op: 'rangeGeometry',
          sourceName: 'before',
          text: 'Final navigation target.',
          name: 'revealed',
        },
        assert('hasRects', true, 'revealed'),
        assert('insideViewport', true, 'revealed'),
        assert('visibleContains', true, 'revealed'),
        { op: 'layout', height: 260, width: 360 },
        {
          op: 'revealTextRange',
          sourceName: 'before',
          text: 'Final navigation target.',
        },
        {
          op: 'rangeGeometry',
          sourceName: 'before',
          text: 'Final navigation target.',
          name: 'resized',
        },
        assert('insideViewport', true, 'resized'),
        { op: 'layout', top: 0 },
        {
          op: 'selectTextRange',
          sourceName: 'before',
          text: wrappedText,
          options: { reveal: true },
        },
        {
          op: 'rangeGeometry',
          sourceName: 'before',
          text: wrappedText,
          name: 'wrapped',
        },
        assert('wrapped', true, 'wrapped'),
        assert('fitsViewport', true, 'wrapped'),
        assert('insideViewport', true, 'wrapped'),
        {
          op: 'selectTextRange',
          sourceName: 'before',
          text: 'Final navigation target.',
          options: { reveal: true },
        },
        { op: 'hostFocus' },
        { op: 'viewportState', name: 'beforeReload' },
        { op: 'reload', sameGeneration: true, source: layoutSource },
        { op: 'viewportState', name: 'afterReload' },
        assert('hostFocused', true, 'afterReload'),
        {
          op: 'assert',
          path: 'viewport.scrollTop',
          name: 'afterReload',
          equalsFrom: { name: 'beforeReload', path: 'viewport.scrollTop' },
        },
        { op: 'textSnapshot', name: 'reloaded' },
        {
          op: 'selectTextRange',
          sourceName: 'before',
          text: 'Final navigation target.',
          expectedError: 'stale-document',
        },
        {
          op: 'selectTextRange',
          sourceName: 'reloaded',
          text: 'Final navigation target.',
          name: 'restored',
        },
        assert('text', 'Final navigation target.', 'restored'),
        { op: 'load', source: 'Replacement document.' },
        { op: 'viewportState', name: 'replacement' },
        assert('hostFocused', true, 'replacement'),
      ],
    }
  }
}
if (releaseAtLeast('0.0.10')) {
  Object.assign(scenarios, {
    'linked-files-source-sizing': {
      files: true,
      fixture: 'linked-files',
      operations: [
        { op: 'fileState', ready: true, name: 'files' },
        contains('kinds', 'audio', 'files'),
        contains('kinds', 'video', 'files'),
        contains('kinds', 'pdf', 'files'),
        assert('pdfSandbox', '', 'files'),
        assert('pdfFallback', true, 'files'),
        { op: 'domKeyDown', selector: '.inkkit-wiki-link', key: 'Enter' },
        { op: 'fileState', name: 'opened' },
        assert('wikiOpens', 1, 'opened'),
        { op: 'fileResize', selector: '.image img', occurrence: 1, width: 180 },
        contains('snapshot.text', '![[Photo|180]]'),
        { op: 'keyDown', key: 'z', code: 'KeyZ', metaKey: true },
        contains('snapshot.text', '![[Photo|140]]'),
        { op: 'editable', editable: false },
        { op: 'fileResize', selector: '.image img', occurrence: 1, width: 200 },
        contains('snapshot.text', '![[Photo|140]]'),
        { op: 'editingMode', mode: 'source' },
        contains('snapshot.text', '[[Notes/旅行#Résumé|Travel plan]]'),
        { op: 'save' },
        { op: 'reopen' },
        contains('snapshot.text', '![[Photo|140]]'),
      ],
    },
    'media-lifecycle': {
      files: true,
      source:
        '![[Voice#t=0,0.5]]\n\n![[Movie#t=0,0.5]]\n\n![[Document#page=1]]\n',
      operations: [
        { op: 'fileState', ready: true, name: 'ready' },
        assert('media.0.controls', true, 'ready'),
        assert('media.1.controls', true, 'ready'),
        assert('media.0.autoplay', false, 'ready'),
        assert('media.1.autoplay', false, 'ready'),
        assert('media.0.source', true, 'ready'),
        assert('media.1.source', true, 'ready'),
        { op: 'editable', editable: false },
        { op: 'fileState', name: 'readonly' },
        assert('media.0.source', true, 'readonly'),
        { op: 'editingMode', mode: 'source' },
        { op: 'fileState', name: 'hidden' },
        assert('media.length', 0, 'hidden'),
        { op: 'editingMode', mode: 'formatted' },
        { op: 'fileState', ready: true, name: 'restored' },
        assert('media.0.source', true, 'restored'),
        assert('pdfFallback', true, 'restored'),
        { op: 'fileMode', mode: 'hold' },
        { op: 'load', source: '![[Photo]]\n' },
        { op: 'fileState', name: 'held' },
        assert('pending', 1, 'held'),
        { op: 'load', source: '> [!NOTE]- Folded\n> ![[Photo]]\n' },
        { op: 'fileState', name: 'folded' },
        assert('pending', 0, 'folded'),
        { op: 'fileRelease' },
        { op: 'fileState', name: 'late' },
        assert('pending', 0, 'late'),
      ],
    },
    'portable-files-native-print': {
      files: true,
      fixture: 'linked-files',
      mode: 'printable',
      printIncludes: [
        'Travel plan',
        '[Audio: Voice#t=0,0.5]',
        '[Video: Movie#t=0,0.5]',
        '[PDF: Document#page=1]',
        '[File: Archive]',
      ],
      printExcludes: ['blob:', 'Retry', 'Open to view'],
      printMinImages: 1,
      operations: [
        { op: 'export', name: 'clipboard' },
        contains('text', '[Audio: Voice#t=0,0.5]', 'clipboard'),
        contains('text', '[PDF: Document#page=1]', 'clipboard'),
        { op: 'assert', path: 'html', excludes: 'blob:', name: 'clipboard' },
        assert('images.length', 3, 'clipboard'),
        { op: 'textSnapshot', name: 'readable' },
        {
          op: 'selectTextRange',
          sourceName: 'readable',
          from: 0,
          to: 99999,
          expectedError: 'invalid-range',
        },
        {
          op: 'domSelectAll',
        },
        { op: 'domCopy', name: 'domCopy' },
        contains('text', '[Audio:', 'domCopy'),
        { op: 'printable', name: 'printable' },
        assert('assets.length', 3, 'printable'),
        assert('warnings.length', 6, 'printable'),
      ],
    },
    'portable-files-stale-exports': {
      files: true,
      source: '![[Photo]]\n',
      operations: [
        { op: 'fileMode', mode: 'hold' },
        { op: 'startFileOutput', kind: 'copy' },
        { op: 'load', source: 'Replacement 😀 document.' },
        { op: 'finishFileOutput', expectedError: 'stale-document' },
        { op: 'fileRelease' },
        { op: 'load', source: '![[Photo]]\n' },
        { op: 'fileMode', mode: 'hold' },
        { op: 'startFileOutput', kind: 'print' },
        { op: 'editingMode', mode: 'source' },
        { op: 'finishFileOutput', expectedError: 'stale-document' },
        { op: 'fileRelease' },
        { op: 'editingMode', mode: 'formatted' },
        { op: 'export', name: 'recovered' },
        assert('images.length', 1, 'recovered'),
      ],
    },
  })
}
if (releaseAtLeast('0.0.11')) {
  scenarios['integration-minimal-print'] = {
    mode: 'printable',
    configuration: 'minimal',
    source:
      '# Frozen minimal\n\n```mermaid\nflowchart LR\nStart --> Finish\n```\n\n> [!NOTE]- Folded\n> Complete folded body.\n\n<!-- private comment -->\n\nFinal sentinel.\n',
    printIncludes: [
      'Frozen minimal',
      'Complete folded body.',
      'Final sentinel.',
    ],
    printExcludes: ['private comment', 'Replacement live document'],
    printMinImages: 1,
    operations: [
      { op: 'dom', selector: '.inkkit-mermaid-preview', name: 'preview' },
      assert('count', 0, 'preview'),
      { op: 'printable', name: 'printable' },
      assert('assets.length', 1, 'printable'),
      { op: 'export', name: 'copy' },
      assert('diagrams.length', 1, 'copy'),
      { op: 'load', source: 'Replacement live document' },
    ],
  }
  for (const configuration of ['minimal', 'rich']) {
    scenarios[`integration-${configuration}-assembled`] = {
      configuration,
      files: true,
      fixture: 'untidy',
      operations: [
        { op: 'snapshot', name: 'original' },
        { op: 'textSnapshot', name: 'scope' },
        { op: 'setViewport', insets: { top: 16, bottom: 8 } },
        { op: 'editingMode', mode: 'source' },
        {
          op: 'selectTextRange',
          sourceName: 'scope',
          text: 'Before',
          expectedError: 'stale-document',
        },
        { op: 'selectSourceRange', from: 0 },
        { op: 'insertText', text: 'Intro\r\n' },
        { op: 'editingMode', mode: 'formatted' },
        { op: 'editable', editable: false },
        { op: 'undo', expectedError: 'read-only' },
        { op: 'find', text: 'Before' },
        assert('selection', 'Before'),
        { op: 'editable', editable: true },
        { op: 'undo' },
        {
          op: 'assert',
          path: 'snapshot.text',
          equalsFrom: { name: 'original', path: 'text' },
        },
        { op: 'editingMode', mode: 'source' },
        { op: 'composition', active: true },
        { op: 'snapshot', expectedError: 'composition' },
        { op: 'composition', active: false },
        {
          op: 'reload',
          source: '__Reload__\r\n\r\n![[Photo|80]]\r\n',
          sameGeneration: true,
        },
        assert('editingMode', 'source'),
        { op: 'editingMode', mode: 'formatted' },
        { op: 'snapshot', name: 'reload' },
        assert('dirty', false, 'reload'),
        { op: 'export', name: 'clip' },
        assert('markdown', '__Reload__\r\n\r\n![[Photo|80]]\r\n', 'clip'),
        {
          op: 'load',
          format: 'txt',
          source: '\uFEFF# TXT\r\n**raw** ![[Photo]]\r\n',
        },
        { op: 'snapshot', name: 'txt' },
        { op: 'export', name: 'txtCopy' },
        {
          op: 'assert',
          name: 'txtCopy',
          path: 'text',
          equalsFrom: { name: 'txt', path: 'text' },
        },
        { op: 'printable', name: 'txtPrint' },
        contains('html', '# TXT', 'txtPrint'),
        { op: 'load', format: 'md', source: '__Original__\n' },
        { op: 'insertText', text: 'one\r\ntwo\rthree\n' },
        { op: 'snapshot', name: 'multiline' },
        { op: 'export', name: 'multilineCopy' },
        contains('text', 'one\ntwo\nthree\n', 'multilineCopy'),
        { op: 'undo' },
        assert('snapshot.text', '__Original__\n'),
        { op: 'load', source: '| Head |\n| --- |\n| Original |\n' },
        { op: 'snapshot', name: 'tableBefore' },
        {
          op: 'insertText',
          text: 'one\r\ntwo\n',
          expectedError: 'preservation',
        },
        {
          op: 'assert',
          path: 'snapshot.text',
          equalsFrom: { name: 'tableBefore', path: 'text' },
        },
        assert('snapshot.revision', 0),
        { op: 'commandState', name: 'tableState' },
        assert('commands.undo', false, 'tableState'),
      ],
    }
  }
  scenarios['integration-delayed-reload-and-output'] = {
    configuration: 'rich',
    files: true,
    source: 'Before import',
    operations: [
      { op: 'startImagePaste' },
      { op: 'reload', source: 'Replacement', sameGeneration: true },
      { op: 'finishImagePaste', expectedError: 'stale-document' },
      assert('snapshot.text', 'Replacement'),
      { op: 'fileMode', mode: 'hold' },
      { op: 'load', source: '![[Photo]]\n' },
      { op: 'editingMode', mode: 'source' },
      { op: 'fileAbortCount', name: 'cancelled' },
      { op: 'assert', name: 'cancelled', path: 'aborted', truthy: true },
      { op: 'fileRelease' },
      { op: 'fileMode', mode: 'normal' },
      { op: 'editingMode', mode: 'formatted' },
      { op: 'fileMode', mode: 'hold' },
      { op: 'startFileOutput', kind: 'print' },
      { op: 'load', format: 'txt', source: 'New literal' },
      { op: 'finishFileOutput', expectedError: 'stale-document' },
      assert('snapshot.text', 'New literal'),
      { op: 'commandState', name: 'state' },
      assert('pending', false, 'state'),
    ],
  }
  scenarios['integration-comments-instance-privacy'] = {
    source: 'Visible <!-- inline private --> body\n\n<!-- block private -->\n',
    operations: [
      { op: 'mountSecond', source: '<!-- second private -->\n' },
      { op: 'setCommentsVisible', visible: true },
      { op: 'dom', selector: '.inkkit-comment-inline', name: 'inline' },
      assert('nodes.0.display', 'inline', 'inline'),
      { op: 'dom', selector: '.inkkit-comment-block', name: 'block' },
      assert('nodes.0.display', 'block', 'block'),
      { op: 'secondState', name: 'second' },
      assert('commentDisplay', 'none', 'second'),
      { op: 'export', name: 'copy' },
      { op: 'assert', name: 'copy', path: 'text', excludes: 'private' },
      { op: 'assert', name: 'copy', path: 'html', excludes: 'private' },
      { op: 'printable', name: 'print' },
      { op: 'assert', name: 'print', path: 'html', excludes: 'private' },
      { op: 'setCommentsVisible', visible: false },
      { op: 'dom', selector: '.inkkit-comment', name: 'hidden' },
      assert('nodes.0.display', 'none', 'hidden'),
    ],
  }
}
const names = Object.keys(scenarios)
const groups = {
  core: [
    'reference-lifecycle',
    ...(releaseAtLeast('0.0.7') ? ['source-spelling-cross-mode-history'] : []),
  ],
  references: names.filter((name) => /reference|footnote/.test(name)),
  tables: names.filter((name) => name.startsWith('table-')),
  source: names.filter((name) => /^(source-|replacement-|outline-)/.test(name)),
  diagrams: names.filter((name) => name.startsWith('mermaid-')),
  print: names.filter((name) => /print/.test(name)),
  'host-controls': names.filter((name) => name.startsWith('host-')),
  'native-search': names.filter((name) => name.startsWith('native-search-')),
  'linked-files': names.filter((name) => name.startsWith('linked-files-')),
  media: names.filter((name) => name.startsWith('media-')),
  'portable-files': names.filter((name) => name.startsWith('portable-files-')),
  layout: names.filter((name) => name.startsWith('native-layout-')),
  integration: names.filter((name) => name.startsWith('integration-')),
  legacy: names.filter(
    (name) =>
      !name.startsWith('host-') &&
      !name.startsWith('intentional-') &&
      !name.startsWith('native-'),
  ),
}
const selected = new Set()
for (const group of requestedGroups) {
  if (!(group in groups))
    throw Error(
      `Unknown group: ${group}. Available: ${Object.keys(groups).join(', ')}`,
    )
  if (!groups[group].length) throw Error(`Empty group ${group} for ${version}`)
  groups[group].forEach((name) => selected.add(name))
}
for (const name of requestedScenarios) {
  if (!(name in scenarios)) throw Error(`Unknown scenario: ${name}`)
  selected.add(name)
}
if (!requestedGroups.length && !requestedScenarios.length) {
  ;(releaseAtLeast('0.0.8') ? groups.core : groups.legacy).forEach((name) =>
    selected.add(name),
  )
}
if (!selected.size) throw Error('Selection contains no scenarios')
if (list) {
  console.log(
    JSON.stringify(
      { version, groups, selected: [...selected], scenarios: names },
      null,
      2,
    ),
  )
  process.exit(0)
}
await mkdir(destination, { recursive: true })

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
  selection: { groups: requestedGroups, scenarios: [...selected] },
  scenarios: [],
}
for (const name of selected) {
  const fixture = scenarios[name]
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
  const printFailures = ['print', 'printable'].includes(fixture.mode)
    ? [
        ...(result?.print?.pages >= (fixture.printMinPages ?? 1)
          ? []
          : [`Printed PDF has fewer than ${fixture.printMinPages ?? 1} pages`]),
        ...(fixture.printIncludes ?? [])
          .filter((value) => !result?.print?.text?.includes(value))
          .map((value) => `Printed PDF omitted ${value}`),
        ...(fixture.printExcludes ?? [])
          .filter((value) => result?.print?.text?.includes(value))
          .map((value) => `Printed PDF included ${value}`),
        ...(fixture.mode === 'printable' &&
        result?.print?.frozenDocument !== true
          ? ['Print did not use the captured standalone HTML']
          : []),
        ...(fixture.mode === 'printable' &&
        (result?.print?.screenGeometry?.editorComponents !== 0 ||
          result?.print?.screenGeometry?.activeElements !== 0 ||
          result?.print?.screenGeometry?.externalResources?.length !== 0)
          ? [
              'Frozen print document contains editor controls, active elements or external resources',
            ]
          : []),
        ...(fixture.mode === 'printable' &&
        !result?.print?.pageGeometry?.every(
          (page) =>
            Math.abs(page.width - 595.28) < 1 &&
            Math.abs(page.height - 841.89) < 1,
        )
          ? ['Printed pages have unexpected geometry']
          : []),
        ...(fixture.printMinImages &&
        !(
          result?.print?.imageXObjects?.filter(
            (image) =>
              image.width > 0 && image.height > 0 && image.streamBytes > 0,
          ).length >= fixture.printMinImages
        )
          ? ['Printed PDF omitted embedded image streams']
          : []),
        ...(fixture.mode === 'printable'
          ? (
              result?.results?.[fixture.printableName ?? 'printable']
                ?.assetGeometry ?? []
            ).flatMap((asset) =>
              result?.print?.imagePlacements?.some(
                (image) =>
                  image.width === asset.width &&
                  image.height === asset.height &&
                  image.mediaBoxFraction > 0.999 &&
                  image.drawnWidth > 0 &&
                  image.drawnHeight > 0,
              )
                ? []
                : [
                    `Printed PDF has no complete page-contained image placement for ${asset.width}x${asset.height}`,
                  ],
            )
          : []),
        ...(fixture.printPortrait &&
        !result?.print?.imagePlacements?.some((image) => {
          if (
            image.width !== fixture.printPortrait.width ||
            image.height !== fixture.printPortrait.height ||
            image.mediaBoxFraction < 0.999
          )
            return false
          const raster = result?.print?.pageRasters?.find(
            (page) => page.page === image.page && page.image === image.name,
          )?.portrait
          const bands = [
            raster?.red ?? 0,
            raster?.green ?? 0,
            raster?.blue ?? 0,
          ]
          const coverage =
            (raster?.colourPixels ?? 0) / (image.drawnWidth * image.drawnHeight)
          return (
            raster?.rendered === true &&
            Math.min(...bands) > 100 &&
            Math.max(...bands) / Math.min(...bands) < 1.06 &&
            coverage > 0.95 &&
            coverage < 1.05
          )
        })
          ? [
              'Native PDF raster does not show all equal portrait bands covering the complete drawn image area',
            ]
          : []),
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
    steps: result?.steps?.length ?? 0,
    failures: result?.steps?.filter((step) => !step.passed) ?? [],
    finalError: result?.final?.error ?? null,
    ...(['print', 'printable'].includes(fixture.mode)
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
