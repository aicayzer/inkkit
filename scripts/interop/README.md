# Native clipboard probes

These probes distinguish a packed-package WebKit consumer from tests hosted in an app. External-app destination checks are exceptional: first identify a changed interoperability contract or a reproduced bug, then select one relevant application and direction. Do not resume the 0.0.7 return matrix. Run any authorised destination check only in a disposable desktop session, vault and documents. Do not use production notes or send a test message.

Build the offline consumer from the exact candidate archive. The builder uses an archive filename containing its SHA-256 so that replacing a candidate at the same version cannot reuse the previous package installation.

```sh
node scripts/interop/build-consumer.mjs CANDIDATE_ARCHIVE
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

These probes create disposable PDFs and can affect macOS print preferences. Run them within a wrapper that saves the clipboard and scoped print preferences, restores both on every exit, compares their original bytes independently, and retains restoration proofs. Keep private backups in ignored storage and remove them only after verification. Package-native tests do not establish compatibility with consumer app hosts or clipboard destinations. Run one isolated check only when its changed contract or reproduced bug requires it.

For 0.0.6, pass `0.0.6` as the final argument. The suite retains the earlier scenarios and checks row/header movement, whole-column alignment, stable text and numeric sorting, rich cell preservation, spreadsheet growth, HTML cell formatting, rejected malformed input, mixed unsupported tables with private comments, undo, copying and save/reopen. `table` calls the public facade with `command` and optional `options`; `tableCells` captures ordered cell content and alignment. `domPaste` dispatches a DOM clipboard event with the supplied MIME `types`. It exercises the browser event handler; separate app-host checks must exercise the native Paste action and real pasteboard.

For 0.0.7, pass `0.0.7`. The suite also checks complete raw source, spelling-only changes, history across editing modes, native textarea input and composition, literal source paste, partial-comment copy privacy, TXT, Unicode replacement, literal replacement tokens, multiline replacement, structured boundaries, failed table replacement, ordered headings, folded-heading navigation and stale entries after edits, mode changes, reloads and document switching.

`editingMode`, `replaceSource`, `undo`, `redo`, `replace`, `replaceAll`, `headings` and `navigateHeading` call the public facade. Heading navigation round-trips entries through JSON to exercise a native bridge. `sourceInput` dispatches a textarea input event; `sourceState` records the textarea caret and focus. `surface` checks actual textarea and formatted-wrapper visibility after document loading or reloading. CRLF fixtures distinguish normalised DOM caret positions from exact source and TXT clipboard bytes. `domPaste`, `activeKeyDown` and `composition` target the active editing surface. DOM source Paste does not prove native Paste. Run a protected app-host check only for a changed native clipboard contract or reproduced bug.

The distant-heading fixture checks caret visibility in the textarea viewport after navigation, find, replacement, undo and reload, including wrapped lines. `sourceViewport` mirrors computed text metrics because textarea selections expose no caret geometry; `sourceScroll` sets a controlled initial viewport without changing selection. The incomplete Mermaid fixture verifies its exact `diagram-unavailable` diagnostic before `acknowledgeError` clears it. Any other recorded diagnostic fails the acknowledgement.

## Selected checks from 0.0.8

Version 0.0.8 adds named reusable documents and controlled image adapters in `consumer/fixtures.ts`. The playground uses the same fixture resources. `minimal` omits the image adapter; `rich` supplies deterministic portable PNGs and explicit import/export rejection or manually released delays. The consumer stays an isolated package fixture, not an app integration.

Keep the original positional arguments. Selection flags can appear before or after them, and each `--group` or `--scenario` can be repeated. Selection is the union of requested groups and scenario names. Unknown options, groups and scenarios, missing values, and groups empty for the requested version fail before WKWebView launches. `--list` prints JSON without requiring bundle or host files.

```sh
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.8 --list
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.8 --group core --group host-controls
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.8 --scenario host-delayed-import-editability-epoch
```

Groups are `core`, `references`, `tables`, `source`, `diagrams`, `print`, `host-controls`, `native-search`, `layout`, `linked-files`, `media`, `portable-files`, `integration` and `legacy`. Versions from 0.0.8 default to bounded `core`; previous versions retain their historical complete suite when no selector is supplied. `legacy` retains every prior scenario available for the version. No group includes `intentional-assertion-failure`; it requires explicit selection.

The core covers reference preservation and shared source/formatted history. Host controls cover source focus/input preferences, read-only transitions and preserved history, bridge command state and stale generations, synthetic composition guards, and cancellation of manually delayed image imports after editability changes. Synthetic composition events verify guards; they do not prove complete IME interoperability.

New public-facade operations are `editable`, `textInput` and `commandState`; `inputAttributes` inspects the active DOM surface. Captures include pull-based command state, the most recent command-state event, editability and adapter events. Command state is round-tripped through JSON to check bridge-readable values. The runner records hashes, exact selection, failed steps and final errors in `evidence.json`, beside complete input/result files.

To demonstrate the diagnostic path separately from passing evidence:

```sh
node scripts/interop/verify-native.mjs BUNDLE _local/interop/controlled-failure HOST_BINARY 0.0.8 --scenario intentional-assertion-failure
```

Expect a non-zero result with the mismatched value and assertion step. Never count this expected failure as passing verification.

For candidate changes run `pnpm check`, `pnpm format:check`, `pnpm build:playground` and the small Chromium smoke. Select browser regressions for changed behaviour. Run selected native checks for changed WKWebView, focus/input, bridge, clipboard, print or resource-lifecycle boundaries. Source-only documentation changes need no native run. Print groups remain opt-in and retain the protected preferences/pasteboard procedure above. Release verification still uses the actual archive and exact-version clean offline consumer; hosted CI is distinct from local results.

## Native text and viewport checks from 0.0.9

The `native-search` fixture includes UTF-16 Unicode, comments, folded callouts, protected image labels and distant text. Select the bounded core plus `native-search` and `layout` for the changed native boundaries:

```sh
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.9 --group core --group native-search --group layout
```

Facade operations include `textSnapshot`, `selectTextRange`, `replaceTextRange`, `revealTextRange`, `textRangeRects`, `visibleTextRanges`, `setViewport` and `viewport`. `text` and `sourceName` identify a substring in a named snapshot; range operations round-trip its snapshot ID and UTF-16 offsets through JSON. Host-focus, controlled resize and second-instance helpers inspect DOM behaviour without exposing editor internals. Geometry is client CSS pixels, with supplied insets representing overlapping host chrome.

The selected cases cover Unicode replacement and shared undo; read-only/composition and stale scopes; formatted/source insets, navigation, reload focus and scroll; resize and multiple-instance independence. Browser cases additionally exercise TXT/CRLF and source composition. Synthetic composition establishes guards, not complete IME interoperability. No native clipboard exchange or print campaign is implied by these layout checks.

## Optional linked files and media from 0.0.10

The shared `linked-files` fixture contains Unicode wiki targets and aliases, escaped table separators, named and path images, audio/video fragments, a PDF, file cards, missing/error states and unsupported forms. Rich configuration enables the controlled `files` and `wikiLinks` adapters; minimal leaves optional syntax literal. Resources are local and disposable. Host actions are recorded callbacks, without storage, permissions or native opening.

```sh
node scripts/interop/build-consumer.mjs CANDIDATE_ARCHIVE _local/interop/consumer-0.0.10
swiftc -target arm64-apple-macos27.0 scripts/interop/WebKitHost.swift -o _local/interop/webkit-host-0.0.10
node scripts/interop/verify-native.mjs _local/interop/consumer-0.0.10/dist/index.html _local/release/0.0.10/native _local/interop/webkit-host-0.0.10 0.0.10 --group core --group linked-files --group media --group portable-files
```

`linked-files` selects syntax/source preservation, host wiki actions and named-image sizing with undo. Browser cases cover retry, file actions and path sizing. `media` selects read-only controls and resource release through mode/document lifecycle changes. `portable-files` selects ordinary clipboard, explicit Markdown and printable representations for all supported kinds, including descriptive nonimage fallbacks, unavailable image warnings and stale asynchronous exports. The selected native case also prints the frozen portable document to a real PDF. Select only groups relevant to a later changed boundary.

Additional fixture operations are `fileMode` (`normal`, `reject`, `hold`, `corrupt`), `fileRelease`, `fileEvents`, `fileResize` (optional cancellation), `startFileOutput` (`kind: 'print'` for printable output; otherwise clipboard export) and `finishFileOutput`. Browser regressions use `@linked-files`; native assertions retain callback identities, source snapshots and portable output alongside the usual evidence hashes. Portable-output checks exercise the captured API result; native PDF printing remains a separate selected check with the protected clipboard/preferences procedure above. A PDF view's host opening callback does not prove a native PDF viewer integration.

## Consolidation checks from 0.0.11

The `integration` group combines minimal/rich source, read-only, history, native range invalidation, same-generation reloads, TXT, multiline insertion/rejection, delayed image import/file-output cancellation and per-instance comment/privacy checks. It includes one frozen native PDF case: use the clipboard/print-preference protection described above. That case verifies explicit diagram print/copy with minimal previews disabled. Combine this group with bounded core and selected resource/layout cases; do not run every historical group.

`mountSecond` accepts optional source; `secondState` captures its snapshot and computed comment display. `fileAbortCount` records cancelled fixture callbacks. Held output must actually start before its cancellation can be claimed. These helpers remain engine fixtures and do not prove app storage or native actions.
