# Host API

This page is the reference for everything the `@aicayzer/inkkit` package exports: the editor, its options and events, every method with its arguments, results and errors, and the types, tokens and labels around them. To connect InkKit to an app, start with the [integration guide](integration.md). For what the editor renders and keeps, see [supported syntax](supported-syntax.md) and [preservation and clipboard behavior](preservation.md).

InkKit has one class, `InkKitEditor`, and one error type, `InkKitError`. Every other export is a type. A host imports only `@aicayzer/inkkit`, `@aicayzer/inkkit/core` and `@aicayzer/inkkit/style.css`. The classes and markup inside the editor are not part of the API.

These conventions apply to every member:

- **Synchronous methods throw and asynchronous methods reject**, always with an `InkKitError`. A failed call changes nothing, except after an `internal` error. See [Errors](#errors).
- **`null` counts as omitted** for an optional parameter or option field, because WebKit bridges send JSON `null` for a missing value.
- **Unknown names fail.** An option, event, label, shortcut, command or field that this page doesn't list throws `invalid-argument`, so a misspelling is never silently ignored.
- **Every call that touches a document can name the generation it expects.** See [Document identity](#document-identity).
- **Offsets are UTF-16 code units** in the text snapshot that names them. Row and column indices are zero-based.

## Entry points

| Specifier                    | Contents                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `@aicayzer/inkkit`           | The editor, with Mermaid diagram previews.                                                    |
| `@aicayzer/inkkit/core`      | The same exports. It never imports Mermaid, so diagram fences stay editable source.           |
| `@aicayzer/inkkit/style.css` | The stylesheet, for either entry. Import it into the host bundle. It is scoped to the editor. |

### Builds without diagrams

The core entry bundles without Mermaid, so each web view parses and holds a much smaller page. Mermaid is still installed as a dependency, but a host that imports only the core entry doesn't bundle it. See [measurements](performance.md#builds-with-and-without-mermaid-october-14-2026).

With the core entry, `mermaid` fences remain editable code blocks that keep their authored source. No preview is shown, whatever `rendering.diagramPreview` says, and `events.error` never reports `diagram-unavailable`, while editing or when copying. Clipboard output and `printableSnapshot()` keep the diagram source as readable code, the same fallback as a diagram that cannot render: clipboard `diagrams` entries carry an `error`, and print reports a `diagram-unavailable` warning.

Import from one entry throughout the app. If any module imports `@aicayzer/inkkit`, the bundle includes Mermaid, and every editor renders diagram previews unless `rendering.diagramPreview` is `false`.

```ts
import { InkKitEditor } from '@aicayzer/inkkit/core'
import '@aicayzer/inkkit/style.css'
```

## A first editor

```ts
import { InkKitEditor } from '@aicayzer/inkkit'
import '@aicayzer/inkkit/style.css'

const editor = await InkKitEditor.mount(document.getElementById('editor')!, {
  changed({ generation, revision, text }) {
    // Schedule a save. Take a fresh snapshot() when you write the file.
  },
  error(error) {
    console.error(error.code, error.message)
  },
})

editor.loadDocument({
  documentId: 'note-1',
  generation: 1,
  format: 'md',
  text: '# Hello\n\nStart writing.\n',
})

const { text } = editor.snapshot(1)

await editor.destroy()
```

## Using the API from a native bridge

An app that hosts the editor in a web view reaches these members through its own JavaScript shim. These points matter at that boundary:

- **Pass the generation your native model holds** as `expectedGeneration` on every call that takes one. A call meant for a document that has since been replaced then fails with `stale-document` instead of changing the new one.
- **Send JSON `null` for a missing value.** InkKit treats it as omitted.
- **Await promises in the shim.** `mount`, `printableSnapshot`, `clipboardSnapshot`, `paste` and `destroy` return promises. Every other method returns its result at once.
- **Send `code` and `message` to native code,** not the error object. JSON serialization drops an error's `message`, and `code` is what native code should branch on.
- **Encode bytes.** A `Uint8Array`, in image adapters, `ClipboardInput.images`, `PortableImage` and `PrintableDocument.assets`, has no useful JSON form. Encode it, for example as base64, on each side.
- **Convert coordinates.** Points and rectangles are CSS pixels in the web view's client area, not device pixels. See [Native readable text and layout](#native-readable-text-and-layout).
- **Implement adapters in the shim.** An adapter is a set of JavaScript functions. To keep files in native storage, have each function call native code and return the result as a promise.
- **Answer synchronous adapter calls without waiting for native code.** `ImageAdapter.presentation` and `WikiLinkAdapter.resolve` return at once. Return a display URL that the shim can build itself, such as one in a custom scheme that native code serves.

## Mounting

```ts
InkKitEditor.mount(
  root: HTMLElement,
  events: EditorEvents,
  options?: EditorOptions,
): Promise<InkKitEditor>
```

`mount` builds the editor inside `root` and adds the class `inkkit-root` to it. The editor starts with no document; call `loadDocument` before any method that needs one. Keep the root in the page, and leave its children alone, until `destroy()` completes.

`mount` never throws. It rejects with `invalid-argument` when `root` isn't an `HTMLElement`, when `events` lacks a `changed` function or names something that isn't an event, or when `options` has an unknown field or a field of the wrong type.

| Option      | Type                                                       | Default                      | Meaning                                                                                                                                                          |
| ----------- | ---------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `images`    | `ImageAdapter`                                             | None                         | Shows, imports and exports images. See [Images](#images). Without `images` and `files`, image Markdown stays literal source.                                     |
| `files`     | `FileAdapter`                                              | None                         | Resolves path images and `![[name]]` embeds into images, audio, video, PDFs and file cards. See [Optional wiki links and files](#optional-wiki-links-and-files). |
| `wikiLinks` | `WikiLinkAdapter`                                          | None                         | Resolves and opens `[[wiki links]]`. Without it, they stay literal source.                                                                                       |
| `editable`  | `boolean`                                                  | `true`                       | Whether the person can edit. Change it later with `setEditable`.                                                                                                 |
| `textInput` | `TextInputPreferences`                                     | `{}`, the browser's behavior | Spell check, autocorrect and autocapitalization hints, and smart punctuation. Change them later with `setTextInputPreferences`.                                  |
| `labels`    | `Partial<EditorLabels>`                                    | The English defaults         | Replaces built-in text and accessible names. See [Labels](#labels).                                                                                              |
| `keymap`    | `Keymap`                                                   | History, moves, table exit   | Shortcut bindings. Change them later with `setKeymap`. See [Shortcuts](#shortcuts).                                                                              |
| `rendering` | `{ codeHighlighting?: boolean, diagramPreview?: boolean }` | Both `true`                  | Turns code highlighting or diagram previews off. See [Code highlighting and diagram previews](#code-highlighting-and-diagram-previews).                          |
| `slashMenu` | `SlashMenuOptions`                                         | `{ enabled: false }`         | Offers block commands when `/` is typed on an empty line. See [Slash block menu](#slash-block-menu).                                                             |

`images`, `files`, `wikiLinks`, `labels`, `rendering` and `slashMenu` are fixed at mount, and so is whether `events.copy` is set, because it decides whether code blocks draw a Copy button. The other options can change later through the methods named in the table.

`destroy(): Promise<void>` cancels pending work, releases the editor, and removes `inkkit-root` from the root if InkKit added it. It resolves when the editor is gone and never rejects. After it, every member except `destroy` throws `destroyed`; calling `destroy` again does nothing. Await it before you remove the root from the page.

## Document identity

The host's `generation` is the one freshness token. Each load and reload must bring a greater generation than the loaded one, including a reload of identical text, so a generation names exactly one load. Within a load, `revision` counts content changes from 0: edits, undo, redo, paste and source replacement. Order a document's changes by `(generation, revision)`. A counter that the host increments on every load, such as one per window, works as the generation.

Every output says which document it describes, with the fields of `DocumentVersion`:

```ts
interface DocumentVersion {
  documentId: string
  generation: number
  revision: number
}
```

`DocumentSnapshot`, `PrintableDocument`, `ReadableTextSnapshot`, `CommandState`, `Heading` and `ClipboardOutput` extend it, and so do the values that `changed` and `commandStateChanged` receive. Clipboard output carries the version that the copy started from, on `clipboardSnapshot()` and on `events.clipboard`, so a clipboard handler doesn't need to call `snapshot()`.

Most methods that read or change the document, its selection or its focus take `expectedGeneration` as their last parameter; the following table shows which don't. When the loaded document has a different generation, the method throws `stale-document`, or rejects if it's asynchronous, and changes nothing. Omitted or `null` means the current generation, which suits a page with one document. A host that calls InkKit across a native bridge should pass it on every call, so that a call meant for a document that has since been replaced fails instead of acting on the new one.

The following table lists every member by what it checks. Each member first throws `destroyed` if the editor was destroyed, then `invalid-argument` for a bad argument. The last column lists the state checks that follow, in order. Synchronous methods throw these errors, and asynchronous methods reject with them.

| Members                                                                                                                                                                              | Expected generation                                    | Then throws                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadDocument`, `editable`, `editingMode`, `setKeymap`, `setViewport`, `viewport`, `setCommentsVisible`                                                                              | None.                                                  | Nothing.                                                                                                                                                        |
| `setEditable`, `setTextInputPreferences`                                                                                                                                             | None.                                                  | `composition`.                                                                                                                                                  |
| `reloadDocument`                                                                                                                                                                     | Optional, the last parameter. Checked only when given. | `not-ready` and `stale-document`, only when the generation is given.                                                                                            |
| `commandState`, `focus`, `blur`                                                                                                                                                      | Optional, the last parameter.                          | `not-ready`, `stale-document`.                                                                                                                                  |
| `snapshot`, `printableSnapshot`, `clipboardSnapshot`, `setEditingMode`, `find`, `navigateFootnote`, `textSnapshot`, `headings`                                                       | Optional, the last parameter.                          | `not-ready`, `stale-document`, `composition`, `operation-pending`.                                                                                              |
| `navigateHeading`                                                                                                                                                                    | None. The heading entry names a version.               | `not-ready`, `stale-document` for another generation, `composition`, `operation-pending`, then `stale-document` for an older revision or mode.                  |
| `selectTextRange`, `revealTextRange`, `textRangesRects`, `visibleTextRanges`                                                                                                         | None. The range's `snapshotId` names a version.        | `not-ready`, `composition`, `operation-pending`, then `stale-document` for a `snapshotId` that is no longer current.                                            |
| `paste`, `pasteAsPlainText`, `replaceSource`, `undo`, `redo`, `replace`, `replaceAll`, `format`, `table`, `insertPaths`, `insertImages`, `insertFootnote`, `editReferenceDefinition` | Optional, the last parameter.                          | `not-ready`, `stale-document`, `composition`, `operation-pending`, `read-only`.                                                                                 |
| `moveBlock`                                                                                                                                                                          | Optional, the last parameter.                          | `not-ready`, `stale-document`, `composition`, `operation-pending`, `read-only`.                                                                                 |
| `replaceTextRange`                                                                                                                                                                   | None. The range's `snapshotId` names a version.        | `not-ready`, `composition`, `operation-pending`, `stale-document`, `read-only`.                                                                                 |
| `insertText`, `keyDown`                                                                                                                                                              | Required, for buffered native input.                   | `not-ready`, `stale-document`, `composition`, `operation-pending`, `read-only` for `insertText`; see [Formatting and keys](#formatting-and-keys) for `keyDown`. |

`destroy` has no checks. During composition with the current generation, `insertText` and `keyDown` return `false` instead of throwing `composition`.

## Loading and saving

| Member                                                      | Returns            | Purpose                                                               |
| ----------------------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `loadDocument(input: DocumentInput)`                        | `void`             | Replaces the document.                                                |
| `reloadDocument(input: DocumentInput, expectedGeneration?)` | `void`             | Replaces the document with a newer version of it and keeps the caret. |
| `snapshot(expectedGeneration?)`                             | `DocumentSnapshot` | Returns the complete current text. This is what a host saves.         |

`DocumentInput` has four required fields:

| Field        | Type              | Meaning                                                                                                                                |
| ------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `documentId` | `string`          | The host's name for the document. InkKit never interprets it. It comes back on every output and goes to every adapter call.            |
| `generation` | integer           | The number of this load. It must be greater than the loaded generation. The first load accepts any integer.                            |
| `format`     | `'md'` or `'txt'` | `md` loads Markdown. `txt` loads literal text, which is shown, edited and exported as typed, with no formatting and no formatted mode. |
| `text`       | `string`          | The complete text. An empty string is an empty document.                                                                               |

`loadDocument` replaces the document. It clears the undo history, returns the editor to formatted mode, cancels pending image imports and exports, puts the caret at the end, and takes focus off the editor's text surfaces, leaving focus in any host control where it is. It doesn't scroll to the caret. It sends one `commandStateChanged` and no `changed`, and it works while the editor is read-only. A generation that isn't greater throws `invalid-argument` and changes nothing.

`reloadDocument` loads a newer version of the same document under the same generation rule. It keeps the selection where it still fits, the focus, the scroll position and, for Markdown, the editing mode. With `expectedGeneration`, it first checks that the loaded document is that generation, and otherwise throws `stale-document` and changes nothing. That check comes before the generation rule: a stale expectation throws `stale-document` even when the new generation isn't greater.

A top-level block of Markdown that the editor can't build in full loads as literal source, which keeps its bytes. Markdown that can't be kept even that way throws `preservation`, and the load changes nothing. See [Preservation and clipboard behavior](preservation.md).

`snapshot` returns a `DocumentSnapshot`: the fields of `DocumentInput` and `DocumentVersion`, plus `dirty`, which is `true` when the text differs from the text of the last load. The `text` is the exact authored source, including line endings, and an untouched document returns the bytes that were loaded. `snapshot` throws for a missing document, composition, a pending image import, a stale generation or a destroyed editor, and it throws `preservation` when the current content can't be written as Markdown that reopens as shown. A failed snapshot is not an unchanged document: don't save, and keep the document open. Save, close, switching and Copy as Markdown must capture a fresh snapshot before changing native state.

## Errors

Every failure InkKit reports is an `InkKitError`, which extends `Error`. Its `name` is `'InkKitError'`. Branch on its `code`, an `EditorErrorCode` that is one of the values in the following table; the `message` is for logs. You can construct one, for example in a test double, with `new InkKitError(code, message, { cause })`. When the failure started elsewhere, such as in an adapter, the host clipboard or the diagram renderer, the original error is `cause`.

| Code                    | Raised when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Arrives as                                                                                                           | Retry                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `not-ready`             | A call that needs a loaded document, such as `snapshot`, `commandState` or `focus`, comes before the first `loadDocument`. [Document identity](#document-identity) lists which members need one.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Thrown; rejected by async methods.                                                                                   | Yes, after `loadDocument`.                                                                                            |
| `destroyed`             | Any method is called after `destroy()`, except `destroy()` itself, which does nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Thrown; rejected.                                                                                                    | Never.                                                                                                                |
| `stale-document`        | The expected generation is not the loaded one; a text range or heading comes from an older snapshot; or the document changed while asynchronous work, such as a copy, print, image import or deferred cut, was running.                                                                                                                                                                                                                                                                                                                                                                                                                                | Thrown; rejected; `events.error` for a deferred cut and late image imports.                                          | Not with the same generation or range. Read the state again and act again if it still applies.                        |
| `composition`           | Text composition (IME) is active and the call would read or change the document, or change editability or input preferences. `commandState()`, `focus`, `blur`, `loadDocument` and `reloadDocument` don't raise it.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Thrown; rejected.                                                                                                    | Yes, after `commandStateChanged` reports `composing: false`.                                                          |
| `operation-pending`     | An image import is still running.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Thrown; rejected.                                                                                                    | Yes, after `commandStateChanged` reports `pending: false`.                                                            |
| `read-only`             | A mutating method is called while `editable` is `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Thrown; rejected.                                                                                                    | Yes, after `setEditable(true)`.                                                                                       |
| `invalid-argument`      | A parameter has the wrong type or is outside its documented range: an unknown mode, command, keymap name or option; text that is not a string; a table size outside 1 to 100; a sort column that does not exist; a footnote label that cannot be saved; a value that is not a heading entry; a viewport container that is not the root or an ancestor; a negative or non-finite inset; a clipboard scope other than `'document'` or `'selection'`; an event handler or `ClipboardInput` field that doesn't exist, such as `stateChanged` or `plainText`; or a generation on `loadDocument` or `reloadDocument` that isn't greater than the loaded one. | Thrown; rejected.                                                                                                    | Never with the same arguments; it's a host defect.                                                                    |
| `invalid-range`         | A current text range can't be used: it splits a surrogate pair or a protected label, or a replacement crosses an embed, a hard break, a hidden comment or a block boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Thrown.                                                                                                              | Not with the same range.                                                                                              |
| `preservation`          | An edit would save Markdown that doesn't reopen as shown, so it's refused; `loadDocument()` or `reloadDocument()` gets Markdown that it can't show without losing part of it; or `snapshot()` or a selection copy can't serialize the current content.                                                                                                                                                                                                                                                                                                                                                                                                 | Thrown by the call that made the edit; rejected by `clipboardSnapshot()`; `events.error` for edits the person makes. | Never for the same edit or load on the same content. After a failed snapshot, don't save, and keep the document open. |
| `image-unavailable`     | Portable image bytes can't be obtained: print finds an authored image with no adapter or bad bytes; a paste or drop imports an image the adapter refused, and a placeholder is inserted instead; or a cut is refused because a selected image can't be copied.                                                                                                                                                                                                                                                                                                                                                                                         | Rejected by `printableSnapshot()`; `events.error`.                                                                   | Yes, if the host can supply the bytes later.                                                                          |
| `diagram-unavailable`   | A Mermaid diagram can't be previewed, print can't rasterize one that previewed, or a cut is refused because a selected diagram can't be copied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Rejected by `printableSnapshot()`; `events.error`.                                                                   | Not expected to succeed; the source is kept.                                                                          |
| `file-unavailable`      | A file or wiki link can't be resolved, shown or opened, or a note suggestion request fails: `FileAdapter.resolve` rejects or returns an invalid presentation, a resolved media resource fails to load, or `WikiLinkAdapter.resolve`, `WikiLinkAdapter.open`, `FileAdapter.open` or `FileAdapter.contextMenu` throws.                                                                                                                                                                                                                                                                                                                                   | `events.error`.                                                                                                      | Yes, with the card's Retry button, or once the host can resolve it.                                                   |
| `clipboard-unavailable` | Images or diagrams were copied or cut without an `events.clipboard` handler, or `events.clipboard` threw or rejected. A cut removes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `events.error`.                                                                                                      | Yes, once the host can write the clipboard.                                                                           |
| `internal`              | An unexpected exception inside InkKit. It's a defect, never a designed outcome; the exception is `cause`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Thrown; rejected; `events.error`.                                                                                    | No. Report it, keep the document open, and take a fresh snapshot before trusting the editor's state.                  |

How a failure arrives:

- **Synchronous methods throw.** A thrown `InkKitError` means that the call changed nothing and sent nothing: the document, selection, revision and undo history are as they were before the call, and no `changed` or `commandStateChanged` event was sent for it. The one exception is `internal`, after which the editor's state can't be trusted. When a call succeeds, those events arrive in order just before it returns; an asynchronous method sends the ones it raises after its first pause as they happen. If your handler for one of them makes a call that sends a newer event of the same kind, the older ones still waiting aren't sent. `mount`, `printableSnapshot`, `clipboardSnapshot`, `paste` and `destroy` never throw; they return a promise that rejects. `destroy()` never rejects.
- **A failure goes to the caller and nowhere else.** When the preservation check refuses an edit that a facade call makes, such as `insertText`, `pasteAsPlainText`, `format` or `paste`, the call throws or rejects with `preservation`, and `events.error` isn't called.
- **`events.error` is for failures that no call is waiting for:** edits the person makes (typing, shortcuts, DOM paste, drop and cut), background presentation work (diagram previews and file and wiki-link resolution), DOM copy and cut, and images that a finished paste or drop couldn't import. It always receives an `InkKitError`; [Error sources](#error-sources) lists what it can receive.
- **Results describe partial outcomes.** `false` means that the call didn't apply here. Degraded output describes itself, in `ClipboardOutput.images[].error`, `ClipboardOutput.diagrams[].error` and `PrintableDocument.warnings`, and isn't also reported as an error.
- **An exception from your own event handler stays yours.** When `changed`, `commandStateChanged`, `openLink`, `copy` or `error` throws, InkKit passes the exception to the platform's `reportError()` and carries on, so it never becomes an `InkKitError` and never makes a call throw. A `clipboard` handler that throws or rejects is `clipboard-unavailable`.
- **Checks run in a fixed order.** `destroyed` comes first, then `invalid-argument`, then the document's state: `not-ready`, `stale-document`, `composition`, `operation-pending` and `read-only`. Two cases differ. A text range's `snapshotId` and a heading entry's revision are checked after `operation-pending`, so a stale range during composition throws `composition`. And `reloadDocument` with an expected generation: a stale expectation throws `stale-document` before a new generation that isn't greater throws `invalid-argument`.
- **`null` means omitted** for an optional parameter or option field, because WebKit bridges send JSON `null` for a missing value. For example, `snapshot(null)` reads the current generation, and a keymap entry of `null` keeps that name's default bindings.

Any `InkKitError` except `destroyed` and `internal` leaves the editor usable.

### Error sources

`events.error` receives the following failures. Each is an `InkKitError` with the code shown; when the failure started outside InkKit, the original error is `cause`.

| Source                                                                                                                                                                                                                                             | Code                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| An edit the person makes, such as typing, a shortcut, DOM paste, drop or cut, that the preservation check refuses.                                                                                                                                 | `preservation`                                               |
| A shortcut the person presses whose command fails.                                                                                                                                                                                                 | The failure's code.                                          |
| An image that a finished paste or drop couldn't import. A placeholder is inserted instead.                                                                                                                                                         | `image-unavailable`                                          |
| A DOM paste or drop whose document was replaced while its images were importing. Nothing is inserted.                                                                                                                                              | `stale-document`                                             |
| A Mermaid preview that can't render.                                                                                                                                                                                                               | `diagram-unavailable`                                        |
| A file or wiki link that can't be resolved, previewed or opened.                                                                                                                                                                                   | `file-unavailable`                                           |
| A copy or cut of images or diagrams without an `events.clipboard` handler, or a `clipboard` handler that throws or rejects.                                                                                                                        | `clipboard-unavailable`                                      |
| A copy or cut of images or diagrams that can't be prepared: the document, its revision or the editing mode changed before the copy was ready, an image import is in progress, or the selection can't be serialized. Nothing is written or removed. | `stale-document`, `operation-pending` or `preservation`      |
| A cut of a selected image or diagram that can't be copied.                                                                                                                                                                                         | `image-unavailable` or `diagram-unavailable`                 |
| A cut whose document, revision, editing mode or editability changed before the `clipboard` handler finished.                                                                                                                                       | `stale-document`, or the editor's state, such as `read-only` |
| An unexpected exception in work that no call is waiting for.                                                                                                                                                                                       | `internal`                                                   |

A cut that fails removes nothing. Without an `events.clipboard` handler, copying a selection that holds images or diagrams puts its readable text, and that text as HTML, on the clipboard, and reports `clipboard-unavailable`; with the handler, InkKit writes nothing to the DOM clipboard itself and calls the handler.

## Events

Pass the handlers as the second argument to `mount`. Only `changed` is required. A handler that isn't a function, or a name that isn't in this table, makes `mount` reject with `invalid-argument`. During a facade call, `changed` and `commandStateChanged` wait until the call succeeds and are dropped if it fails; see [Errors](#errors).

| Event                 | Required | When it fires                                                                                                                                                                                  | Receives                                                                                                                   |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `changed`             | Yes      | The document's text changes: an edit, undo, redo, paste, source replacement or typing in source mode. Not for a load, a reload or a refused edit.                                              | A `DocumentSnapshot` of the new text: `documentId`, `generation`, `revision`, `format`, `text` and `dirty`.                |
| `commandStateChanged` | No       | The selection, document, history, editing mode, editability, input preferences, composition or a pending import changes, and once after each load or reload.                                   | The current `CommandState`. Its `caret` holds the active marks and block; this is the only event that reports caret state. |
| `openLink`            | No       | A primary click with Mod on a rendered Markdown link whose address isn't empty; see [Opening links](#opening-links). Without the handler, links don't open.                                    | The link's destination as authored.                                                                                        |
| `copy`                | No       | The Copy button on a code block is clicked. Without the handler, InkKit draws no Copy button.                                                                                                  | The code block's text.                                                                                                     |
| `error`               | No       | A failure that no call is waiting for; see [Error sources](#error-sources).                                                                                                                    | An `InkKitError`.                                                                                                          |
| `clipboard`           | No       | The person copies or cuts a selection that holds an image or a diagram. Return a promise that resolves after the native clipboard write succeeds; a cut removes the selection only after that. | A `ClipboardOutput` of the selection, with the version that the copy started from.                                         |

The `revision` that `changed` receives is the revision of the change it reports, the same revision that a snapshot or other output taken in the handler carries, so work the handler starts with it is current. A change to the document that leaves its saved text as it was advances the revision without sending `changed`.

## Editability and text input

| Member                                                       | Returns   | Purpose                                                                        |
| ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------ |
| `editable`                                                   | `boolean` | The current editing policy. This is a getter.                                  |
| `setEditable(editable: boolean)`                             | `void`    | Changes the policy on the formatted surface and on the source and TXT surface. |
| `setTextInputPreferences(preferences: TextInputPreferences)` | `void`    | Replaces the input preferences on both surfaces.                               |

`TextInputPreferences` has two kinds of fields. Every field is optional. `setTextInputPreferences` replaces the whole set, so a field you omit goes back to its default instead of keeping an earlier override.

`spellcheck`, `autocorrect` and `autocapitalize` set the matching HTML attributes on both editing surfaces. Omitting one removes its attribute, which leaves the behavior to the browser. These are hints; the browser and the operating system decide whether they take effect.

| Field            | Type                                                                  | HTML attribute                  |
| ---------------- | --------------------------------------------------------------------- | ------------------------------- |
| `spellcheck`     | `boolean`                                                             | `spellcheck`                    |
| `autocorrect`    | `boolean`                                                             | `autocorrect`, as `on` or `off` |
| `autocapitalize` | `'off'`, `'none'`, `'on'`, `'sentences'`, `'words'` or `'characters'` | `autocapitalize`                |

Read-only permits selection, copying, find, navigation, folding, loading and reloading, and switching between formatted and source modes. Every method that changes the document throws `read-only`, and so does `undo` and `redo`, which keep their history for when editing returns. Typing, paste, drop, cut completion, task toggles, reference editing and resizing can't change content, and tables show no [table controls](#table-controls).

Entering read-only cancels pending imports and invalidates deferred destructive operations, including an acknowledged Cut, so a late result can't change the editor after editing is enabled again. Active image resize previews are canceled. Imported asset retention and cleanup remain the host adapter's responsibility.

`setEditable` and `setTextInputPreferences` throw `composition` during active text composition, with no partial change. A successful change keeps focus, selection, source, document identity, revision, dirty state and history, because these are presentation changes and not document edits.

### Smart punctuation

`smartPunctuation: boolean` turns typed quotes and dashes into curly quotes and dashes. It is `false` by default. It is InkKit's own behavior, not an HTML attribute, so it doesn't depend on the browser's settings. It applies to typing in formatted mode. You can turn it on at mount or with `setTextInputPreferences`, and a change takes effect on the next key press, with no remount.

The rules change only the character being typed:

| You type                                   | You get                      | When                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"` or `'`                                 | `“` or `‘`, an opening quote | At the start of a block or after a line break, whitespace, an opening bracket (`(`, `[`, `{`, `<`), an en or em dash, or another opening quote.                                                                                                            |
| `"` or `'`                                 | `”` or `’`, a closing quote  | Anywhere else. A `'` between letters is an apostrophe, which is the closing form. A `'` that starts a word, as in `'tis` or `'90s`, opens a quote.                                                                                                         |
| `--`                                       | `–`, an en dash              | After other text in the block, when the first hyphen was typed just before the second. A hyphen already in the note, or typed before the caret moved, stays a hyphen. At the start of a block `--` stays as typed, so that a third hyphen makes a divider. |
| `-` straight after an en dash it just made | `—`, an em dash              | So `---` gives an em dash. On an otherwise empty line `---` is still a divider, and never an em dash.                                                                                                                                                      |

Smart punctuation never rewrites text that is already in the note: straight quotes and hyphens that a note holds stay as they are, on open and on save. The curly character is saved as typed, as UTF-8 text, and reopening the note shows it unchanged.

One Undo straight after a rule, or Backspace, puts back what was typed: `"` or `'` for a quote, `--` for an en dash, and the en dash and a hyphen, `–-`, for an em dash. A second Undo removes the typing as it does without the option. Undo after the caret has moved is the ordinary Undo. Undo and Redo that the browser sends as `historyUndo` and `historyRedo` input events, such as from its Edit menu, take the same path as the Undo key and `undo()`.

The rules don't apply:

- In inline code, including a code span you are still typing (an unmatched backtick outside code earlier in the block), in code blocks, in front matter, in comments and in any block that InkKit holds as literal Markdown.
- In Markdown syntax that you are typing out: a link destination and title after `](`, a web address (`https://`, `www.` or `mailto:`), a wiki link or footnote label that isn't closed yet, an HTML tag or comment that isn't closed yet, a reference definition (`[label]: …`), and `--` in a line that starts with `|`, as a typed table row does.
- In source view and TXT notes, where the text is typed as is. The same goes for `insertText` in those modes.

On a keyboard layout that makes a quote with a dead key, such as US International, the quote reaches the editor as a composition. It follows the rules when the composition commits exactly that one `"` or `'` at the caret, and any other composition is left alone. A dash always comes from the hyphen key and is unaffected. The dead-key quote is tested in Chromium only; other engines and input methods may differ.

Text typed inside the text of a link, a table cell, a heading, a list item, a quote or a callout follows the rules. Typing that arrives in one piece, such as dictation or a text replacement, follows them for its last character, like any other input rule.

## Command availability

`commandState(expectedGeneration?): CommandState` returns what the editor can do now, without dispatching an edit or changing history. Use it to enable toolbar buttons and menu items. It throws `not-ready` before the first load, `stale-document` for a stale expectation and `destroyed` after `destroy()`. Unlike `snapshot`, it works during composition and pending imports, with the affected commands disabled.

`events.commandStateChanged(state)` publishes the same state after the selection, a document change, history, the editing mode, editability, input preferences, composition or a pending import changes, and once after each load or reload. Loading suppresses intermediate states. It is the only event that reports the caret.

Availability describes the moment you ask. It doesn't promise that a later call succeeds: recheck the generation and handle the result and errors when the person acts. Querying availability never dirties the document.

`CommandState` has these fields:

| Field                                  | Type                                       | Meaning                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentId`, `generation`, `revision` | `DocumentVersion`                          | The document this state describes.                                                                                                                                                                                                      |
| `format`                               | `'md'` or `'txt'`                          | The document format.                                                                                                                                                                                                                    |
| `mode`                                 | `EditingMode`                              | `formatted` or `source`. TXT is always `source`.                                                                                                                                                                                        |
| `editable`                             | `boolean`                                  | The editing policy.                                                                                                                                                                                                                     |
| `composing`                            | `boolean`                                  | Text composition (IME) is in progress.                                                                                                                                                                                                  |
| `pending`                              | `boolean`                                  | An image import is running.                                                                                                                                                                                                             |
| `caret`                                | `CaretState`                               | The formatting at the selection.                                                                                                                                                                                                        |
| `table`                                | `{ row, column, rows, columns }`, optional | Present only when the selection is in a table in formatted mode. `row` and `column` locate the selected cell, or the top-left cell of a cell selection. `rows` and `columns` count the whole table, and `rows` includes the header row. |
| `commands`                             | An object of booleans                      | What each command can do now. See the following table.                                                                                                                                                                                  |

`CaretState` describes the selection in formatted mode. In source and TXT modes it is always `{ marks: [], block: { type: 'paragraph' }, quoted: false }`.

| Field    | Type      | Meaning                                                                                                                                                                                                                                                                                                                                                              |
| -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marks`  | `Mark[]`  | The active marks, each one of `bold`, `italic`, `strikethrough`, `highlight`, `code` or `link`. At a caret these are the marks the next typed text takes, including ones you toggled. For a range, every mark found anywhere in it.                                                                                                                                  |
| `block`  | `Block`   | The innermost heading, code block or list item that holds the start of the selection: `{ type: 'heading', level }` with `level` from 1 to 6, `{ type: 'codeBlock' }`, `{ type: 'bulletList' }`, `{ type: 'orderedList' }` or `{ type: 'taskList' }`. When there is none, as in a paragraph, a table cell or a callout outside a list, it is `{ type: 'paragraph' }`. |
| `quoted` | `boolean` | One block quote holds the whole selection. The `block` is what sits inside the quote. Callouts don't count.                                                                                                                                                                                                                                                          |

`commands` has these entries. Every entry is `false` while the editor is read-only, composing or has an image import pending.

| Entry                                                            | `true` when                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `undo`, `redo`                                                   | There is a step to undo or redo. In source mode this includes steps taken on the text.                                                                                                         |
| `insertText`, `paste`, `replace`, `replaceSource`, `insertPaths` | The editor can change. `paste` also covers `pasteAsPlainText`, and `replace` also covers `replaceAll`. They are `true` in source and TXT modes.                                                |
| `insertImages`                                                   | The editor can change, the mode is formatted, and `images` or `files` is set.                                                                                                                  |
| `insertFootnote`                                                 | The editor can change and the mode is formatted.                                                                                                                                               |
| `editReferenceDefinition`                                        | The editor can change, the mode is formatted, and the document has at least one reference definition.                                                                                          |
| `format`                                                         | An object with one entry for each `FormatCommand`, by the names `format` takes. An entry is `true` when the command applies to the current selection. All are `false` in source and TXT modes. |
| `table`                                                          | An object with one entry for each `TableCommand`. An entry is `true` when the command applies to the current selection. All are `false` in source and TXT modes.                               |
| `moveBlockUp`, `moveBlockDown`                                   | `moveBlock('up')` or `moveBlock('down')` would move the blocks at the selection. Both are `false` in source and TXT modes and in a table.                                                      |

## Formatting and keys

| Member                                           | Returns   | Purpose                                                      |
| ------------------------------------------------ | --------- | ------------------------------------------------------------ |
| `format(command, options?, expectedGeneration?)` | `boolean` | Applies a formatting command to the selection.               |
| `insertText(text, expectedGeneration)`           | `boolean` | Inserts text that the host's native input produced.          |
| `moveBlock(direction, expectedGeneration?)`      | `boolean` | Moves the blocks at the selection up or down.                |
| `keyDown(input: KeyInput, expectedGeneration)`   | `boolean` | Runs a key press that the host's native input received.      |
| `focus(expectedGeneration?)`                     | `void`    | Puts focus in the editing surface for the current mode.      |
| `blur(expectedGeneration?)`                      | `void`    | Takes focus off InkKit's text surfaces.                      |
| `setKeymap(bindings: Keymap)`                    | `void`    | Replaces the shortcut bindings. See [Shortcuts](#shortcuts). |

`format(command, options?, expectedGeneration?)` applies one `FormatCommand` to the selection in formatted mode and returns whether the document, or the marks the next typed text takes, changed. It returns `false` in source and TXT modes and when the command has nothing to change. In formatted mode, `format` focuses the editor.

| Command                                                | Effect                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heading1` to `heading6`                               | Makes the block a heading of that level. Applying the block's current level makes it a paragraph again.                                                  |
| `paragraph`                                            | Makes the block a paragraph.                                                                                                                             |
| `bold`, `italic`, `strikethrough`, `highlight`, `code` | Toggles the mark on the selection. At a caret, applies to typed text until toggled off or the caret moves; `code` inside a code span removes the span.   |
| `codeBlock`                                            | Makes the block a code block, with the info string `options.language` when given, or makes a code block a paragraph again.                               |
| `quote`                                                | Quotes the selected blocks, or the whole list when the selection is in a list item, or removes the quote that holds them.                                |
| `bulletList`, `orderedList`                            | Makes the blocks a list of that kind, converts a list of the other kind, or lifts the item out of a list of the same kind.                               |
| `taskList`                                             | Makes the selected list items tasks, making the blocks a bullet list first when they aren't in one, or makes them ordinary items when they're all tasks. |
| `link`                                                 | With `options.destination`, sets the link. Without it, removes the link. See the following list.                                                         |

`FormatOptions` has two optional fields: `destination`, only with `link`, and `language`, only with `codeBlock`. Any other option, or an option with another command, throws `invalid-argument`, as does an unknown command.

A link destination, in `format('link', { destination })` and in `editReferenceDefinition`, must be one that the editor would open and can save. It throws `invalid-argument` when it's empty or only spaces; when it isn't relative, a fragment, a query, or an `http`, `https`, `mailto` or `tel` address, the same list that [opening links](#opening-links) uses; when it contains a control character, such as a line break; or when Markdown can't write it so that it reads back the same. Other destinations save and reopen as given, in an inline link and in a reference definition alike: one with spaces is written in angle brackets, and characters such as `<`, `(` and `&` are escaped.

`link` works on the link that holds the caret, including a caret just before its first character, or that holds the whole selection:

- **With a destination,** an inline link keeps its text and title and takes the new destination. An autolink given a new destination becomes an inline link with the same text. In a reference link, the shared definition is edited instead, as `editReferenceDefinition` does, so every link that uses that definition changes. A selection that isn't inside one link becomes a link to the destination, replacing the links in the selected text; at a caret outside a link, the text typed next is linked. Giving a link the destination it already has returns `false` and changes nothing, so an autolink keeps its form.
- **Without a destination,** the whole link is removed and its text stays. A selection that isn't inside one link removes the links from the selected text; the part of a link outside the selection stays a link. If there is no link to remove, `format` returns `false` and changes nothing.

At a caret, marks toggled for the text typed next, such as `bold`, stay toggled after the link changes.

### Moving blocks

`moveBlock(direction: BlockMoveDirection, expectedGeneration?): boolean` moves the blocks at the selection one place up (`'up'`) or down (`'down'`) within their container, as one undo step, and returns whether they moved. The `moveBlockUp` and `moveBlockDown` [shortcuts](#shortcuts) run it, on Option-Up and Option-Down by default.

- **What moves:** the block that holds the caret, or every block that the selection touches. In a list, that's the list item, with any sublist it holds; in a sublist, it's the sublist's item. In a quote, callout or footnote, it's a block inside it. A callout's title line isn't a block, so blocks stay below it.
- **Where it stops:** blocks move only among the blocks of their own list, quote, callout, footnote or note. At the first or last place, nothing happens and the call returns `false`. Front matter stays first. While comments are hidden, a move goes past a block comment and the block after it, so that the move shows.
- **Selection:** the caret or selection keeps its place in the moved text.
- **Source:** moved blocks, and the blocks they pass, keep their authored Markdown where it reads the same in their new place, including list markers, indentation, line endings and spaces at line ends. In an ordered list, each place keeps the number written there, so a moved item takes the number of its new place, and its lines indented to its content follow a number of a different width. Where a block's authored Markdown would read differently in its new place, such as indented code moved under a list or an item whose indentation would nest it in its new neighbor, the moved blocks are written as other edits write them, which can change their spelling and indentation. A list that comes to sit beside another list of its kind takes a marker that the other list doesn't use, as with any edit; see [preservation](preservation.md). A move that can't be saved and reopened as the same document throws `preservation` and changes nothing.
- **Returns `false`,** and changes nothing, in source and TXT modes and in a table, where the [table commands](#tables) move rows. An unknown direction throws `invalid-argument`.

### Native input

When the host's native layer receives typed text or a key before the web view does, it can pass them to InkKit with two methods. Both require the expected generation, so that input meant for a document that has since been replaced fails instead of landing in the new one.

`insertText(text, expectedGeneration)` inserts exactly the text it's given and changes nothing outside it. It returns `false`, and inserts nothing, while text composition is in progress. In formatted mode, Markdown input rules apply at most as if the last character had been typed after the rest: `**x**` becomes strong `x`, and `*x* ` stays literal because its last character is a space. Backspace straight afterwards undoes the rule, as it does after typing. Text the browser inserts in one piece, such as dictation or a text replacement, follows the same rule. In formatted mode, the insertion is one history step. Multiline text is inserted as ordinary text with semantic line breaks, normalizing CRLF and CR to LF; in a code block the lines stay literal. Source and TXT modes insert the text literally.

A formatted insertion checks that the document can still be saved before it dispatches. Table-cell newlines use `<br />`. Any insertion that can't reopen under the supported dialect throws `preservation` and leaves the source, revision, selection and history as they were.

In formatted mode, Shift+Enter inserts a line break as a separate undo step. A trailing break in a paragraph or setext heading remains in the live editor and history, but `snapshot()` omits it until content follows. Saving, autosaving or reopening that snapshot retains the completed text without the pending empty line. Breaks in table cells and ATX headings save as `<br />`. A break directly before an inline HTML comment also saves as `<br />`. Shift+Enter inside a literal Markdown block does nothing and leaves its source and history unchanged. `insertText`, `pasteAsPlainText` and text replacement use the same saved forms. Selection Markdown also omits pending trailing breaks. See [line-break preservation](preservation.md) for the saved forms.

`keyDown(input, expectedGeneration)` passes a key that the host's native input received to InkKit, as if it were pressed in the editor. It returns `true` when InkKit handled the key, and then the host must not also handle it natively; `false` means the host's native handling applies.

| `KeyInput` field                           | Type      | Meaning                                                                      |
| ------------------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `key`                                      | `string`  | Required. The `KeyboardEvent.key` value, such as `Enter` or `b`.             |
| `code`                                     | `string`  | The `KeyboardEvent.code` value, such as `KeyB`. Defaults to an empty string. |
| `metaKey`, `ctrlKey`, `altKey`, `shiftKey` | `boolean` | Whether the modifier is held. An omitted or `null` modifier isn't held.      |

During composition with the current generation, `keyDown` returns `false`. Otherwise InkKit handles:

- The bindings from `setKeymap`, including history, block move and table bindings, in every mode where they apply. A bound key is handled even when its command isn't available now, except a table binding, which passes the key on, and a block move binding in a table cell, which does too.
- **Alt+Enter** and **Alt+Shift+Enter** in formatted mode, which move between a footnote reference and its definition, as `navigateFootnote` does. They work in a read-only editor.
- In formatted mode, every other key reaches the editor's own key handling, such as Enter, Tab and Backspace in lists and tables.
- In source and TXT modes, Enter, Tab, Backspace and Delete edit the text when no Command, Control or Alt key is held. Other keys return `false`.
- When the editor is read-only, a bound key throws `read-only`, and so do Enter, Tab, Backspace and Delete. The exception is formatted mode, where Tab and Shift+Tab with no Command, Control or Alt key move between table cells, and return `false` outside a table. A key bound to a block move also returns `false`, even when a table name shares it, so the host's native caret movement applies.

`focus(expectedGeneration?)` puts focus in the formatted editor or the source and TXT textarea, whichever is showing. `blur(expectedGeneration?)` moves focus off InkKit's text surfaces and leaves focus anywhere else, such as in a host control or a button InkKit draws, where it is; use it instead of finding InkKit's elements yourself. Neither checks composition, read-only or pending imports. Both throw `not-ready` before the first load.

## Native readable text and layout

These members let a host build its own search, accessibility or overlay UI over the editor's text. The host owns the search field, the match list and any header.

| Member                                  | Returns                            | Purpose                                                                               |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `textSnapshot(expectedGeneration?)`     | `ReadableTextSnapshot`             | Returns the readable text, the selection and a `snapshotId` that names them.          |
| `selectTextRange(range, options?)`      | `void`                             | Selects a range.                                                                      |
| `revealTextRange(range)`                | `void`                             | Scrolls a range into the visible viewport.                                            |
| `replaceTextRange(range, text)`         | `boolean`                          | Replaces a range with literal text. Returns whether the text changed.                 |
| `textRangesRects(ranges)`               | `readonly (readonly TextRect[])[]` | Measures a batch of ranges. Returns one array of rectangles for each range, in order. |
| `visibleTextRanges(snapshotId)`         | `readonly TextRange[]`             | Returns the ranges that are inside the viewport now.                                  |
| `setViewport(options: ViewportOptions)` | `void`                             | Names the scroll container and the overlapping chrome.                                |
| `viewport()`                            | `ViewportSnapshot`                 | Returns the visible rectangle, the insets and the scroll offsets.                     |

`textSnapshot` returns an immutable `ReadableTextSnapshot`: the fields of `DocumentVersion`, plus these:

| Field        | Type                        | Meaning                                        |
| ------------ | --------------------------- | ---------------------------------------------- |
| `snapshotId` | `string`                    | An opaque name for this text. Ranges carry it. |
| `format`     | `'md'` or `'txt'`           | The document format.                           |
| `mode`       | `'source'` or `'formatted'` | The editing mode when the snapshot was taken.  |
| `text`       | `string`                    | The readable text.                             |
| `selection`  | `TextRange`                 | The current selection as a range in `text`.    |

A `TextRange` is `{ snapshotId, from, to }`. `from` and `to` are zero-based, half-open UTF-16 offsets in the `text` of the snapshot that `snapshotId` names. They are not raw Markdown offsets or ProseMirror positions.

Source and TXT expose the textarea's displayed text, with CRLF normalized to LF. The ordinary `snapshot()` still contains the exact authored source. Formatted snapshots join textblocks and hard breaks with LF. Readable image alt text, footnote labels and callout titles are protected content; author comments and reference-definition metadata are excluded. Footnote definition bodies remain readable text. Empty image alt text reads as `Image`, and callout labels use their title or kind. Folded bodies remain in the logical text, while hidden content has no current rectangles.

`selectTextRange(range, options?)` takes these options. Both default to `false`, so a selection from a host search field doesn't take focus or scroll away from it.

| Option   | Type      | Meaning                                                 |
| -------- | --------- | ------------------------------------------------------- |
| `focus`  | `boolean` | Puts focus in the editing surface.                      |
| `reveal` | `boolean` | Scrolls the range into view, as `revealTextRange` does. |

A complete protected image or footnote label selects its atomic node. A complete callout title selects the callout block, so the effective selection includes its body. A partial protected label throws `invalid-range`. `revealTextRange` can unfold a folded callout that holds the range and scrolls to it. `replaceTextRange` is literal, keeps the surrounding structure and inline marks, and forms one undo step. It works in any single text block, including a list or task item, a quote, a callout, a table cell and a footnote definition. It throws `invalid-range` when the range crosses an embed, an existing hard break, a hidden comment or a block boundary; use source mode to change source syntax. Selecting and revealing work in a read-only editor. Replacing does not.

An offset that splits a surrogate pair throws `invalid-range`. A range whose `snapshotId` is no longer current throws `stale-document`. Loads, reloads, revisions and mode changes make old snapshot IDs stale, including a reload of identical text and a mode round trip. IDs are local to one editor. Caret changes, scrolling, insets and resizing don't make a snapshot stale. Capture a new snapshot after an edit or a stale-range error. The members above also throw during composition or a pending import, before a document is ready and after destruction.

`textRangesRects(ranges)` measures only when you call it. It validates the whole batch before it measures, returns frozen rectangle arrays, keeps no layout cache, and returns an empty array for an empty batch. Use it for native character geometry instead of querying each character on its own. `visibleTextRanges(snapshotId)` returns the logical ranges that are in the viewport now.

A `TextRect` has `left`, `top`, `right`, `bottom`, `width` and `height`, in CSS pixels in the web view's client coordinate space. That is the origin that DOM pointer and drop coordinates use. The values are not device pixels and not relative to the mounted root. Translate them at your native bridge.

`setViewport(options)` replaces the viewport settings. Both fields are optional:

| Field             | Type                      | Default           | Meaning                                                                                                                                    |
| ----------------- | ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `scrollContainer` | `HTMLElement`             | The mounted root  | The element that scrolls. It must be the root or an ancestor of the root, or the call throws `invalid-argument`.                           |
| `insets`          | `Partial<ViewportInsets>` | `0` on every edge | The part of the container's visible area that host chrome covers: `top`, `right`, `bottom` and `left`, as non-negative, finite CSS pixels. |

`viewport()` returns a `ViewportSnapshot`: `rect`, a `TextRect` for the visible area inside the container, root and window, less the insets; `insets`, the `ViewportInsets` in effect; and `scrollTop` and `scrollLeft`, the combined scroll offsets of the container and, in source and TXT modes, the textarea. Reveal, find and heading navigation all use this viewport.

Loading takes focus off the editor's text surfaces and doesn't reveal a saved caret. It leaves other host controls focused. Call `focus()` after loading only when editing should start immediately. A reload keeps a valid selection, focus and scroll position, so it doesn't make a browsing host jump. Explicit focus and navigation can reveal the caret.

## Footnotes and reference links

| Member                                                                     | Returns   | Purpose                                                                         |
| -------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `insertFootnote(label?, expectedGeneration?)`                              | `boolean` | Inserts a footnote reference and, if needed, its definition.                    |
| `navigateFootnote(target, expectedGeneration?)`                            | `boolean` | Moves between a footnote reference and its definition.                          |
| `editReferenceDefinition(label, destination, title?, expectedGeneration?)` | `boolean` | Changes the destination, and optionally the title, of a shared link definition. |

`insertFootnote` puts a reference after the current selection without removing selected text. An omitted `label` uses the lowest positive integer that no footnote uses. A label is 1 to 999 characters with no whitespace, brackets or backslashes; any other label throws `invalid-argument`. A new definition is appended at the end of the document and focused for editing. If the label already has a definition, the call inserts another reference to it. The reference and the definition form one undo step. The call returns `false` in TXT and in Markdown source mode.

`navigateFootnote('definition' | 'reference')` moves the caret to the definition, or to the first reference, of the footnote that holds the caret or sits next to it. It returns whether it found a destination. **Alt+Enter** goes to the definition and **Alt+Shift+Enter** to the reference. It works in a read-only editor and returns `false` in TXT and source mode.

`editReferenceDefinition` updates the definition of `label`, which matches without regard to case or runs of whitespace. `destination` follows the rules for [link destinations](#formatting-and-keys). It returns `true` when the definition now has that destination, and `false` when no definition has the label, and in TXT and Markdown source mode. An omitted `title` keeps the current title; a non-empty `title` replaces it and is written on one line. An empty `title` throws `preservation`. If the edited Markdown can't be saved and reopened with the new destination, the call throws `preservation` and changes nothing. A destination that needs them, such as one with a space, is written in angle brackets. `format('link', { destination })` edits the shared definition when the caret or selection is in a reference link.

## Highlights, callouts and comments

`format('highlight')` toggles the highlight mark, and `CaretState.marks` reports `highlight`. Bind the `highlight` shortcut name through `setKeymap`. Highlighting is off in TXT and Markdown source modes.

Supported callouts render editable bodies, plain titles and optional fold buttons. Enter and Space toggle the focused fold button. Folding keeps the authored source and doesn't dirty the document. See the [syntax matrix](supported-syntax.md) for the bounded types and variants.

`setCommentsVisible(visible: boolean): void` reveals or hides author comments. Comments start hidden. This changes presentation without changing the revision, history or dirty state. While comments are hidden, an edit made from a caret never removes a hidden comment: an edit that would is refused with a `preservation` error. The caret rests inside a hidden comment only in a note with no visible text, and text written there goes into a new paragraph after the comment. A selection that is deleted or replaced removes the hidden comments inside it. Table commands that remove a row, column or table remove the comments in it. [Supported syntax](supported-syntax.md#comments) describes the editing rules. Snapshots and `ClipboardOutput.markdown` keep comments. Ordinary text, HTML, inert clipboard metadata and printing leave them out even when they are revealed. A selection inside a comment copies its selected body with the comment delimiters only as explicit Markdown. Copying and cutting comments within the same loaded editor retains them when the clipboard text and HTML return unchanged. The HTML carries an opaque token; the private source stays in that editor. Loading or replacing the document, destroying the editor, or copying another selection clears that association. Other editors and applications receive the ordinary comment-free text and HTML. Explicit Markdown and plain-text paste keep their existing meanings.

## Images

The optional `ImageAdapter` stores, shows and exports images that the host owns. InkKit keeps references opaque: it never infers a storage path, fetches from the network or exports a private display URL.

| Member                                       | Returns                          | Purpose                                                                                     |
| -------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `presentation(reference: string)`            | `{ url: string }` or `undefined` | Returns the display URL for a reference. Return `undefined` when the image is unavailable.  |
| `importImage(input: CapturedImage, context)` | `Promise<{ reference: string }>` | Stores captured bytes and returns the reference to write into the Markdown.                 |
| `exportImage(reference: string, context)`    | `Promise<PortableImage>`         | Returns the bytes and MIME type of a stored image, for portable clipboard and print output. |

| Type            | Fields                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CapturedImage` | `bytes: Uint8Array` and `mimeType: string`, required. `filename?: string`. `source?: string`, the `src` of the HTML image that the bytes belong to, when there is one. |
| `PortableImage` | `bytes: Uint8Array`, `mimeType: string` and `filename?: string`.                                                                                                       |

Every adapter call receives a `DocumentContext`: `documentId`, `generation` and `operationId`. The operation ID is an opaque string that is different for each adapter call from one editor. Validate the context in native callbacks. Alt text, titles and the `alt|width` convention are editor metadata. The adapter owns storage, access control and networking. InkKit contains no Marfa types or storage-path assumptions.

Keep imported bytes available while the captured operation is pending and after insertion, including before the host saves its document. Retention and orphan cleanup belong to the host; a sweep based only on saved Markdown can miss an in-flight import or an unsaved edit. Reject stale callbacks without inserting their references into a replacement document.

A paragraph that holds only one image behaves as its own block. Text can't be placed on its line: typing, Enter, paste or composition beside it writes a new paragraph before or after it, and typing, Enter or composition with it selected writes one after it. Paste with the image selected replaces it. Arrow keys select the image on the way past it, and Backspace or Delete next to it selects it before deleting it. A click beside the image puts the caret after it. An image that shares its paragraph with text, is linked, emphasized, strong, struck through or highlighted, or sits in a table cell or at the start of a list item, stays inline in its paragraph; with a file adapter, its card displays on its own line. Each form keeps its authored Markdown.

Images and diagrams reach a native clipboard through `events.clipboard`; see [Clipboard](#clipboard). Encode byte arrays explicitly when you cross a WebKit JSON bridge.

### Inserting images

`insertImages(images: ImageInsertion[], at?: ClientPoint, expectedGeneration?): boolean` puts the images where the selection is, or at the drop point `at`. It never splits a block that can't be split or discards a selection it can't replace. As with any formatted edit, a result that can't be preserved is refused, and the call throws `preservation`.

| `ImageInsertion` field | Type     | Meaning                                                                                               |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `reference`            | `string` | What the host's adapter stored the image under. InkKit writes it as the image's Markdown destination. |
| `alt`                  | `string` | The alt text.                                                                                         |
| `title`                | `string` | Optional. The image title.                                                                            |

`ClientPoint` is `{ clientX: number, clientY: number }`: the position of the drop in CSS pixels of the web view's client area, the same coordinates as DOM pointer events. Both values must be finite numbers.

The reference is written as the image's Markdown destination, so it's read like a URL. With a file adapter, everything after the first `#` is the fragment, not part of `FileReference.target`. Write a `#` that belongs to a file name as `%23`, such as `Scans/My%23Notes.png`; InkKit doesn't decode it.

- **Paragraph, heading, list item, quote, callout or footnote:** inserts one image block per image, replacing a selection and splitting the paragraph around a caret. The caret ends after the last image.
- **Table cell:** a cell holds one line and no blocks, so the images go inline in the cell, in order and on one line, replacing a selection inside the cell. Alt text and titles are collapsed to one line. The images sit next to each other with no space between them. The caret ends after the last image, the rest of the table keeps its authored spelling, and one undo removes all the images.
- **Code, comments and other source kept as written:** a code block, Mermaid diagram, author comment, front matter, or an unsupported literal block such as a paragraph or table that contains inline HTML, can't hold an image. The images go after the block where the selection ends, inside its list item or quote when it sits in one, and the block and the selection are left as they are. A selection that spans table cells, selects cells, or runs from outside a table into a cell puts the images after the table, and no cell changes; one that runs from a cell out of the table puts them after the block where it ends.
- **Drop point:** with `at`, images are always placed as blocks, after the top-level block at that point or in place of an empty paragraph at or beside it, the same placement as dropped HTML, so a point over a table puts them below the table. The selection isn't checked.

Inserting images needs an image adapter or a file adapter, because either one shows and exports the inserted reference. `insertImages` returns `true` when it inserted the images. It returns `false`, and changes nothing, for an empty list, in source or TXT mode, or with neither adapter. `commandState().commands.insertImages` is `false` in the same cases, and whenever the editor can't change: read-only, composing or with an import pending.

### Inserting file paths

`insertPaths(paths: string[], at: ClientPoint, expectedGeneration?): boolean` inserts dropped file paths as literal text. In formatted mode, each path becomes its own paragraph at the drop point `at`: in place of an empty block, or after the top-level block at that point, so a list or quote isn't opened up. In source and TXT modes, `at` is ignored and the paths go at the selection, separated by blank lines. It returns `false`, and changes nothing, only for an empty list.

## Tables

`table(command: TableCommand, options?: TableOptions, expectedGeneration?): boolean` runs one table command in formatted mode and returns whether it applied. It returns `false`, and changes nothing, in source and TXT modes, when the selection isn't in a table (for commands that need one), and at a boundary a move can't cross.

| Command                                                            | Effect                                                                                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insert`                                                           | Inserts an empty table at the selection. `options.rows` and `options.columns` set the size. A mid-paragraph caret splits the paragraph around the table. |
| `addRowBefore`, `addRowAfter`, `addColumnBefore`, `addColumnAfter` | Adds an empty row or column next to the one that holds the selection.                                                                                    |
| `deleteRow`, `deleteColumn`, `deleteTable`                         | Removes the selected rows or columns, or the whole table, with any hidden author comments in them.                                                       |
| `alignLeft`, `alignCenter`, `alignRight`                           | Aligns the whole column of the selected cell.                                                                                                            |
| `moveRowUp`, `moveRowDown`, `moveColumnLeft`, `moveColumnRight`    | Moves the selected rows or columns one position. See the following text.                                                                                 |
| `sortRows`                                                         | Sorts the body rows. See the following text.                                                                                                             |
| `exit`                                                             | Adds an empty paragraph after the table and puts the caret in it.                                                                                        |

`TableOptions` fields belong to one command each. An option with another command, an unknown option, or a value outside its range throws `invalid-argument`.

| Option       | Command    | Type                            | Default                     | Range and meaning                                                                                         |
| ------------ | ---------- | ------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `rows`       | `insert`   | integer                         | `3`                         | 1 to 100, counting the header row. The default gives a header and two body rows.                          |
| `columns`    | `insert`   | integer                         | `2`                         | 1 to 100.                                                                                                 |
| `column`     | `sortRows` | integer                         | The column of the selection | Zero-based. When the selection is in a table, a column that isn't in the table throws `invalid-argument`. |
| `order`      | `sortRows` | `'ascending'` or `'descending'` | `'ascending'`               | The sort direction.                                                                                       |
| `comparison` | `sortRows` | `'text'` or `'number'`          | `'text'`                    | How to compare cells.                                                                                     |

`table('moveRowUp' | 'moveRowDown' | 'moveColumnLeft' | 'moveColumnRight')` moves the selected contiguous rows or columns one position. A caret chooses its cell's row or column. The header remains the first row and can't be moved into the body; moving a column includes its header and alignment. Selection follows the moved cells. Boundary movements return `false`. Complete cell nodes, including formatting, references, comments and images, travel together. Unsupported literal tables aren't reordered.

`table('sortRows', { column?, order?, comparison? })` sorts all body rows. The `text` comparison is case-sensitive UTF-16 code-unit comparison of the complete readable clipboard text of each cell, including surrounding whitespace. Author comments are excluded, images contribute their alt text, and footnote references contribute `[label]`. The `number` comparison trims surrounding whitespace and accepts finite decimal numbers, including signs, fractions and exponents; when the column holds any other nonblank value, the call returns `false` without changing the table. Empty and whitespace-only cells always come last, and equal keys keep their authored order. The header and the column alignments stay fixed. The selection follows the original top-left row and keeps the selected columns within that row.

Ordinary paste accepts rectangular tab-separated spreadsheet text and supported simple HTML tables. Inside a table it begins at the selection's top-left cell, replaces the selected rectangle and clears selected cells that the incoming rectangle doesn't cover. It grows the table to the right and bottom as needed. Outside a table it inserts a new table that uses the first incoming row as the header. Explicit Markdown, plain-text paste and image imports keep their existing paths. Each movement, sort and spreadsheet paste is one isolated undo operation. See [supported syntax](supported-syntax.md) for input limits and safe fallback.

### Table controls

In formatted mode, an editable table shows a control above its active column and one beside its active row. The active cell is the one under the pointer or, when the pointer isn't over the table, the one that holds the selection. Each control is a button named by the `tableMoveColumn` or `tableMoveRow` [label](#labels):

- Activating a control highlights its column or row and opens a menu. A column's menu holds `tableAlignLeft`, `tableAlignCenter`, `tableAlignRight`, `tableAddColumn`, which adds a column after it, and `tableDeleteColumn`. A row's menu holds `tableAddRow`, which adds a row after it, and `tableDeleteRow`, which the header row doesn't offer.
- Dragging a control moves its column or row. When a control has focus, Left Arrow and Right Arrow move the column, and Up Arrow and Down Arrow move the row. The header row stays first.
- Opening a menu moves focus to its control. Escape closes the menu and returns focus to the text.

The controls never select a row or column: each operation runs from a caret in the line's cell. When focus returns to the text, after an operation, Escape or a drag, the caret is in the cell it came from, or in the new row or column after an addition. Undo and redo restore a caret too, so the next key types into one cell.

Each operation is the matching `table()` command, or the same movement for a drag, and runs with the same guards, source guarantees and single undo step. A refused operation changes nothing and is reported to `events.error`. While only the selection chooses the cell, the controls stay transparent until one has keyboard focus, so typing in a table doesn't show them; on a device without hover, they stay visible. Focus navigation reaches them after the text: Option-Tab in Safari reaches the controls for the caret's cell. In Chromium, Tab moves between cells and leaves a table only from its last cell, so it reaches only the controls for the last row and column. From any cell, the keyboard route is the table shortcuts a host binds through the [keymap](#shortcuts), such as `tableAddRowAfter`, `tableDeleteColumn` and `tableMoveRowUp`, which act on the caret's row and column. Read-only editors, copied HTML and print show no controls.

## Source editing and history

| Member                                                   | Returns       | Purpose                                                        |
| -------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| `editingMode`                                            | `EditingMode` | `'formatted'` or `'source'`. This is a getter.                 |
| `setEditingMode(mode: EditingMode, expectedGeneration?)` | `boolean`     | Switches between formatted and source editing.                 |
| `replaceSource(text: string, expectedGeneration?)`       | `boolean`     | Replaces the complete current source as one undo step.         |
| `undo(expectedGeneration?)`, `redo(expectedGeneration?)` | `boolean`     | Steps through history. Each returns whether it applied a step. |

Markdown loads in formatted mode, and TXT is always literal source. `setEditingMode` switches the current Markdown document without changing its identity, generation, revision or dirty state. Leaving source mode takes the source edited there into the formatted document; the text that follows describes what that does to history. It returns `false` when the mode is already set, and for TXT. The host owns the mode control. Switching modes maps the selection to the corresponding text and reveals it when the editor has focus. Positions inside Markdown syntax that has no formatted text map to the nearest visible text. When the editor does not have focus, switching retains the relative reading position.

`replaceSource` replaces the complete current source as one isolated undo operation and returns `false` for identical source. It accepts unsupported syntax, incomplete Markdown and TXT literally. Snapshots keep the actual complete source, including Markdown spelling changes that render identically. Source input keeps unchanged line endings and uses the document's existing line ending for inserted lines. Switching to formatted editing doesn't save or canonicalize the source. When the current formatted document can't be preserved, `replaceSource` and switching to source mode throw `preservation`, as `snapshot()` does, and change nothing.

`undo` and `redo` use the formatted document's history, except for source edits made in source mode that the formatted document hasn't taken in yet, which they step through on the text. Each returns whether it applied a history operation. Revisions advance for actual edits and history operations. Dirty state compares the exact current source with the loaded source. Loading another document resets history. In formatted mode, Undo and Redo that the browser sends as `historyUndo` and `historyRedo` input events, such as from its Edit menu, call `undo` and `redo`, with or without smart punctuation.

Source edits don't parse the document. Typing, paste, cut, replacement, `replaceSource` and any other change made while in source mode take effect on the text at once: `snapshot()`, the `changed` event, the revision and the textarea all use it. Each is an undo step on the text: a pause of more than 500 ms in typing ends a step, and an edit that isn't typing is a step of its own that later typing doesn't join. The last 100 steps are kept. `clipboardSnapshot()` and `printableSnapshot()` read the text and leave history alone.

The formatted document takes the source in when you leave source mode, which costs as much as loading the document. All the source steps then become one step of the formatted history: after switching to formatted mode, `undo()` reverts everything edited in source mode since it was entered (or since the last switch), not one step at a time. Redo doesn't survive leaving source mode either: steps undone in source mode are dropped on the switch, because taking the source in commits a new formatted step.

Source-mode typing and paste edit source literally; an explicitly supplied clipboard `markdown` takes precedence over plain text. A source selection exports its exact selected substring as `ClipboardOutput.markdown`, without unselected definitions. Ordinary text and HTML interpret that selection as a standalone Markdown fragment: complete constructs are semantic, while incomplete and unsupported constructs remain literal. Intersections with complete author comments in the whole document are excluded even when only a comment body is selected. Code and TXT stay literal.

## Find and replacement

| Member                                                 | Returns   | Purpose                                                                      |
| ------------------------------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `find(text: string, expectedGeneration?)`              | `boolean` | Selects the next match, wrapping at the end. Returns whether it found one.   |
| `replace(search, replacement, expectedGeneration?)`    | `boolean` | Replaces the selected match, or the next one, and selects the inserted text. |
| `replaceAll(search, replacement, expectedGeneration?)` | `number`  | Replaces every non-overlapping match, once, and returns how many.            |

`find` works in a read-only editor. `replace` and `replaceAll` need an editor that can change. An empty search finds nothing and creates no history entry, and neither does a replacement that equals the match.

Search is literal and case-insensitive, using JavaScript Unicode matching. No regular expressions, Unicode normalization or replacement macros are interpreted; `$&`, `$1` and backslashes stay replacement text. Source and TXT search their full literal text, including line endings and syntax. Formatted matching searches editable text, code and preserved literal content within a single text segment, including author-comment bodies. It doesn't cross non-text nodes or structural boundaries, or search link destinations, reference identifiers and other attributes. Use source editing to search that source syntax.

Formatted replacements keep the surrounding structure and formatting; replacement text inherits the first matched text's formatting when a match spans differently formatted text. Newlines become hard breaks in ordinary formatted content, written as `<br />` in table cells and ATX headings, and stay literal in code, source and TXT. A replacement that can't be rebuilt throws `preservation` before it changes anything. Each replace or replace-all is one isolated undo operation. Selection-only find and navigation don't change the revision or dirty state.

## Headings and navigation

| Member                              | Returns              | Purpose                                          |
| ----------------------------------- | -------------------- | ------------------------------------------------ |
| `headings(expectedGeneration?)`     | `readonly Heading[]` | Returns the outline, in document order.          |
| `navigateHeading(heading: Heading)` | `boolean`            | Moves to a heading. It returns `true` or throws. |

`headings` returns immutable entries. A `Heading` has the fields of `DocumentVersion` and these:

| Field   | Type     | Meaning                                                                                                    |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `id`    | `string` | An opaque name for the heading. It belongs to the current loaded document and editing mode.                |
| `level` | `number` | 1 to 6.                                                                                                    |
| `text`  | `string` | The readable text. Author comments are excluded, and image alt text and readable footnote labels are kept. |

Heading-looking code, unsupported literal blocks and TXT create no entries. Query again after edits, undo, loads or mode changes.

`navigateHeading(entry)` checks the entry against the current document, generation, revision and editing mode. A stale entry throws `stale-document`, and a value that isn't a heading entry throws `invalid-argument`. Navigation focuses the heading, scrolls to it and unfolds folded callouts that hold it, without changing source, history, revision or dirty state. Hosts own the outline layout and presentation.

## Clipboard

| Member                                                | Returns                    | Purpose                                                          |
| ----------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `clipboardSnapshot(scope?, expectedGeneration?)`      | `Promise<ClipboardOutput>` | Prepares the document or the selection for the native clipboard. |
| `paste(input: ClipboardInput, expectedGeneration?)`   | `Promise<void>`            | Pastes content that the host read from the native clipboard.     |
| `pasteAsPlainText(text: string, expectedGeneration?)` | `boolean`                  | Inserts literal text. Returns whether the document changed.      |

`clipboardSnapshot` takes a `ClipboardScope`: `'document'`, the default, or `'selection'`. It returns a `ClipboardOutput`:

| Field                                  | Type                 | Meaning                                                                                                                                                                                                          |
| -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentId`, `generation`, `revision` | `DocumentVersion`    | The document the copy started from.                                                                                                                                                                              |
| `text`                                 | `string`             | Readable plain text.                                                                                                                                                                                             |
| `html`                                 | `string`             | Semantic HTML. It carries no private image URL.                                                                                                                                                                  |
| `markdown`                             | `string`             | The Markdown source of the scope. A whole document gives its exact source.                                                                                                                                       |
| `images`                               | `ClipboardImage[]`   | The images in `html`, in order. Each has `reference` (the authored reference, or an empty string for a generated diagram image), `alt`, `image?` (a `PortableImage`) and `error?` (why bytes weren't available). |
| `diagrams`                             | `ClipboardDiagram[]` | Each complete Mermaid diagram in the scope. Each has `source`, `image?` (a PNG `PortableImage`) and `error?`.                                                                                                    |

The promise rejects with `stale-document` if the document, its revision or the editing mode changes before the copy is ready. Resolve it before you touch the native clipboard, and keep the existing clipboard on failure. Degraded output describes itself in `images[].error` and `diagrams[].error`, and isn't also reported as an error. Encode byte arrays explicitly when you cross a WebKit JSON bridge.

A Mermaid diagram stays editable code, and clipboard output describes it in `diagrams`: its source, an optional portable PNG and an optional error. Successful PNGs also appear in `images` in HTML order, so existing native attachment bridges can export them. Generated diagrams have an empty image reference and don't use the host image adapter. `events.error` reports `diagram-unavailable` when a preview fails. A diagram that can't be exported has an `error` in `diagrams` and keeps readable source in rich output. Partial code selections produce source rather than a rendered diagram. Hosts that enforce a Content Security Policy must permit local `blob:` image URLs for diagram rasterization. A blocked decoder reports a diagram export failure and keeps the source.

`paste` captures one operation; don't read the global clipboard again after you await it. `ClipboardInput` has these fields, and any other field throws `invalid-argument`:

| Field      | Type              | Meaning                                                                                                                                                            |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`     | `string`          | Required. The plain text.                                                                                                                                          |
| `markdown` | `string`          | Explicit Markdown source. It takes precedence over `text` and `html` semantics. Source mode pastes it literally.                                                   |
| `html`     | `string`          | Rich content. When `markdown` is also given, the HTML is still used to find the images in it.                                                                      |
| `images`   | `CapturedImage[]` | Bytes for the images that `html` refers to. An item whose `source` equals an image's `src` belongs to that image; items without a `source` fill the rest in order. |

In source and TXT modes, `paste` inserts `markdown` (Markdown source) or `text` literally and ignores the rest. `pasteAsPlainText` is the one way to paste literal text in formatted mode; `ClipboardInput` has no plain-text flag. An image that can't be imported becomes the text `[Name: image unavailable]`, where `Name` is the image's alt text, its file name or `Image`, and `events.error` receives `image-unavailable`.

When the person copies or cuts, InkKit handles the browser's event itself. If the selection holds an image or a diagram, `events.clipboard` receives a `ClipboardOutput` of it. A paste the person makes runs the same import as `paste`. See [Events](#events).

## Printing

`printableSnapshot(expectedGeneration?): Promise<PrintableDocument>` returns the whole current document for printing, independent of selection, viewport, folding and comment visibility. The app owns Print and PDF commands, dialogs, file generation and file access.

| Field                                  | Type                          | Meaning                                                                                            |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `documentId`, `generation`, `revision` | `DocumentVersion`             | The document that was printed.                                                                     |
| `format`                               | `'md'` or `'txt'`             | The document format.                                                                               |
| `html`                                 | `string`                      | A complete standalone HTML document with the print CSS embedded and `data:` images only.           |
| `styles`                               | `string`                      | The same CSS on its own.                                                                           |
| `assets`                               | `readonly PortableImage[]`    | The images, in the order they appear in `html`. They are copies of the bytes, which belong to you. |
| `warnings`                             | `readonly PrintableWarning[]` | Degraded output. Each has a `code` and a `message`.                                                |

A `PrintableWarning.code` is `diagram-unavailable` (invalid or unsupported Mermaid prints as readable code), `attachment-fallback` (an audio, video, PDF or other file prints as a description) or `attachment-unavailable` (a missing or failed file prints as a description). The metadata and the result arrays are frozen.

The output includes footnotes, resolved reference links, tables, images, Mermaid diagrams, full callout bodies and highlights. It excludes author comments, clipboard provenance and editor controls. TXT stays escaped literal text. Print styles wrap long text and tables and fit images within the available width and 90% of the print viewport height while keeping their aspect ratio; adapt them to your paper and layout.

Printing captures a fresh snapshot and rechecks the document ID, generation and revision after asynchronous work, including an edit, undo or reload during export. Composition, pending imports, stale documents and destruction reject the operation. Missing, empty, mismatched or undecodable authored image bytes reject with `image-unavailable`. Invalid or unsupported Mermaid prints readable code with a `diagram-unavailable` warning; failing to rasterize a diagram that rendered rejects with `diagram-unavailable`. A failed operation never returns partial printable content. Local `blob:` image permission is required while portable assets are validated.

## Slash block menu

Set `slashMenu: { enabled: true }` at mount to offer block commands when the person types `/` at the start of an empty line. Empty headings, empty lines after Shift+Return, and empty paragraphs inside list items, quotes and callouts are supported. A command after Shift+Return starts a separate block and keeps the preceding text. A slash elsewhere stays ordinary text, including in dates, paths and URLs. The menu never opens in read-only documents, source or TXT mode, code blocks, table cells, front matter, preserved literal blocks or during composition.

`SlashMenuOptions` has these optional fields:

| Field            | Type                          | Default and meaning                                                                                                          |
| ---------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `enabled`        | `boolean`                     | `false`. Enables the menu.                                                                                                   |
| `commands`       | `readonly SlashCommandName[]` | All built-in commands. Selects which commands appear, in the fixed order below. An empty array hides every built-in command. |
| `customCommands` | `readonly SlashCommand[]`     | None. Appends host commands in the supplied order.                                                                           |

Each built-in command matches its displayed name and these additional words. Matching ignores case and compares the start of each name or word with the typed filter. Changing a name through `labels` changes its name match; the additional words stay the same.

| `SlashCommandName` | Default name  | Additional words         |
| ------------------ | ------------- | ------------------------ |
| `heading1`         | Heading 1     | `h1`, `title`            |
| `heading2`         | Heading 2     | `h2`, `subtitle`         |
| `heading3`         | Heading 3     | `h3`                     |
| `bulletList`       | Bulleted List | `bullet`, `ul`           |
| `orderedList`      | Numbered List | `number`, `ol`           |
| `taskList`         | Checklist     | `task`, `todo`           |
| `quote`            | Quote         | `blockquote`             |
| `codeBlock`        | Code Block    | `code`, `fence`          |
| `table`            | Table         | `grid`                   |
| `callout`          | Callout       | `note`, `tip`, `warning` |
| `divider`          | Divider       | `line`, `rule`, `hr`     |
| `diagram`          | Diagram       | `mermaid`, `chart`       |

Callout opens a second list: Note, Tip, Important, Warning and Caution. Diagram appears only when a diagram renderer is available and `rendering.diagramPreview` is not `false`; it is absent from a bundle that imports only the core entry. Commands insert ordinary supported Markdown, through the editor's conversion, parsing and preservation checks.

The menu opens below the caret, or above it when there is insufficient room below. At most eight rows are visible; the list scrolls. Each row shows a glyph and its name. The first match is selected. Up and Down change the selection; Return, Tab or a click chooses it. Escape, deleting the slash, clicking elsewhere or scrolling away closes the menu and keeps the text. With no match, the menu briefly shows the `suggestionsEmpty` label, then closes. An unrelated edit, selection or presentation change also closes it. The editing surface exposes combobox semantics while the listbox is open, and the selected option is announced as it changes.

Choosing a command replaces the slash and filter in one edit. One Undo immediately afterward restores the line exactly as it was before the slash; Redo restores the inserted block. Dismissing the menu leaves the typed text and its normal history intact. A preservation refusal keeps the document, revision and history unchanged and reports `preservation` through `events.error`.

### Host commands

`SlashCommand` describes a host command:

```ts
interface SlashCommand {
  name: string
  keywords?: readonly string[]
  action(
    context: DocumentContext,
  ): string | undefined | Promise<string | undefined>
}
```

`name` is the nonempty displayed name. Optional `keywords` adds prefix matches using the same case-insensitive comparison as built-in commands. `action` receives the current document ID, generation and a new operation ID. The host owns any lookup, permissions or interface needed to choose the content. Return Markdown for InkKit to parse and insert atomically in place of the trigger line. Return `undefined` to cancel and keep the text as typed. Return `''` to remove the slash and filter and restore the line as it was before the slash, including an empty heading's level or a hard break. A host command has the same preservation checks and undo behavior as a built-in command; it does not need access to editor internals.

The menu closes when the action starts. A promise does not block typing. If the document, revision, mode, editability, selection or editor presentation changes before the result arrives, InkKit refuses the stale result and reports `stale-document`. Destruction silently cancels pending actions: late results and errors are ignored. A refusal leaves the current document intact. An invalid return value reports `invalid-argument`; a thrown or rejected action error is reported as an `InkKitError` through `events.error`. A failed action, or one that returns `undefined`, keeps the trigger text.

Unknown option fields or command names, a blank command name, non-string keywords or a missing action make `mount` reject with `invalid-argument`. Use [labels](#labels) for built-in names and the [menu tokens](#appearance-labels-and-shortcuts) for appearance.

## Appearance, labels and shortcuts

The mounted root receives `.inkkit-root`. Package rules, including table styles, are scoped beneath it; they do not set the host's `:root` font size or color scheme. Set these public CSS custom properties on the root or an ancestor. InkKit reads no other custom property, so a host's own `--accent`, `--text` or `--reading-width` never changes the editor. Properties beginning `--_inkkit-` are internal.

| Tokens                                                                                                                                        | Default or purpose                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--inkkit-font-family`, `--inkkit-font-size`, `--inkkit-line-height`                                                                          | System sans-serif, `15px`; line height defaults to `normal` in formatted mode and `1.5` in source/TXT.                                                                                                                                                                                    |
| `--inkkit-monospace-font`                                                                                                                     | System monospace stack for source, TXT and code.                                                                                                                                                                                                                                          |
| `--inkkit-color-scheme`                                                                                                                       | `light dark`.                                                                                                                                                                                                                                                                             |
| `--inkkit-menu-background`                                                                                                                    | `light-dark(#fff, #252529)`. Suggestion menu background.                                                                                                                                                                                                                                  |
| `--inkkit-menu-text`                                                                                                                          | `CanvasText`. Suggestion menu text.                                                                                                                                                                                                                                                       |
| `--inkkit-menu-highlight`                                                                                                                     | `light-dark(#e8e8ed, #414146)`. Selected suggestion background.                                                                                                                                                                                                                           |
| `--inkkit-menu-radius`                                                                                                                        | `8px`. Suggestion menu corner radius.                                                                                                                                                                                                                                                     |
| `--inkkit-menu-shadow`                                                                                                                        | `0 4px 18px #0003`. Suggestion menu shadow.                                                                                                                                                                                                                                               |
| `--inkkit-menu-width`                                                                                                                         | `240px`. Suggestion menu width, limited to the viewport width minus 8 pixels.                                                                                                                                                                                                             |
| `--inkkit-min-height`, `--inkkit-reading-width`                                                                                               | `100%`, `100%`.                                                                                                                                                                                                                                                                           |
| `--inkkit-column-inset`                                                                                                                       | The inline padding of the writing column on the formatted surface and on source and TXT. Defaults to the formula below.                                                                                                                                                                   |
| `--inkkit-padding-top`, `--inkkit-padding-inline`, `--inkkit-padding-bottom`                                                                  | `10px`, `16px`, `48px`.                                                                                                                                                                                                                                                                   |
| `--inkkit-paragraph-spacing`                                                                                                                  | About two-thirds of the editor font size.                                                                                                                                                                                                                                                 |
| `--inkkit-checkbox-offset`                                                                                                                    | `0px`. Moves task checkboxes down (a negative value moves them up). The box is centered on the item's first line at any font size and line height, so set this only for a font whose lines look off-center.                                                                               |
| `--inkkit-accent-color`, `--inkkit-text-color`                                                                                                | `#0a84ff`, `CanvasText`.                                                                                                                                                                                                                                                                  |
| `--inkkit-muted-color`, `--inkkit-rule-color`, `--inkkit-code-background`                                                                     | System text mixed with transparency for secondary text, borders and code background.                                                                                                                                                                                                      |
| `--inkkit-code-comment`, `--inkkit-code-keyword`, `--inkkit-code-string`, `--inkkit-code-number`, `--inkkit-code-title`, `--inkkit-code-attr` | Syntax highlighting colors. The defaults follow the editor color scheme and meet WCAG AA contrast on the default code background over a `Canvas` page.                                                                                                                                    |
| `--inkkit-diagram-background`, `--inkkit-diagram-text-color`, `--inkkit-diagram-error-color`                                                  | `#fff`, `#222`, `#9b2424` for the diagram preview card and its error text.                                                                                                                                                                                                                |
| `--inkkit-focus-width`, `--inkkit-focus-color`, `--inkkit-focus-offset`                                                                       | `2px`, editor accent, `-2px`. The ring on every control InkKit draws: buttons, the attachment Open control, audio and video. Footnote and wiki links draw it outside the text, in current text color with a `2px` offset. The PDF preview frame keeps the browser's own focus indication. |
| `--inkkit-surface-focus-width`, `--inkkit-surface-focus-color`, `--inkkit-surface-focus-offset`                                               | The `--inkkit-focus-*` values. The ring on the formatted and source/TXT editing surfaces only. Set the width to `0` to draw none there and keep the controls' rings.                                                                                                                      |

The editor color scheme is `--inkkit-color-scheme`, or the system setting when it is `light dark`. Default syntax colors use the light or dark palette of that scheme, so a host that forces `light` or `dark` gets matching code colors whatever the system setting. The defaults use CSS `light-dark()`; see [Supported engines](integration.md#supported-engines).

Diagram previews always use Mermaid's default light theme, whatever the editor color scheme, because the same rendering becomes the PNG for clipboard output and print. The preview card is therefore light by default in both schemes. The diagram tokens change the card around the diagram, not the colors inside it. Because the theme does not follow the scheme, a rendered diagram is cached by its source alone.

Each editor root can have independent styling.

```css
.document-editor {
  --inkkit-font-size: 17px;
  --inkkit-reading-width: 48rem;
  --inkkit-padding-inline: 24px;
  --inkkit-accent-color: #286343;
}
```

**The writing column.** The formatted surface and the source and TXT surface use the same column: text starts `--inkkit-column-inset` from each side, so the text stays put when the mode changes. The default is a contract, so a host can rely on it:

```css
max(
  var(--inkkit-padding-inline),
  calc((100% - var(--inkkit-reading-width)) / 2 + var(--inkkit-padding-inline))
)
```

As with any padding, the `100%` resolves against the containing block of the element that uses the value; for InkKit's surfaces, that block is as wide as the editor root. To line up a header or toolbar that the host draws outside the root with the column, set `--inkkit-column-inset` once on an ancestor of both, put the header in a container as wide as the editor root, and give the header no border or margin of its own:

```css
.page {
  --inkkit-reading-width: 48rem;
  --inkkit-padding-inline: 24px;
  --inkkit-column-inset: max(
    var(--inkkit-padding-inline),
    calc(
      (100% - var(--inkkit-reading-width)) / 2 + var(--inkkit-padding-inline)
    )
  );
}
.page-header {
  padding-inline: var(--inkkit-column-inset);
}
```

InkKit then uses that value on its surfaces, so the host overrides no InkKit selector. Leave the token unset to keep the default.

**Classes.** Every class InkKit draws begins `inkkit-`. The classes that ProseMirror, its table plugin and Milkdown add, such as `ProseMirror`, `ProseMirror-selectednode` and `selectedCell`, keep their names, and so do the classes inside a diagram preview's SVG, which Mermaid draws. Classes and markup are not a styling API: style the editor through the tokens above, and expect a class to change in any release. Copied and printable HTML carry no class that does not begin `inkkit-`.

### Labels

`EditorOptions.labels` is `Partial<EditorLabels>`. Omitted labels keep their defaults, and an unknown key or a value that isn't a string makes `mount` reject with `invalid-argument`. InkKit inserts every label as text, never as markup. Labels are fixed at mount.

| Key                      | Default                     | Used for                                                                                                          |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `formattedEditor`        | `Formatted Markdown editor` | The accessible name of the formatted editing surface.                                                             |
| `plainTextEditor`        | `Plain text editor`         | The accessible name of the TXT surface.                                                                           |
| `sourceEditor`           | `Markdown source editor`    | The accessible name of the Markdown source surface.                                                               |
| `placeholder`            | `Start typing…`             | The text shown in an empty formatted document.                                                                    |
| `copyCode`               | `Copy`                      | The code block Copy button, which `events.copy` enables.                                                          |
| `codeLanguage`           | `Code language`             | Accessible name of the code language selector and its dialog.                                                     |
| `codeLanguageSearch`     | `Search languages`          | Accessible name and placeholder of the language search field.                                                     |
| `codeAuto`               | `Auto`                      | An unlabelled fence; automatic highlighting does not write a detected language.                                   |
| `codePlainText`          | `Plain text`                | Explicit plain text without syntax highlighting.                                                                  |
| `expandCallout`          | `Expand`                    | The fold button of a collapsed callout.                                                                           |
| `collapseCallout`        | `Collapse`                  | The fold button of an expanded callout.                                                                           |
| `diagramRendering`       | `Rendering diagram…`        | The status shown while a diagram renders.                                                                         |
| `diagramUnavailable`     | `Diagram unavailable:`      | A prefix, followed by the renderer's diagnostic message.                                                          |
| `footnote`               | `Footnote`                  | A prefix, followed by the authored footnote label. Names footnote references and definitions.                     |
| `tableAddRow`            | `Add row`                   | The table controls: add a row.                                                                                    |
| `tableAddColumn`         | `Add column`                | The table controls: add a column.                                                                                 |
| `tableDeleteRow`         | `Delete row`                | The table controls: delete a row.                                                                                 |
| `tableDeleteColumn`      | `Delete column`             | The table controls: delete a column.                                                                              |
| `tableAlignLeft`         | `Align left`                | The table controls: align a column left.                                                                          |
| `tableAlignCenter`       | `Align center`              | The table controls: center a column.                                                                              |
| `tableAlignRight`        | `Align right`               | The table controls: align a column right.                                                                         |
| `tableMoveColumn`        | `Move column`               | The table controls: the handle that moves a column.                                                               |
| `tableMoveRow`           | `Move row`                  | The table controls: the handle that moves a row.                                                                  |
| `fileLoading`            | `Loading file…`             | The status of a file card while its adapter is resolving it.                                                      |
| `fileMissing`            | `File unavailable`          | A file card whose adapter reports it missing.                                                                     |
| `fileError`              | `File could not be loaded`  | A file card whose adapter fails, or reports an error with an empty `message`.                                     |
| `fileRetry`              | `Retry`                     | The button on a card that is loading, failed, missing or in error. It asks the adapter to resolve the file again. |
| `fileOpen`               | `Open`                      | The name and tooltip of the Open button on file cards. The button appears only when `FileAdapter.open` is set.    |
| `filePreviewUnavailable` | `Preview unavailable`       | The status of a card whose image, audio, video or PDF preview failed to load.                                     |
| `filePDFPreview`         | `Open to view this PDF`     | The status line of a PDF card.                                                                                    |
| `wikiMissing`            | `Link unavailable`          | The tooltip of a wiki link that `WikiLinkAdapter.resolve` reports missing.                                        |
| `comment`                | `Author comment`            | The name of an author comment, which stays out of the readable text.                                              |
| `preservedMarkdown`      | `Preserved Markdown`        | The name of a block of Markdown that InkKit keeps as authored and doesn't render.                                 |
| `suggestions`            | `Suggestions`               | The accessible name of the suggestion list.                                                                       |
| `suggestionsLoading`     | `Loading…`                  | The status while a note-suggestion request is pending.                                                            |
| `suggestionsEmpty`       | `No matches`                | The temporary message when no suggestion matches.                                                                 |
| `slashHeading1`          | `Heading 1`                 | The level-one heading command.                                                                                    |
| `slashHeading2`          | `Heading 2`                 | The level-two heading command.                                                                                    |
| `slashHeading3`          | `Heading 3`                 | The level-three heading command.                                                                                  |
| `slashBulletList`        | `Bulleted List`             | The bulleted list command.                                                                                        |
| `slashOrderedList`       | `Numbered List`             | The numbered list command.                                                                                        |
| `slashTaskList`          | `Checklist`                 | The task list command.                                                                                            |
| `slashQuote`             | `Quote`                     | The quote command.                                                                                                |
| `slashCodeBlock`         | `Code Block`                | The code block command.                                                                                           |
| `slashTable`             | `Table`                     | The table command.                                                                                                |
| `slashCallout`           | `Callout`                   | The command that opens the callout choices.                                                                       |
| `slashDivider`           | `Divider`                   | The divider command.                                                                                              |
| `slashDiagram`           | `Diagram`                   | The diagram command, when previews are available.                                                                 |
| `slashNote`              | `Note`                      | The Note callout choice.                                                                                          |
| `slashTip`               | `Tip`                       | The Tip callout choice.                                                                                           |
| `slashImportant`         | `Important`                 | The Important callout choice.                                                                                     |
| `slashWarning`           | `Warning`                   | The Warning callout choice.                                                                                       |
| `slashCaution`           | `Caution`                   | The Caution callout choice.                                                                                       |

Your app owns its localization catalog and its toolbar and menu labels.

Blocks that browsers would otherwise expose as unnamed, generic elements carry a role that allows a name. An attachment card is a `group` named after the file, so its Open, status and Retry controls read as part of it. A footnote definition is a `note` named by `footnote` and its label, as its reference is. An author comment, shown when comments are revealed, is a `note` named by `comment`. A preserved Markdown block is a `group` named by `preservedMarkdown`. The roles are not configurable; the names are. Copied HTML omits these roles and names.

### Shortcuts

`EditorOptions.keymap` and `setKeymap(bindings: Keymap): void` configure the shortcut bindings. `Keymap` maps each `ShortcutName` to an array of keys in [ProseMirror key notation](https://prosemirror.net/docs/ref/#keymap), such as `Mod-b`, `Shift-Mod-z` or `Alt-ArrowDown`. `Mod` is Command on Apple platforms and Control elsewhere. `setKeymap` replaces the whole map: a name it leaves out loses its binding, or returns to its default. An unknown name, or a value that isn't an array of strings, throws `invalid-argument`; a `null` entry keeps that name's default. A formatting name runs the `format` command of the same name. Formatting names are `heading1`, `heading2`, `heading3`, `heading4`, `heading5`, `heading6`, `paragraph`, `bold`, `italic`, `strikethrough`, `highlight`, `code`, `codeBlock`, `quote`, `bulletList`, `orderedList` and `taskList`. Formatting has no default bindings; the host supplies them. There is no name for `link`, because it needs a destination.

History names are `undo` and `redo`. Block move names are `moveBlockUp` and `moveBlockDown`; they run `moveBlock('up')` and `moveBlock('down')`. Table names are `tableInsert`, `tableAddRowBefore`, `tableAddRowAfter`, `tableAddColumnBefore`, `tableAddColumnAfter`, `tableDeleteRow`, `tableDeleteColumn`, `tableDeleteTable`, `tableAlignLeft`, `tableAlignCenter`, `tableAlignRight`, `tableMoveRowUp`, `tableMoveRowDown`, `tableMoveColumnLeft`, `tableMoveColumnRight`, `tableSortRows` and `tableExit`. A table name is `table` followed by the `TableCommand`, with its first letter capitalized.

Omitted history bindings keep `Mod-z` for undo and `Mod-y` and `Shift-Mod-z` for redo; an explicit empty array disables the defaults for that name. Omitted block move bindings keep `Alt-ArrowUp` and `Alt-ArrowDown`, which are Option-Up and Option-Down on a Mac; an explicit empty array disables that name's default. In a macOS text view, Option-Up and Option-Down move the caret to the start or end of a paragraph. In the formatted editor, the block move bindings replace that behavior; in source and TXT modes, the keys keep it. Omitted `tableExit` bindings keep `Mod-Enter` and `Enter` in table context; an explicit empty array disables both. Unbound default history keys are consumed to prevent the browser's separate undo stack from changing source and TXT text.

- **History bindings** apply on the formatted, source and TXT surfaces. Formatting, block move and table bindings apply only on the formatted surface.
- **When two names share a key,** the later group wins, in the order history, formatting, block moves, tables. A table binding that shares its key with a block move passes the key to the block move when the table command isn't available, so a host can give `tableMoveRowUp` and `moveBlockUp` the same key: rows move in a table, and blocks move elsewhere.
- **A bound key is consumed** even when its history, formatting or block move command isn't available now, such as at the first or last place, so the key never reaches the web view. A table binding passes the key on when its command isn't available. A block move binding, and a table binding that shares its key, passes the key on in a read-only editor; a block move binding also passes it on in a table cell and where there's no block to move, so the table's bindings or the web view's own caret movement apply.
- **A command that fails from a shortcut** reports its error through `events.error`.

Query [command availability](#command-availability) to present the current state of shortcuts and menu items.

## Opening links

A primary click with Mod held opens a link, in formatted mode, whether or not the editor is editable. Mod is Command on Apple platforms and Control elsewhere: the same key as `Mod` in [keymap](#shortcuts) notation, detected from `navigator.platform` in the same way. On a Mac, Control-click keeps opening the context menu. A click without Mod places the caret as usual. No click on a link, with or without Mod, Shift or the middle button, makes the web view follow it, including in read-only mode, and Mod-click on a link doesn't select the link or its paragraph.

- **Markdown link:** InkKit calls `events.openLink(href)` with the link's destination. Without an `openLink` handler, Markdown links don't open. It doesn't call `openLink` when the rendered address is empty. That includes `[text]()` and any address that isn't relative, a fragment, a query, or an `http`, `https`, `mailto` or `tel` address, such as `javascript:`, `ftp:`, `file:` or an app-specific scheme. The editor renders those links without an address, and copies them as their text; it's the same list that HTML import and print use. The Markdown source keeps the address as authored. Relative addresses and fragments, such as `notes/a.md` or `#intro`, reach the host as they are, not resolved against the page's address.
- **Wiki link:** InkKit calls `WikiLinkAdapter.open`. See [Optional wiki links and files](#optional-wiki-links-and-files).

While Mod is held and the pointer is over the editor root, InkKit's stylesheet shows the pointer cursor over each link that opens. InkKit tracks the key itself, including while focus is in a host control, so hosts don't need key listeners or classes for it. Opening a Markdown link from the keyboard isn't supported yet.

## Optional wiki links and files

`EditorOptions.wikiLinks` and `EditorOptions.files` are independent optional adapters. Omitting both retains the existing simple editor and `ImageAdapter` contract. See [supported syntax](supported-syntax.md#linked-syntax) for the bounded grammar and representation table.

`WikiLinkAdapter.open(reference, context)` receives a `WikiLinkReference` with decoded `target`, optional `fragment` and authored readable `label`. Optional synchronous `resolve(reference, context)` returns `{ missing?: boolean }` for presentation. It does not supply an editor URL. The host owns lookup, permissions and navigation; use source mode to edit the authored target or alias. A primary click with Mod (see [Opening links](#opening-links)) or Enter or Space on the focused link invokes `open`, including in read-only mode. No note index, backlink graph or transclusion is created.

### Typing a wiki link

When `wikiLinks` is set, typing the closing `]]` of a complete wiki link turns the typed text into that link, with or without `suggest`. The note saves the characters that were typed, such as `[[Note|alias]]`, and reopens with the same link. Without this, the typed brackets would be plain text, and a note would save them as `\[\[Note|alias]]`, which other tools don't read as a link.

The text becomes a link only when it is a complete wiki link of the [supported syntax](supported-syntax.md#linked-syntax), typed as one run of text in formatted mode: in a paragraph, heading, list item, quote, callout or table cell, in a writable document. In a table cell, the saved link spells its pipe `\|`. It stays text when the brackets follow `!`, `[` or `\`, when the text isn't a valid link (for example `[[ ]]` or `[[#^block]]`), when it crosses a link or a change in formatting, in inline or block code, and in source or TXT mode. Without `wikiLinks`, typed brackets stay text.

Only the bracket just typed, or one that an input method committed, makes the link. Escaped brackets already in the note stay text, including when a composition starts and is cancelled, and such a composition changes no text, revision or dirty state.

Backspace straight after the second `]` puts back the typed characters as plain text, which a note saves escaped. One Undo removes the typing. `pasteAsPlainText` inserts literal text, so it never makes a link; `paste` of text or Markdown does, as it does for a note that holds the link.

### Note suggestions

Add `WikiLinkAdapter.suggest` to offer note names after the person types `[[`. It is independent of `slashMenu.enabled` and uses the same suggestion list, labels and appearance tokens. Hosts without `suggest` keep their existing behavior.

```ts
interface WikiLinkAdapter {
  suggest?(query: string, context: FileContext): Promise<readonly string[]>
  // Existing resolve and open members are unchanged.
}
```

`query` is the text after `[[`, without the brackets. The host returns matching note names in display order and owns matching, access checks and storage. Each name appears as one row. `context` includes the document ID, generation, operation ID and an `AbortSignal`. A newer query or a closed menu aborts the previous request. Honor the signal when possible; InkKit ignores stale answers and stale failures even when the host ignores it. Slow requests leave typing available. While waiting, the list shows `suggestionsLoading`, reports `aria-busy`, and offers no stale rows to choose.

Suggestions open in formatted text, including headings, list items, quotes, callouts and table cells. They do not open in read-only documents, source or TXT mode, inline or block code, front matter, comments, preserved literal blocks or during composition. Escaped brackets and the file-embed prefix `![[` do not start note suggestions.

Up and Down select a row; Return, Tab or a click inserts that note. Escape, deleting the opening brackets, moving the caret, clicking elsewhere or scrolling away closes the menu and leaves the text as typed. Typing `]]` closes the menu too, and makes the text a link when it is a complete one. No matches briefly shows `suggestionsEmpty`, then closes. Loads, mode and policy changes, destruction and unrelated edits invalidate the session.

Choosing a name inserts `[[Note name]]` through the same preservation checks as other edits. Reserved characters in a name (`\`, `[`, `]`, `|` and `#`) are escaped so they remain part of the target instead of becoming a delimiter, alias or fragment. Unicode and spaces are kept. The surrounding blocks retain their bytes, including CRLF line endings. One Undo restores the typed brackets and query; Redo restores the selected link. Typing the closing `]]` yourself makes the typed text a link, as described in [Typing a wiki link](#typing-a-wiki-link); the saved bytes are the same as when you choose the note.

Names must be nonblank and valid targets in the [supported wiki-link syntax](supported-syntax.md#linked-syntax); control characters and block-reference names beginning with `^` are rejected. A rejected request, a non-array answer or any invalid name closes the list, reports `file-unavailable` through `events.error`, and leaves the document and history unchanged. A preservation refusal during insertion reports `preservation` and inserts nothing.

`FileAdapter` provides:

- `resolve(reference, context): Promise<FilePresentation>`: resolves an opaque `FileReference`, described below. The host identifies the actual file kind; InkKit does not infer it from an extension.
- Optional `exportImage(reference, context): Promise<PortableImage>`: supplies portable image bytes for copy and print. If omitted, `ImageAdapter.exportImage` exports path images. Named images require this callback for portable image output. Image import remains with `ImageAdapter.importImage`; no file storage/import API is added.
- Optional `open(reference, context)` and `contextMenu(reference, point, context)`: target the authored reference for host actions. `point` is a `ClientPoint`, `{ clientX, clientY }` in CSS pixels of the web view's client area. The host owns permissions, Open/Reveal UI and error handling for asynchronous native actions.

A `FileReference` has these fields:

- `kind`: `path` for `![alt](destination)` and `wiki` for `![[name]]`.
- `reference`: the whole reference, including any fragment. For `path`, it's the Markdown destination, `a/b.mp4#t=10`. For `wiki`, it's `target#fragment`, or `target` when there is no fragment.
- `target`: the reference without its fragment. Use it to find the file.
- `fragment`: optional. Everything after the separating `#`, such as `t=10` or `page=3`. When it's absent, `target` equals `reference`.
- `label`: optional. The alt text of a path image without its width, or `target#fragment` for a named file.
- `width`: optional. The authored width, from `|400` in the alt text or the name.

| Markdown                           | `kind` | `reference`             | `target`         | `fragment`    |
| ---------------------------------- | ------ | ----------------------- | ---------------- | ------------- |
| `![](a/b.mp4#t=10)`                | `path` | `a/b.mp4#t=10`          | `a/b.mp4`        | `t=10`        |
| `![](a.pdf?x=1#page=2#more)`       | `path` | `a.pdf?x=1#page=2#more` | `a.pdf?x=1`      | `page=2#more` |
| `![](My%23Notes.pdf)`              | `path` | `My%23Notes.pdf`        | `My%23Notes.pdf` | absent        |
| `![[My file.pdf#page=3]]`          | `wiki` | `My file.pdf#page=3`    | `My file.pdf`    | `page=3`      |
| `![[ My file.pdf # page=3 \|200]]` | `wiki` | `My file.pdf#page=3`    | `My file.pdf`    | `page=3`      |
| `![[My\#Notes.pdf#page=2]]`        | `wiki` | `My#Notes.pdf#page=2`   | `My#Notes.pdf`   | `page=2`      |

In a path, the fragment starts at the first `#`, so a `#` that belongs to a file name must be written `%23`, as in any URL. InkKit doesn't decode it: the target of `My%23Notes.pdf` is `My%23Notes.pdf`. A backslash escape doesn't keep a `#` in a path's name, because Markdown removes it before InkKit reads the destination: the target of `![](My\#Notes.pdf)` is `My`. InkKit gives `?` no meaning, so a query stays in `target`. In a named file, a `#` in the name is escaped as `\#`, and `target` holds the name with the escape removed, so don't find the target by splitting `reference` at its first `#`. Named targets and fragments are trimmed; internal spaces are kept.

`FileContext` extends `DocumentContext` with an `AbortSignal`. Honor the signal when you can; InkKit ignores late results either way.

`resolve` returns a `FilePresentation`, one of these shapes:

| `kind`                           | Other fields                                         | The card shows                                                                                                           |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `image`, `audio`, `video`, `pdf` | `url: string`, `label?: string`, `mimeType?: string` | The resource at `url` with the file's name.                                                                              |
| `file`                           | `label?: string`                                     | A descriptive card with no preview.                                                                                      |
| `missing`                        | `label?: string`                                     | A card that uses the `fileMissing` label.                                                                                |
| `error`                          | `message: string`, `label?: string`                  | A card whose status is `message`, a short reason written for the person. An empty `message` shows the `fileError` label. |

The `url` is private and must serve the declared kind in the host's offline web view. A `mimeType` must match the kind. An unknown kind, an executable URL scheme, a data URL whose type doesn't match the kind, or a missing `url` or `message` makes the presentation invalid, and InkKit reports `file-unavailable` through `events.error`. The adapter owns the URL's lifetime, byte validation, access checks and fragment mapping, including media `#t=` or PDF `#page=`. InkKit keeps the authored fragments without interpreting storage paths or creating a network fallback.

Resolution never changes authored Markdown or revision. Each view captures the document ID and generation. Retry, reference replacement, source mode, folded ancestors, reloads and destruction abort obsolete work; late results are ignored even when the host ignores the signal. Width/label changes use current editor metadata without changing reference identity. The Retry button starts a new request. Missing, rejected, undecodable and unsupported presentations retain source and expose a descriptive card. A rejected or invalid resolution, a preview that fails to load, and an exception from `FileAdapter.open`, `FileAdapter.contextMenu`, `WikiLinkAdapter.resolve` or `WikiLinkAdapter.open` are reported through `events.error` as `file-unavailable`, with the original error as `cause`. Use source mode to edit or remove a reference.

Images share the existing width convention and resize handle. A completed gesture creates one isolated undo entry; canceled gestures do not change source. Read-only, composition and pending edits reject resizing. Audio/video use native controls with no autoplay, retaining playback through read-only transitions and adjacent edits. Hiding or destroying their view pauses playback and releases the element's resource. Returning to the formatted view resolves again without autoplay. PDF uses a sandboxed frame and a card with the file's name and status line; the card's Open button appears only when `FileAdapter.open` is set, as on every file card. Preview is best effort: sandbox restrictions can block a built-in PDF viewer without firing an error event. The card remains when the frame is blank, and PDF content isn't executed. File cards never execute their content.

`clipboardSnapshot()` and `printableSnapshot()` resolve kinds afresh from frozen content, independently of current display elements. Source edits, loads and reloads, mode changes and destruction cancel pending exports and reject stale output. Non-image kinds use the descriptive fallbacks in the syntax table. `PrintableWarning.code` distinguishes `attachment-fallback` from `attachment-unavailable`; existing `diagram-unavailable` remains unchanged. A resolved image's missing or invalid portable bytes reject print with `image-unavailable`; clipboard retains its description and `images.error`. Private display URLs are never exported. Native copy/cut should use `events.clipboard` and acknowledge a successful clipboard write before source removal.

## Code highlighting and diagram previews

`EditorOptions.rendering` accepts `codeHighlighting?: boolean` and `diagramPreview?: boolean`. Both default to `true`. Set either to `false` at mount to skip that presentation plugin. Code and diagram source remain editable and retain their authored spelling; mode changes, history and portable output keep the same contracts. Explicit clipboard and printable diagram exports still render on demand, including when previews are disabled. Mermaid loads after source validation on the first actual render; its queue/cache is shared across instances. An offline single-file bundle built from the main entry still includes the rendering code, so disabling previews reduces execution work rather than bytes. To leave Mermaid out of the bundle, use the core entry described in [Builds without diagrams](#builds-without-diagrams). Code highlighting leaves a code block longer than 5,000 characters plain, and once highlighting in one load or edit has taken 200 ms, the blocks it has not reached stay plain until they are edited. The text of these blocks is still editable and is saved unchanged. See [measured baselines](performance.md).

Code blocks include a searchable language selector. Selecting a language changes the fence's language word through the same preservation, read-only and composition guards as editor commands, with one undo step. Fence markers, line endings and additional info-string metadata are retained. An unknown authored language remains available and is not rewritten on load. `Auto` removes the explicit language; detection is presentation only and never writes its result to Markdown. Detection is limited to blocks of at most 500 characters and shares the 200 ms highlighting budget. Larger unlabelled blocks stay plain. `Plain text` writes `text` as the language. If removing the language would reinterpret additional metadata as a language, the preservation guard rejects the change. Copy buttons have a transparent idle background and become visible on pointer hover or keyboard focus within the block.

## Exported types

This table maps every exported name to the section that describes it. `InkKitEditor` and `InkKitError` are classes; every other export is a type.

| Section                                                                               | Exports                                                                                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Mounting](#mounting)                                                                 | `InkKitEditor`, `EditorOptions`                                                                           |
| [Document identity](#document-identity) and [Loading and saving](#loading-and-saving) | `DocumentVersion`, `DocumentInput`, `DocumentSnapshot`, `DocumentFormat`                                  |
| [Errors](#errors)                                                                     | `InkKitError`, `EditorErrorCode`                                                                          |
| [Events](#events)                                                                     | `EditorEvents`                                                                                            |
| [Editability and text input](#editability-and-text-input)                             | `TextInputPreferences`                                                                                    |
| [Command availability](#command-availability)                                         | `CommandState`, `CaretState`, `Mark`, `Block`                                                             |
| [Formatting and keys](#formatting-and-keys)                                           | `FormatCommand`, `FormatOptions`, `KeyInput`, `BlockMoveDirection`                                        |
| [Native readable text and layout](#native-readable-text-and-layout)                   | `ReadableTextSnapshot`, `TextRange`, `TextRect`, `ViewportOptions`, `ViewportInsets`, `ViewportSnapshot`  |
| [Images](#images)                                                                     | `ImageAdapter`, `CapturedImage`, `PortableImage`, `DocumentContext`, `ImageInsertion`, `ClientPoint`      |
| [Tables](#tables)                                                                     | `TableCommand`, `TableOptions`                                                                            |
| [Source editing and history](#source-editing-and-history)                             | `EditingMode`                                                                                             |
| [Headings and navigation](#headings-and-navigation)                                   | `Heading`                                                                                                 |
| [Clipboard](#clipboard)                                                               | `ClipboardInput`, `ClipboardOutput`, `ClipboardScope`, `ClipboardImage`, `ClipboardDiagram`               |
| [Printing](#printing)                                                                 | `PrintableDocument`, `PrintableWarning`                                                                   |
| [Labels](#labels)                                                                     | `EditorLabels`                                                                                            |
| [Shortcuts](#shortcuts)                                                               | `ShortcutName`, `Keymap`                                                                                  |
| [Slash block menu](#slash-block-menu)                                                 | `SlashMenuOptions`, `SlashCommandName`, `SlashCommand`                                                    |
| [Optional wiki links and files](#optional-wiki-links-and-files)                       | `WikiLinkAdapter`, `WikiLinkReference`, `FileAdapter`, `FileReference`, `FileContext`, `FilePresentation` |

## Release history

This reference describes the current package. It carries no version qualifiers. To see what changed in each version, and how to move a host from one version to the next, read the [GitHub releases](https://github.com/aicayzer/inkkit/releases).
