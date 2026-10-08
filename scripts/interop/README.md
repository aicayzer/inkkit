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
