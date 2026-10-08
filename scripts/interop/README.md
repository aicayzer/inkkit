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
