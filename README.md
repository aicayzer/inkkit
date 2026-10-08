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

Markdown includes CommonMark, task lists, strikethrough, autolinks and GFM tables. Unsupported constructs remain literal Markdown. TXT mode treats all text literally. Images require a host adapter. Footnote editing and RTF files are not included in 0.0.1.

See [the host API](docs/api.md), [preservation and clipboard behavior](docs/preservation.md), [development](docs/development.md), and [releases](docs/releasing.md).

Planned work and release scope are tracked in the [InkKit Project](https://github.com/users/aicayzer/projects/3) and [milestones](https://github.com/aicayzer/inkkit/milestones). Later release targets are provisional.

MIT licensed. InkKit builds on the public PadPad and Memos editors; see [NOTICE](NOTICE).
