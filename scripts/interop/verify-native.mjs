import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const version = process.argv[5] ?? '0.0.2'
if (!['0.0.2', '0.0.3', '0.0.4', '0.0.5'].includes(version))
  throw Error('Native fixture version must be 0.0.2, 0.0.3, 0.0.4 or 0.0.5')
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
  '> [!NOTE] Native &#13; title\n> Native note body.\n>  Indented &amp; native source.\n\n> [!TIP]+ Native &#10; title\n> Native tip body.\n\n> [!IMPORTANT]\n> Native important body.\n\n> [!WARNING]- Native folded title\n> Native folded body.\n\n- > [!CAUTION] Native nested title\n  > Native caution body.\n\n> [!TODO]\n> Unsupported native callout.\n\n> [!NOTE] + Spaced fold stays literal\n> Unsupported native fold.\n'
const commentSource =
  'Public [link][Shared] <!--INLINE_SECRET <script>window.commentExecuted=true</script>--> beside %%OBSIDIAN_SECRET%% text.\n\n<!--\nBLOCK_SECRET\n-->\n\n%%\nOBSIDIAN_BLOCK_SECRET\n%%\n\n[Shared]: https://example.com/shared\n'
if (['0.0.3', '0.0.4', '0.0.5'].includes(version))
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
if (['0.0.4', '0.0.5'].includes(version)) {
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
if (version === '0.0.5') {
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
    steps: result?.steps.length ?? 0,
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
