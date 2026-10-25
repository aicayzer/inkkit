# Inkkit

A Markdown editor for the web and for apps that host a web view. It edits formatted text and keeps your Markdown as you wrote it: a document you open and leave is saved unchanged, and an edit rewrites only the blocks it touches.

- Formatted and source editing, with one undo history
- Tables, task lists, footnotes, callouts, highlights and reference links
- Mermaid diagram previews, offline
- Copy as readable text or HTML, or copy the Markdown itself
- Images and files through your own storage adapter
- Your app owns the toolbar, menus, files and appearance

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/aicayzer/inkkit/main/docs/images/how-inkkit-works-dark.svg">
  <img src="https://raw.githubusercontent.com/aicayzer/inkkit/main/docs/images/how-inkkit-works.svg" width="800" alt="An ordinary Markdown editor rebuilds the whole file when it saves, so list markers, spacing and escaping change. Inkkit loads the file and edits it formatted with Milkdown. A preservation layer between Milkdown and the file saves a note you open and leave byte for byte unchanged. After an edit, it keeps unchanged blocks as their original bytes, writes only edited blocks with Milkdown, and reads the result back. If it reopens as the same document, the edit is kept and saved. If not, the edit is refused and the note stays as it was. Your app owns the files, storage, toolbar and appearance.">
</picture>

A formatted Markdown editor usually rebuilds the whole file when it saves, so opening and saving a note can change list markers, spacing and escaping that you never touched. Inkkit adds a preservation layer between [Milkdown](https://milkdown.dev) and the file. A note that you open and leave is saved byte for byte unchanged, and after an edit only the blocks you edited are rewritten. Inkkit reads the result of each edit back and refuses the edit if it would not reopen as the same document.

For the exact guarantees, see [Preservation](https://github.com/aicayzer/inkkit/blob/main/docs/preservation.md).

## Install

```sh
npm install @aicayzer/inkkit
```

An app that does not render diagrams can import from `@aicayzer/inkkit/core` instead. That entry leaves Mermaid out of the app's bundle and keeps diagrams as editable source. See [Builds without diagrams](https://github.com/aicayzer/inkkit/blob/main/docs/api.md#builds-without-diagrams).

## Supported engines

Inkkit supports Safari and `WKWebView` 17.5 or later (iOS 17.5, macOS 14.5), Chrome and Edge 123 or later, and Firefox 125 or later. The host page must declare UTF-8. See [Supported engines](https://github.com/aicayzer/inkkit/blob/main/docs/integration.md#supported-engines) for the APIs behind these versions.

## Use

```ts
import { InkKitEditor } from '@aicayzer/inkkit'
import '@aicayzer/inkkit/style.css'

const editor = await InkKitEditor.mount(document.getElementById('editor')!, {
  changed({ generation, revision, text }) {},
  commandStateChanged({ caret }) {},
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

## Built with Inkkit

- [Memos](https://github.com/aicayzer/memos): a small Mac app for memos, in one floating window
- [PadPad](https://github.com/aicayzer/padpad): a small Mac app for quick text and files

## Learn more

- [Supported syntax](https://github.com/aicayzer/inkkit/blob/main/docs/supported-syntax.md)
- [Integration guide](https://github.com/aicayzer/inkkit/blob/main/docs/integration.md)
- [API reference](https://github.com/aicayzer/inkkit/blob/main/docs/api.md)
- [All documentation](https://github.com/aicayzer/inkkit/blob/main/docs/README.md)

## License

[MIT](LICENSE). Third-party notices are in [NOTICE](NOTICE).
