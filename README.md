# InkKit

A Markdown editor for the web and for apps that host a web view. It edits formatted text and keeps your Markdown as you wrote it: a document you open and leave is saved unchanged, and an edit rewrites only the blocks it touches.

- Formatted and source editing, with one undo history
- Tables, task lists, footnotes, callouts, highlights and reference links
- Mermaid diagram previews, offline
- Copy as readable text or HTML, or copy the Markdown itself
- Images and files through your own storage adapter
- Your app owns the toolbar, menus, files and appearance

## Install

```sh
npm install @aicayzer/inkkit
```

An app that does not render diagrams can import from `@aicayzer/inkkit/core` instead. That entry leaves Mermaid out of the app's bundle and keeps diagrams as editable source. See [Builds without diagrams](docs/api.md#builds-without-diagrams).

## Use

```ts
import { InkKitEditor } from '@aicayzer/inkkit'
import '@aicayzer/inkkit/style.css'

const editor = await InkKitEditor.mount(document.getElementById('editor')!, {
  changed(markdown, generation) {},
  stateChanged(state) {},
  openLink(href) {},
  copy(text) {},
})

editor.loadDocument({
  documentId: 'note',
  generation: 1,
  format: 'md',
  text: '# Hello\n\nStart writing.\n',
})

const { text } = editor.snapshot(1)
```

## Built with InkKit

- [Memos](https://github.com/aicayzer/memos): a small Mac app for memos, in one floating window
- [PadPad](https://github.com/aicayzer/padpad): a small Mac app for quick text and files

## Learn more

- [Supported syntax](docs/supported-syntax.md)
- [Integration guide](docs/integration.md)
- [API reference](docs/api.md)
- [All documentation](docs/README.md)

## License

[MIT](LICENSE). Third-party notices are in [NOTICE](NOTICE).
