# Integration and customisation

Editability, text-input preferences, command availability and mount-time labels/keymaps require 0.0.8 or later. Native text ranges and viewport coordination require 0.0.9 or later. Optional linked syntax and file adapters require 0.0.10 or later.

InkKit supplies document editing and portable exports. Your app supplies its interface, files and storage. Use exports from `@aicayzer/inkkit`; hosts do not import Milkdown or ProseMirror internals. The [API reference](api.md) defines errors and asynchronous contracts, and [preservation](preservation.md) explains source and clipboard fidelity.

## A simple writing tool

A small host can mount the editor without an image adapter or custom toolbar. The event handlers connect to the host's own controls, link handling and clipboard.

```ts
import { InkKitEditor, type EditorEvents } from '@aicayzer/inkkit'
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

Without an image adapter, image references remain literal Markdown. TXT documents use `format: 'txt'` and remain literal on both screen and export. The host can offer formatted/source switching through `setEditingMode()` without replacing the document or its history.

The example's optional presentation switches require 0.0.11. Omit them to retain highlighting and diagram previews. Explicit clipboard and printable diagram exports still render when previews are disabled. The generic isolated native consumer and its selectable `integration` group exercise assembled minimal/rich interactions; these fixture hosts establish engine contracts without proving app storage, permissions or opening actions. See [measured costs](performance.md) and the [native runner](../scripts/interop/README.md).

## A richer document app

Pass an adapter for image presentation, import and portable export. Observe command availability to enable native menus or toolbar buttons; keep the existing caret event for active formatting. The host owns localisation and controls outside the editor.

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

`editor.setTextInputPreferences({ spellcheck: false })` changes native HTML input attributes on both surfaces. It replaces the preference set; omitted fields remove earlier explicit attributes and leave behaviour to the browser. Editability and input-policy changes reject during composition without partial changes; successful transitions preserve source, revision, dirty state, history, focus and selection. Browser and OS support determines whether an input preference takes effect.

## Host search and overlapping chrome

Keep the search field and match list in the host. Capture `editor.textSnapshot()` and search its readable `text`; carry its `snapshotId` with every UTF-16 match range. A selection-only search result can call `selectTextRange()` without taking focus away from the host field. Use explicit reveal/navigation when the user asks to visit a result. Capture fresh ranges after edits, mode changes, reloads or document replacement. Handle stale-range rejection rather than reusing old offsets.

Supply your own scroll container and header/search-bar insets through `setViewport()`. Geometry and drop coordinates use client CSS pixels; translate them into native coordinates in the host. The editor owns no header rendering, toolbar layout or native search UI. `textRangeRects()` and `visibleTextRanges()` are demand-driven; they do not require a stream of per-character geometry across the bridge.

Loading a document does not grab focus or scroll a browsing host to a caret. External reload preserves valid selection, scrolling and focus. Explicit navigation reveals the target using the same inset-aware viewport on formatted and source/TXT surfaces. See the [API contract](api.md#native-readable-text-and-layout) for readable text, protected ranges and coordinate semantics.

## Appearance, labels and shortcuts

Package styles are scoped to the InkKit root so another editor or unrelated host content does not inherit its rules. Set documented `--inkkit-*` properties on the mounted root or an ancestor. Keep your own layout, toolbar and menus in the host. The [API reference](api.md#appearance-labels-and-shortcuts) lists tokens, label names and shortcut contracts.

Mount-time `labels` override the editor's built-in accessible names and visible text. Supply plain text from the host's localisation catalogue; supplied labels are not interpreted as markup. Host toolbar and native menu labels are outside this option.

Pass `keymap` at mount or call `setKeymap()` with bindings in ProseMirror key notation such as `Mod-b`. Formatting bindings are supplied by the host. Undo/redo keep their default history bindings unless overridden; an explicit empty array disables that command's configurable defaults. Formatting and table commands apply only where their command state permits; history bindings apply across formatted, source and TXT surfaces.

## Native boundaries and disposal

Image references are opaque. The adapter owns bytes, access control, storage and private display URLs. Keep imported bytes available through pending operations and unsaved edits. Validate document identity, generation and operation ID in native callbacks. Portable exports carry bytes rather than private URLs.

For native clipboard writes, await `clipboardSnapshot()` and validate the captured document before replacing the clipboard. Supply `events.clipboard` for image or diagram selections and resolve its promise only after the native write succeeds. Cut waits for that acknowledgement before deleting content. Encode byte arrays explicitly when crossing a JSON bridge.

`printableSnapshot()` returns a complete frozen printable document with portable assets; the app owns Print/PDF commands, dialogs and file generation. Before switching or closing a document, capture a fresh save snapshot. Increment generation when replacing it, and await `editor.destroy()` before removing the mounted root.

## Optional linked files

Add `wikiLinks` and/or `files` to the mount options when the host can resolve them. Keep the existing `images` adapter for captured-image imports and legacy path-image export. File resolution receives an abort signal and opaque reference; return a declared kind and a private offline display resource, or an explicit missing/error result. Supply portable image bytes through `files.exportImage` when named images must copy or print. Storage, permissions, URL creation/revocation, note lookup and native Open/Reveal actions stay in the host.

Keep private URLs out of source and host clipboard writers. Use `clipboardSnapshot`/`events.clipboard` output for portable rich copy, and `printableSnapshot` for printing. Media/file descriptions are supported print representations, with `attachment-fallback` warnings; unresolved files produce `attachment-unavailable`. Handle `image-unavailable` as an asset failure rather than printing a broken image. Honour `FileContext.signal`; InkKit also ignores stale results and cancels pending output if the captured document or mode changes. No app adoption is implied by enabling these package adapters.

See the [public adapter contract](api.md#optional-wiki-links-and-files) and [representation table](supported-syntax.md#linked-syntax) before wiring native actions.
