# Native clipboard probes

These probes distinguish a packed-package WebKit consumer from tests hosted in an app. Run the destination tests only in a disposable desktop session, vault and documents. Do not use production notes or send a test message.

Build the offline consumer from the exact candidate archive. The builder uses an archive filename containing its SHA-256 so that replacing a candidate at the same version cannot reuse the previous package installation.

```sh
node scripts/interop/build-consumer.mjs _local/release/aicayzer-inkkit-0.0.1.tgz
swiftc -target arm64-apple-macos27.0 scripts/interop/WebKitHost.swift -o _local/interop/webkit-host
swiftc scripts/interop/Clipboard.swift -o _local/interop/clipboard
```

Save the native clipboard before any probe. The snapshot can contain private content; keep it in ignored scratch storage and never commit it:

```sh
_local/interop/clipboard save _local/interop/previous-pasteboard.json
_local/interop/webkit-host _local/interop/consumer/dist/index.html export scripts/interop/fixture.json _local/interop/full.json
_local/interop/webkit-host _local/interop/consumer/dist/index.html partial scripts/interop/fixture.json _local/interop/partial.json
_local/interop/clipboard write _local/interop/full.json
```

Paste into the named disposable destination through its ordinary Paste command, inspect the destination document and copy a full and partial selection back. Read the resulting native clipboard with `clipboard read RESULT.json`. The result records text, HTML, RTF-derived HTML and image attachments. Build a host input containing `source` and `clipboard`, then run `webkit-host ... paste INPUT.json RESULT.json` to verify the package import. Prefer native HTML; when only RTF/RTFD is present, convert it to semantic HTML and associate attachment bytes with their source image URLs. Do not inject an unrelated preview bitmap.

```sh
_local/interop/clipboard restore _local/interop/previous-pasteboard.json
```

For Electron destinations, `cdp.py` evaluates an expression only in the selected page of an explicitly configured debugging endpoint. Configure a disposable user-data directory before launching the app. `AX.swift` reads only windows whose title exactly matches its second argument, excluding menu-bar recent documents.

```sh
CDP_HTTP=http://127.0.0.1:19229 uv run scripts/interop/cdp.py app://obsidian.md 'document.title'
```

`Clipboard.swift` writes RTFD attachments at their original positions using image tokens. It never sends messages, signs in or changes privacy permissions. A screen-recording denial is a test blocker; do not bypass it.

## Fixture-driven WKWebView regressions

`scenario` mode uses the public editor facade and real DOM selections. Each JSON input supplies `source`, optional `format`/`documentId`, and an `operations` array. Results retain each operation, named exports/snapshots, assertions and the final document. A failed assertion writes its evidence and exits with status 2.

```sh
node scripts/interop/verify-native.mjs _local/interop/consumer/dist/index.html _local/release/0.0.2/native
_local/interop/webkit-host _local/interop/consumer/dist/index.html scenario INPUT.json RESULT.json
```

Operations include `select` (text, occurrence and relative from/to offsets), `find`, `insertText`, `format`, `keyDown`, `paste`, `snapshot`, `save`, `reopen`, `load`, `reload`, `export`, `insertFootnote`, `navigateFootnote` and `editReferenceDefinition`. A `select` operation can restrict its search with a DOM `selector`. Keyboard modifiers use the facade's `metaKey`, `ctrlKey`, `altKey` and `shiftKey` fields. `save` captures a fresh snapshot; `reopen` loads those saved bytes with a new generation.

Name a result with `name`, then assert it using `{ "op": "assert", "name": "saved", "path": "text", "includes": "expected" }`. Assertions accept `equals`, `includes` or `excludes`; omit `name` to assert the current `snapshot`/`html`/`selection`/`error` capture. An empty path addresses the complete named result. Set `expectedError` on an operation to require an error code or message. Partial export fixtures can use a `selection` object instead of the original hard-coded bold paragraph.

The bundled 0.0.2 scenarios check source spelling, shared destination edits, collapsed link expansion, selected definition export, multiline footnote edits/navigation, collision paste, undo, save/reopen, stale generations and literal TXT. They do not touch the native clipboard or prove destination application compatibility; run the disposable destination probes separately. The summary records bundle and host hashes beside the input/result files.

For 0.0.3, pass the version as the final argument:

```sh
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.3
```

For 0.0.4, build a separate consumer from its candidate archive and pass `0.0.4` as the final argument. The suite retains the earlier scenarios and adds Mermaid source editing, undo, save/reopen, replacement, whole-document and diagram-only/mixed selection copying, flowchart/sequence PNG assets, invalid/unsafe-source fallback and literal TXT. Native clipboard destination tests remain separate.

```sh
node scripts/interop/build-consumer.mjs CANDIDATE_ARCHIVE _local/interop/consumer-0.0.4
swiftc -target arm64-apple-macos27.0 scripts/interop/WebKitHost.swift -o _local/interop/webkit-host-0.0.4
node scripts/interop/verify-native.mjs _local/interop/consumer-0.0.4/dist/index.html _local/release/0.0.4/native _local/interop/webkit-host-0.0.4 0.0.4
```

