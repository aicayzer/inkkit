# Integration and customisation

Inkkit supplies document editing and portable exports. Your app supplies its interface, files and storage. Use exports from `@aicayzer/inkkit`; hosts do not import Milkdown or ProseMirror internals. The [API reference](api.md) defines errors and asynchronous contracts, and [preservation](preservation.md) explains source and clipboard fidelity.

## Supported engines

Inkkit supports these engines. Each version is the oldest in which every API below, except the optional one, works as designed.

| Engine                                     | Oldest supported version                         |
| ------------------------------------------ | ------------------------------------------------ |
| WebKit: Safari and `WKWebView`             | 17.5, the WebKit in iOS 17.5 and macOS 14.5      |
| Chromium: Chrome, Edge and Android WebView | 123                                              |
| Firefox                                    | 125. CI does not run Firefox, so it is untested. |

The versions come from these APIs. Each one shipped in at least one engine after 2022:

| API                                                                                                           | WebKit | Chromium | Firefox | Below that version                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| [`Intl.Segmenter`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) | 14.1   | 87       | 125     | The editor does not load.                                                                            |
| Regular expression lookbehind assertions                                                                      | 16.4   | 62       | 78      | The editor does not load.                                                                            |
| ES2022 class static blocks                                                                                    | 16.4   | 94       | 93      | The editor does not load.                                                                            |
| CSS [`light-dark()`](https://developer.mozilla.org/docs/Web/CSS/color_value/light-dark)                       | 17.5   | 123      | 120     | Code text takes the editor text color until the host sets the `--inkkit-code-*` tokens.              |
| CSS [`color-mix()`](https://developer.mozilla.org/docs/Web/CSS/color_value/color-mix)                         | 16.2   | 111      | 113     | Muted text, rules, code backgrounds and the selection lose their default colors.                     |
| CSS [`:has()`](https://developer.mozilla.org/docs/Web/CSS/:has)                                               | 15.4   | 105      | 121     | A small image preview is not widened to its minimum size.                                            |
| CSS [`lh` unit](https://developer.mozilla.org/docs/Web/CSS/length#lh)                                         | 16.4   | 109      | 120     | Task checkboxes are not centered on the first line of their item.                                    |
| [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API)               | 17.2   | 105      | 149     | Optional. The engine draws its own selection, which also fills the margins beside the selected text. |

Versions are from MDN browser compatibility data 8.1.5. `CSS.highlights` arrived in Firefox 140, but the `::highlight()` styling Inkkit needs arrived in 149, so Inkkit checks for both.

Declare UTF-8 in the page that loads Inkkit, for example with `<meta charset="utf-8">`. The bundle contains non-ASCII text, and WebKit reads an undeclared single-file page as Latin-1, which stops the script from loading.

## A simple writing tool

A small host can mount the editor without an image adapter or custom toolbar. The event handlers connect to the host's own controls, link handling and clipboard. This example uses the core entry, which leaves Mermaid out of the build and keeps diagrams as editable source; see [Builds without diagrams](api.md#builds-without-diagrams).

```ts
import { InkKitEditor, type EditorEvents } from '@aicayzer/inkkit/core'
import '@aicayzer/inkkit/style.css'

async function mountWritingTool(root: HTMLElement, events: EditorEvents) {
  const editor = await InkKitEditor.mount(root, events, {
    textInput: { spellcheck: true },
    rendering: { codeHighlighting: false, diagramPreview: false },
  })
  editor.loadDocument({
    documentId: 'draft',
    generation: 1,
    format: 'md',
    text: '# Draft\n\nWrite here.\n',
  })
  return editor
}
```

Capture `editor.snapshot(1)` when saving. Persist its complete `text` only after capture succeeds; a composition, pending operation or stale generation error is not an unchanged document. Keep the document open on failure. The `changed` event can prompt save scheduling, but it does not replace a fresh snapshot at the save boundary.

Without an image adapter, image references remain literal Markdown. TXT documents use `format: 'txt'` and remain literal on both screen and export. The host can offer formatted/source switching through `setEditingMode()` without replacing the document; source edits made in source mode become one history step when the formatted view is shown again.

Omit `rendering` to keep highlighting and diagram previews. Explicit clipboard and printable diagram exports still render when previews are disabled. The generic isolated native consumer and its selectable `integration` group exercise assembled minimal/rich interactions; these fixture hosts establish engine contracts without proving app storage, permissions or opening actions. See [measured costs](performance.md) and the [native runner](../scripts/interop/README.md).

## A richer document app

Pass an adapter for image presentation, import and portable export. Observe `commandStateChanged` to enable native menus or toolbar buttons and to show active formatting from its `caret`. The host owns localisation and controls outside the editor.

```ts
import {
  InkKitEditor,
  type EditorEvents,
  type ImageAdapter,
} from '@aicayzer/inkkit'

async function mountDocumentApp(
  root: HTMLElement,
  events: EditorEvents,
  images: ImageAdapter,
) {
  const editor = await InkKitEditor.mount(root, events, {
    images,
    editable: true,
    textInput: {
      spellcheck: true,
      autocorrect: false,
      autocapitalize: 'sentences',
    },
    keymap: {
      bold: ['Mod-b'],
      italic: ['Mod-i'],
      heading1: ['Mod-Alt-1'],
      tableAddRowAfter: ['Mod-Alt-ArrowDown'],
    },
  })
  editor.loadDocument({
    documentId: 'document',
    generation: 1,
    format: 'md',
    text: '# Document\n',
  })
  return editor
}
```

After loading, `editor.commandState(1)` returns current availability without changing the document. Supply the optional `events.commandStateChanged(state)` callback to observe selection, edits, history, mode and policy changes. Use `state.commands.undo`, `state.commands.format.bold` or `state.commands.table.addRowAfter` to enable the corresponding controls. Availability is current context, not a promise that a later action will succeed; invoke the operation with the current generation and handle its errors.

`editor.setEditable(false)` makes both editing surfaces read-only. Selection, copying, find, heading navigation, folding and mode switching remain available. Host document loading is still allowed. Re-enable editing with `editor.setEditable(true)`; history is retained. Pending imports and deferred destructive operations invalidated by the transition cannot later commit, even after editing is re-enabled. The host adapter remains responsible for retained bytes and orphan cleanup.

`editor.setTextInputPreferences({ spellcheck: false })` changes native HTML input attributes on both surfaces. It replaces the preference set; omitted fields remove earlier explicit attributes and leave behaviour to the browser. Editability and input-policy changes throw `composition` during composition, without partial changes; successful transitions preserve source, revision, dirty state, history, focus and selection. Browser and OS support determines whether an input preference takes effect. `smartPunctuation` is Inkkit's own and doesn't depend on the browser; see [Smart punctuation](api.md#smart-punctuation).

## Optional slash block menu

Enable `slashMenu` at mount to let a person choose a block by typing `/` on an empty line. Existing hosts keep their current behavior unless they opt in. Select the built-in commands with `commands`, localize their names through `labels`, and append host actions with `customCommands`.

```ts
import {
  InkKitEditor,
  type DocumentContext,
  type EditorEvents,
} from '@aicayzer/inkkit'

async function mountWithBlockMenu(
  root: HTMLElement,
  events: EditorEvents,
  chooseNoteLink: (context: DocumentContext) => Promise<string | undefined>,
) {
  return InkKitEditor.mount(root, events, {
    slashMenu: {
      enabled: true,
      commands: ['heading1', 'heading2', 'bulletList', 'taskList', 'quote'],
      customCommands: [
        {
          name: 'Link to Note',
          keywords: ['note', 'link'],
          action: chooseNoteLink,
        },
      ],
    },
    labels: { slashTaskList: 'To-do List' },
  })
}
```

In this example, the host's `chooseNoteLink` searches its notes and returns the Markdown link to insert on the trigger line. The host owns lookup, permissions and navigation. Return `undefined` when the person cancels. Inkkit parses returned Markdown, checks preservation and commits the replacement as one undo step. One Undo restores the line from before the slash. A slow action leaves typing responsive; changes to the document, selection, mode, editability or presentation invalidate its pending result. Handle failures through `events.error`; failed and canceled actions keep the typed text.

Omit `commands` to offer every built-in command. The order is fixed, and Diagram is offered only when the loaded entry supplies diagram previews and `rendering.diagramPreview` is not `false`. The menu supports empty lines inside lists, quotes and callouts; source, TXT, read-only, code, table and front matter contexts do not open it. The [slash menu API](api.md#slash-block-menu) defines filtering, keys, dismissal and host action contracts.

Set `--inkkit-menu-background`, `--inkkit-menu-text`, `--inkkit-menu-highlight`, `--inkkit-menu-radius`, `--inkkit-menu-shadow` and `--inkkit-menu-width` on the root to customize the popup. The default selection highlight is soft gray in light mode and follows the editor color scheme. Use the documented tokens and labels rather than targeting internal menu elements.

## Host search and overlapping chrome

Keep the search field and match list in the host. Capture `editor.textSnapshot()` and search its readable `text`; carry its `snapshotId` with every UTF-16 match range. A selection-only search result can call `selectTextRange()` without taking focus away from the host field. Use explicit reveal/navigation when the user asks to visit a result. Capture fresh ranges after edits, mode changes, reloads or document replacement. Handle stale-range rejection rather than reusing old offsets.

Supply your own scroll container and header/search-bar insets through `setViewport()`. Geometry and drop coordinates use client CSS pixels; translate them into native coordinates in the host. The editor owns no header rendering, toolbar layout or native search UI. `textRangesRects()` and `visibleTextRanges()` are demand-driven; they do not require a stream of per-character geometry across the bridge.

Loading a document does not grab focus or scroll a browsing host to a caret. External reload preserves valid selection, scrolling and focus. Explicit navigation reveals the target using the same inset-aware viewport on formatted and source/TXT surfaces. See the [API contract](api.md#native-readable-text-and-layout) for readable text, protected ranges and coordinate semantics.

## Appearance, labels and shortcuts

Package styles are scoped to the Inkkit root so another editor or unrelated host content does not inherit its rules. Set documented `--inkkit-*` properties on the mounted root or an ancestor. Keep your own layout, toolbar and menus in the host. The [API reference](api.md#appearance-labels-and-shortcuts) lists tokens, label names and shortcut contracts.

Inkkit owns attachment preview sizing, footer wrapping, control line height and resize-handle geometry. Long filenames use a single ellipsized line with the full name retained as accessible text and a tooltip; status descriptions remain readable. Attachment controls, wiki links and media use the same documented color, font and focus tokens as the editor. Customize those tokens rather than overriding internal `.inkkit-image`, `.inkkit-image-handle` or `.inkkit-file-*` selectors. Internal classes and markup are not a supported styling API. The Open control is a compact arrow after the filename, labelled with the `fileOpen` label and the filename for assistive technology. Read-only images hide the resize handle; Open, Retry and media playback remain available. To draw no focus ring on the editing surfaces while keeping the controls' rings, set `--inkkit-surface-focus-width: 0` on the root rather than overriding `.ProseMirror` or `.inkkit-plain`.

Mount-time `labels` override the editor's built-in accessible names and visible text. Supply plain text from the host's localisation catalogue; supplied labels are not interpreted as markup. Host toolbar and native menu labels are outside this option.

Pass `keymap` at mount or call `setKeymap()` with bindings in ProseMirror key notation such as `Mod-b`. The names are typed as `ShortcutName`, so a misspelt name fails to compile, and an unknown name throws `invalid-argument` at run time. Each call replaces the whole map. Formatting bindings are supplied by the host, by the same names as the `format` commands. Undo/redo keep their default history bindings, and the block moves keep Option-Up and Option-Down, unless overridden; an explicit empty array disables that command's configurable defaults. Formatting and table commands apply only where their command state permits; history bindings apply across formatted, source and TXT surfaces.

## Native boundaries and disposal

Image references are opaque. The adapter owns bytes, access control, storage and private display URLs. Keep imported bytes available through pending operations and unsaved edits. Validate document identity, generation and operation ID in native callbacks. Portable exports carry bytes rather than private URLs.

For native clipboard writes, await `clipboardSnapshot(scope, generation)` and check the `documentId`, `generation` and `revision` it carries before replacing the clipboard; output that `events.clipboard` receives carries them too. Supply `events.clipboard` for image or diagram selections and resolve its promise only after the native write succeeds. Cut waits for that acknowledgement before deleting content. Encode byte arrays explicitly when crossing a JSON bridge.

`printableSnapshot()` returns a complete frozen printable document with portable assets; the app owns Print/PDF commands, dialogs and file generation. Before switching or closing a document, capture a fresh save snapshot. Pass a greater generation on every load and reload, pass the current one as the expected generation on every call that takes one, and await `editor.destroy()` before removing the mounted root. Call `blur(generation)` to release focus from the editor, rather than finding its elements.

## Optional linked files

Add `wikiLinks` and/or `files` to the mount options when the host can resolve them. Keep the existing `images` adapter for captured-image imports and legacy path-image export. File resolution receives an abort signal and opaque reference; return a declared kind and a private offline display resource, or an explicit missing/error result. Supply portable image bytes through `files.exportImage` when named images must copy or print. Storage, permissions, URL creation/revocation, note lookup and native Open/Reveal actions stay in the host.

Keep private URLs out of source and host clipboard writers. Use `clipboardSnapshot`/`events.clipboard` output for portable rich copy, and `printableSnapshot` for printing. Media/file descriptions are supported print representations, with `attachment-fallback` warnings; unresolved files produce `attachment-unavailable`. Handle `image-unavailable` as an asset failure rather than printing a broken image. Honour `FileContext.signal`; Inkkit also ignores stale results and cancels pending output if the captured document or mode changes. No app adoption is implied by enabling these package adapters.

See the [public adapter contract](api.md#optional-wiki-links-and-files) and [representation table](supported-syntax.md#linked-syntax) before wiring native actions.

## Note suggestions

A wiki-link host can supply an asynchronous matcher without enabling the slash menu:

```ts
const editor = await InkKitEditor.mount(root, events, {
  wikiLinks: {
    open(reference, context) {
      openNote(reference.target, context.documentId)
    },
    async suggest(query, context) {
      return findNoteNames(query, context.signal)
    },
  },
})
```

The host owns the note index, matching and access policy. Return only note names the person may select. Inkkit owns the shared suggestion list, bracket insertion, escaping, history and preservation checks. Requests carry document identity and an abort signal; do not apply their results directly to the editor. See [note suggestions](api.md#note-suggestions) for cancellation and error behavior.
