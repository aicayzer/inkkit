# InkKit

InkKit is a TypeScript Markdown editor for offline web views and the web. It provides readable clipboard output, editable tables, optional host-managed images, and preservation of original Markdown and unsupported syntax.

```sh
npm install @aicayzer/inkkit
```

```ts
import { InkKitEditor } from '@aicayzer/inkkit'
import '@aicayzer/inkkit/style.css'

const editor = await InkKitEditor.mount(document.getElementById('editor')!, {
  changed(text, generation) {
    /* Notify the host. */
  },
  stateChanged(state) {
    /* Update formatting controls. */
  },
  openLink(href) {
    /* Open through the host. */
  },
  copy(text) {
    /* Write code-block text to the clipboard. */
  },
})
editor.loadDocument({
  documentId: 'note',
  generation: 1,
  format: 'md',
  text: '# Hello\n',
})
const snapshot = editor.snapshot(1)
```

Markdown includes CommonMark, task lists, strikethrough, autolinks, GFM tables, editable footnotes and reference-style links, bounded callouts, highlights, author comments and offline Mermaid diagrams. Unsupported constructs remain literal Markdown. TXT mode treats all text literally. Images require a host adapter. RTF files remain outside the package scope.

Table controls include complete row/column movement and explicit stable text or numeric sorting. Ordinary spreadsheet paste preserves cell boundaries, replaces selected cells and grows supported tables. Hosts call these operations through the public facade; each is undoable.

`await editor.printableSnapshot(1)` returns a complete printable HTML document, print styles and portable image bytes. It excludes author comments, includes folded content and reports unavailable assets or a changed document. Client apps own Print/PDF commands, dialogs and file generation.

See [supported syntax](docs/supported-syntax.md), [the host API](docs/api.md), [preservation and clipboard behavior](docs/preservation.md), [development](docs/development.md), and [releases](docs/releasing.md).

Delivery scope and release status are tracked in the [InkKit Project](https://github.com/users/aicayzer/projects/3) and [milestones](https://github.com/aicayzer/inkkit/milestones).

MIT licensed. InkKit builds on the public PadPad and Memos editors; see [NOTICE](NOTICE).
