# InkKit

InkKit is a reusable Markdown editor for simple writing tools and richer document apps. It provides formatted editing, source preservation, portable clipboard content and optional host-managed images, while your app controls its appearance, files and interface.

Write in formatted or source mode with shared undo/redo. Edit tables, task lists, footnotes, reference links, highlights and callouts. Preview bounded Mermaid diagrams offline. Copy readable text and semantic HTML, explicitly copy Markdown source, or capture a complete printable document. Unsupported syntax remains editable literal Markdown.

**Version status:** 0.0.7 is published. This branch documents the **unpublished 0.0.8 candidate**, adding read-only and text-input policies, command availability, scoped appearance, labels and shortcuts. Installing from npm currently gets the published release; the new controls require the candidate.

```sh
npm install @aicayzer/inkkit
```

```ts
import { InkKitEditor } from '@aicayzer/inkkit'
import '@aicayzer/inkkit/style.css'

const root = document.getElementById('editor')!
const editor = await InkKitEditor.mount(root, {
  changed(text, generation) {
    // Notify the host; capture a fresh snapshot when saving.
  },
  stateChanged(state) {
    // Update the host's formatting controls.
  },
  openLink(href) {
    // Open through the host.
  },
  copy(text) {
    // Write code-block text to the clipboard.
  },
})

editor.loadDocument({
  documentId: 'note',
  generation: 1,
  format: 'md',
  text: '# Hello\n\nStart writing.\n',
})
const snapshot = editor.snapshot(1)
```

InkKit runs on the web and in offline web views. Hosts use its public TypeScript facade and own toolbars, menus, persistence, clipboard bridges, Print/PDF actions and image storage. Images require an adapter; private references stay opaque. TXT stays literal. RTF files and richer media are outside current support.

Start with the [feature guide](docs/supported-syntax.md) and [simple and rich integration examples](docs/integration.md). The [documentation index](docs/README.md) links to precise API, preservation, playground, verification and publication guidance.

Scope and release status live in the [InkKit Project](https://github.com/users/aicayzer/projects/3) and [version milestones](https://github.com/aicayzer/inkkit/milestones). Planned search, viewport and media extensions are tracked there; they are not capabilities of this candidate.

MIT licensed. InkKit builds on the public PadPad and Memos editors; see [NOTICE](NOTICE).