`awaitDOM` waits for a selector to reach the requested `count` (default 1), with a bounded `timeout` in milliseconds (default 15000). `selectBlocks` creates a native DOM selection from `fromSelector` through `toSelector`, with optional zero-based `fromOccurrence`/`toOccurrence`. `security` records external resource loads, active embedded elements and the unsafe callback sentinel. Assertions can use `truthy` for errors whose exact wording belongs to the renderer. Portable image bytes in result JSON use `bytesBase64`, including each diagram's image and ordinary clipboard image slots.

This retains the 0.0.2 scenarios and adds callout folding, highlight formatting, comment visibility and editing, source/ordinary-copy separation, reference-provenance privacy and native print checks. Additional operations inspect DOM attributes/styles, send DOM keys, set comment visibility and host keymaps, and paste a named frozen export. `assert.equalsFrom` compares against a named result without duplicating its bytes.

`print` mode uses the WKWebView native print operation with hidden panels to save a disposable PDF beside its JSON result. PDFKit extracts its text for assertions that comments and editor controls are absent and collapsed callout bodies are included. Build the host against the current macOS SDK before running it.

For 0.0.5, build a fresh consumer from the exact archive and pass `0.0.5`. The suite retains earlier scenarios and exercises the public `printableSnapshot(expectedGeneration?)` API, immediate unsaved edits, stale generations, composition, pending image imports, missing or corrupt image bytes, and document/revision changes during an awaited image export.

```sh
node scripts/interop/build-consumer.mjs CANDIDATE_ARCHIVE _local/interop/consumer-0.0.5
swiftc -target arm64-apple-macos27.0 scripts/interop/WebKitHost.swift -o _local/interop/webkit-host-0.0.5
node scripts/interop/verify-native.mjs _local/interop/consumer-0.0.5/dist/index.html _local/release/0.0.5/native _local/interop/webkit-host-0.0.5 0.0.5
```

`printable` captures the public API result, including its document identity, generation, revision, standalone HTML, styles, assets and warnings. Result JSON serialises asset bytes as `bytesBase64` and records decoded dimensions and exact correspondence to the HTML's image URLs. `insertPrintable` inserts text and captures immediately, before the fixture's usual settling delay. `imageFixture` creates a local PNG at the specified `reference`, `width` and `height`. `imageExport`, `startPrintable` and `finishPrintable` hold or fail an adapter export to exercise asynchronous races. `startImagePaste` and `finishImagePaste` hold an import; `composition` dispatches the corresponding composition event.

The native `printable` mode reads the named `printable` result (or `printableName`), loads its captured HTML into a **separate WKWebView**, disables content JavaScript, waits for all portable images to decode, and prints asynchronously using the native print operation. It does not print the live editor DOM. The main fixture replaces the live document after capture to verify that the PDF contains the frozen document. Native PDF checks cover multiple pages, the final sentinel, complete folded content, tables, highlights, references and footnotes, excluded revealed comments and controls, image XObject streams, image placements within page bounds, and paper geometry. Placement bounds measure containment within the PDF MediaBox; they do not model arbitrary clipping paths. The portrait fixture also rasterizes each PDF page through CoreGraphics and requires all three equal authored color bands to cover the complete drawn image area on one page. This detects clipping that image resource counts or page bounds alone can miss. Invalid Mermaid retains its source with a `diagram-unavailable` warning; TXT prints escaped literal source.

These probes create disposable PDFs and can affect macOS print preferences. Run them within a wrapper that saves the clipboard and scoped print preferences, restores both on every exit, compares their original bytes independently, and retains restoration proofs. Keep private backups in ignored storage and remove them only after verification. Package-native tests do not establish compatibility with consumer app hosts or clipboard destinations; run those isolated checks separately.

For 0.0.6, pass `0.0.6` as the final argument. The suite retains the earlier scenarios and checks row/header movement, whole-column alignment, stable text and numeric sorting, rich cell preservation, spreadsheet growth, HTML cell formatting, rejected malformed input, mixed unsupported tables with private comments, undo, copying and save/reopen. `table` calls the public facade with `command` and optional `options`; `tableCells` captures ordered cell content and alignment. `domPaste` dispatches a DOM clipboard event with the supplied MIME `types`. It exercises the browser event handler; separate app-host checks must exercise the native Paste action and real pasteboard.

For 0.0.7, pass `0.0.7`. The suite also checks complete raw source, spelling-only changes, history across editing modes, native textarea input and composition, literal source paste, partial-comment copy privacy, TXT, Unicode replacement, literal replacement tokens, multiline replacement, structured boundaries, failed table replacement, ordered headings, folded-heading navigation and stale entries after edits, mode changes, reloads and document switching.

`editingMode`, `replaceSource`, `undo`, `redo`, `replace`, `replaceAll`, `headings` and `navigateHeading` call the public facade. Heading navigation round-trips entries through JSON to exercise a native bridge. `sourceInput` dispatches a textarea input event; `sourceState` records the textarea caret and focus. `surface` checks actual textarea and formatted-wrapper visibility after document loading or reloading. CRLF fixtures distinguish normalised DOM caret positions from exact source and TXT clipboard bytes. `domPaste`, `activeKeyDown` and `composition` target the active editing surface. Real source Paste still requires the separate protected app-host checks.
