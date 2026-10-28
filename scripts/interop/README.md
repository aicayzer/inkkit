# Native WKWebView checks

The native runner checks the exact packed Inkkit candidate in a disposable WKWebView. It does not prove a consumer app's storage, clipboard integration or permissions. [Development](../../docs/maintainers/development.md#bounded-verification) is the authoritative check-selection policy.

**The native host opens visible windows and can take keyboard focus.** Tell the person before running it on an active desktop. Build and inspect selections without launching the host first.

## Build and run

Use the current Node.js and pnpm versions from the repository. The consumer builder needs network access to install its build tools and the candidate's dependencies. It requires an explicit archive and uses the archive hash in the installed filename to prevent stale same-version installations.

```sh
node scripts/interop/build-consumer.mjs CANDIDATE_ARCHIVE _local/interop/consumer
swiftc -target arm64-apple-macos27.0 scripts/interop/WebKitHost.swift -o _local/interop/webkit-host
node scripts/interop/verify-native.mjs --list --group core --group host-controls
node scripts/interop/verify-native.mjs _local/interop/consumer/dist/index.html _local/interop/results _local/interop/webkit-host --group core --group host-controls
```

The runner has three optional positional arguments: bundle, result directory and host binary, with the paths above as defaults except that results default to `_local/interop/regression`. There is no fixture-version argument. It runs the current scenario set and reads the installed package version, entry point and archive hash from `consumer-evidence.json` beside the bundle. A missing sidecar or mismatched bundle hash fails before a host launches. Keep the sidecar with the bundle.

To check the entry without Pele and DOMPurify, build a second consumer with the literal fourth command-line argument `core` and run its core group:

```sh
node scripts/interop/build-consumer.mjs CANDIDATE_ARCHIVE _local/interop/core-consumer core
node scripts/interop/verify-native.mjs _local/interop/core-consumer/dist/index.html _local/interop/core-results _local/interop/webkit-host --group core
```

Repeat `--group` and `--scenario` to select a union. No selector means `core`; `--list` needs neither a bundle nor a host. Unknown, empty or rejected selections fail. Groups are `core`, `references`, `tables`, `source`, `diagrams`, `print`, `host-controls`, `native-search`, `layout`, `linked-files`, `media`, `portable-files`, `integration` and `legacy`, plus the native probe groups below. The legacy group excludes host, native, container and intentional-failure scenarios; it is not an exhaustive suite.

Core covers source preservation and shared source/formatted history, including three source inputs followed by one undo and redo. Host controls include the native bridge insertion methods, read-only transitions, input preferences, stale generations and delayed imports. Resource groups use local fixture resources and record callbacks; they never open a real user's files.

The media group checks trusted keyboard image resizing and PDF focus traversal. PDF checks exercise Tab and Shift+Tab, then use Option+Tab to include every control under the macOS default keyboard navigation setting. `nativeInput` accepts an optional `selector` inside the editor for control input; `controlState` records that control's focus, role, value and visibility. These operations exercise the rendered controls rather than a host's own toolbar.

`evidence.json` records the package version, entry, archive/bundle/host hashes, exact selection, individual inputs/results, failed steps and page errors. An uncaught page error or unhandled rejection fails the scenario immediately, writes its error and restores the pasteboard. A successful process exit alone is not a pass.

## Fixture operations

An input supplies `source`, optional `format`, `documentId`, `configuration`, `historyClock` and `operations`. Name a result with `name`; assertions can read a named result or the current capture. The consumer's switch in [consumer/main.ts](consumer/main.ts) defines the fields for each operation.

| Area                      | Operations                                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document and history      | `capture`, `historyBoundary`, `editingMode`, `replaceSource`, `undo`, `redo`, `insertText`, `format`, `table`, `tableCells`, `snapshot`, `save`, `reopen`, `load`, `reload`, `insertFootnote`, `navigateFootnote`, `editReferenceDefinition`                                      |
| Native bridge insertion   | `insertImages`, `insertPaths`, `pasteAsPlainText`                                                                                                                                                                                                                                 |
| Selection and search      | `textSnapshot`, `selectTextRange`, `replaceTextRange`, `select`, `selectContents`, `domSelectAll`, `selectBlocks`, `find`, `replace`, `replaceAll`, `headings`, `navigateHeading`                                                                                                 |
| Viewport and layout       | `revealTextRange`, `textRangeRects`, `textRangesRects`, `rangeGeometry`, `setViewport`, `viewportState`, `layout`                                                                                                                                                                 |
| Focus, policy and input   | `focus`, `hostFocus`, `nativeInput`, `editable`, `textInput`, `commandState`, `inputAttributes`, `composition`, `domKeyDown`, `taskMarkerClick`, `click`, `setKeymap`, `formattedInput`, `activeKeyDown`, `keyDown`                                                               |
| Source surface            | `sourceInput`, `sourceState`, `selectSourceRange`, `surface`, `sourceViewport`, `sourceScroll`                                                                                                                                                                                    |
| Clipboard and printing    | `nativeClipboard`, `domCopy`, `startPrintable`, `finishPrintable`, `insertPrintable`, `printable`, `domPaste`, `pasteExport`, `paste`, `export`                                                                                                                                   |
| Images and files          | `imageFixture`, `fileState`, `fileContextMenu`, `fileMode`, `fileRelease`, `fileEvents`, `fileAbortCount`, `startFileOutput`, `finishFileOutput`, `fileResize`, `imageImport`, `imageExport`, `startImagePaste`, `cancelPendingImports`, `releaseImageImport`, `finishImagePaste` |
| Diagnostics and lifecycle | `pageError`, `mountSecond`, `secondState`, `awaitDOM`, `security`, `dom`, `setCommentsVisible`, `removeDOM`, `acknowledgeError`, `assert`                                                                                                                                         |

For fixtures that require separate history steps, `historyClock: true` fixes `Date.now` before loading the scenario. `historyBoundary` advances it by 1,000 ms and records the before/after values. The original function is restored on success or failure. Timers, native events, rendering and `performance.now` remain live. This fixture mechanism controls both formatted and source history; it is not a public editor API. Do not use it for performance measurements or place it between keys that must share a history step. Other operation settling is unchanged.

Assertions accept `equals`, `includes`, `excludes`, `truthy` and `equalsFrom: {name, path}`. An empty path addresses a whole named result. `expectedError` requires a matching code or message. Source selections use normalized textarea UTF-16 offsets; snapshots retain authored CRLF bytes.

The host parses fixture JSON in JavaScript to preserve literal leading BOMs inside strings. `JSONSerialization` can remove them before the editor receives its input, including from assertion expectations. The input fidelity probe checks scenario, load, selection and paste inputs against independent Node.js expectations, including BOMs, mixed line endings, combining characters, emoji and malformed JSON. It uses a small offline page without the editor and does not access the clipboard:

```sh
node scripts/interop/verify-input.mjs _local/interop/webkit-host _local/interop/input-fidelity
```

Facade calls travel through JSON-compatible inputs and returned values. DOM helpers exercise event handling but do not establish trusted native input. The native keyboard helper posts explicit AppKit events and requires corresponding trusted DOM key events and expected saved bytes; its composition variant uses WebKit's text input client. Neither establishes a particular hardware keyboard, input method candidate window or layout.

For an independently retained failure demonstration:

```sh
node scripts/interop/verify-native.mjs BUNDLE _local/interop/controlled-failure HOST_BINARY --scenario intentional-assertion-failure
node scripts/interop/verify-native.mjs BUNDLE _local/interop/page-error HOST_BINARY --scenario intentional-page-error
```

Both commands must fail with actionable evidence. Intentional failures are excluded from every group and never count as passing verification.

## Clipboard, output and resource checks

The host saves and restores the general pasteboard for native clipboard operations, including failure exits. For external application checks, use the helper to preserve every representation and independently verify restoration before deleting private backups:

```sh
swiftc scripts/interop/Clipboard.swift -o _local/interop/clipboard
_local/interop/clipboard save _local/interop/previous-pasteboard.json
# Run the one authorized disposable transfer.
_local/interop/clipboard restore _local/interop/previous-pasteboard.json
```

External-app checks require an identified changed contract or reproduced destination-specific bug, one application and one transfer direction. Use disposable documents; never send messages or touch production notes. A denied recording or accessibility permission is a blocker, not a reason to bypass it. `AX.swift` reads only a window matching its title argument. `cdp.py` requires an explicitly configured debugging endpoint and a disposable profile.

Printable checks use frozen portable HTML in a separate WebKit view with JavaScript disabled. They wait for images to decode before native printing. Checks cover PDF pages and text, excluded controls and private comments, embedded image streams, page-contained placements and portrait color-band rasters. Containment does not prove every possible PDF clipping path.

Print groups can change macOS print preferences. Run them with a wrapper that saves the clipboard and scoped print preferences, restores both on every exit and independently compares the original bytes. Retain restoration evidence. Synthetic composition checks prove guards and transitions, not full IME interoperability. Hidden media must release playback resources; a fixture Open callback does not prove native file opening.

## Selected native probes

These cases share the runner, evidence format and selection rules above. They retain trusted AppKit input or an AppKit drag destination; browser scenarios do not replace them.

| Group                        | Cases | Contract                                                                                                                                                  |
| ---------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-literal-paste`       |     4 | Native pasteboard read through host-mediated plain paste, trusted typing, exact lines/marks, history and restoration.                                     |
| `native-paste-caret`         |     6 | Public paste followed by trusted typing into terminal blocks and authored or reader-controlled folds.                                                     |
| `native-soft-break-spaces`   |     8 | Trusted space and beforeinput around soft breaks, with LF/CRLF and paragraph/quote variants.                                                              |
| `native-source-redo`         |     2 | Trusted source undo/type/undo discards obsolete redo while retaining older history.                                                                       |
| `native-structural-deletion` |     6 | Three trusted Backspaces preserve exact source, revision and authored reference tails.                                                                    |
| `native-image-drag`          |     2 | Block/inline image drag exposes readable text/HTML to an AppKit destination, without private references or bytes; refused drop preserves source/revision. |

`native-editing` selects the first five groups (26 cases). Case names begin with their group name. Use `--list` to inspect exact names and required tools before launching a host. Native groups are opt-in and do not expand the default core or legacy selection.

Build the clipboard helper for literal paste and the specialised image-drag host for image drag:

```sh
swiftc scripts/interop/Clipboard.swift -o _local/interop/clipboard
swiftc -target arm64-apple-macos27.0 scripts/interop/ImageDragHost.swift -o _local/interop/image-drag-host
node scripts/interop/verify-native.mjs --list --group native-editing --group native-image-drag
node scripts/interop/verify-native.mjs BUNDLE OUTPUT HOST_BINARY --archive CANDIDATE_ARCHIVE --group native-editing --clipboard _local/interop/clipboard
node scripts/interop/verify-native.mjs BUNDLE DRAG_OUTPUT HOST_BINARY --archive CANDIDATE_ARCHIVE --group native-image-drag --image-drag-host _local/interop/image-drag-host
```

The named `--archive` option additionally checks the candidate archive against the consumer sidecar; the existing three positional arguments are unchanged. Missing tools fail before any host launches. Image drag uses its own host and the drag pasteboard only. It does not use the general clipboard or establish accepted internal-drop behaviour; `verify-drop-indicator.mjs` retains that separate coverage.

For literal paste, the runner additionally saves the general pasteboard before launching cases, restores it in `finally`, saves it again and compares all representations byte for byte. Restoration failure fails the run and retains private recovery files. A pre-existing recovery backup prevents another run from overwriting it. The native host's own restoration remains in place. Do not publish private pasteboard backups with evidence.

The runner removes each selected case's stale result before launch and retains input, raw result, logs, native-event records, validation failures and actual per-case host hashes. A successful process exit is insufficient. Each case must pass its assertions and specialised event or destination checks; all selected cases must finish. Run one native GUI job at a time.

The former `verify-literal-paste.mjs`, `verify-paste-caret.mjs`, `verify-soft-break-spaces.mjs`, `verify-source-redo.mjs`, `verify-structural-deletion.mjs` and `verify-image-drag.mjs` commands are replaced by their corresponding groups above. `DragHost.swift` is retained as `ImageDragHost.swift`. Existing archived evidence remains valid under its original filenames.

## Dedicated probes

Build the host and exact candidate consumer with the recipe above. These probes retain their own archive, bundle and host evidence. Their source documents their selection and any additional arguments.

| Script                                                                                                | Purpose                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `verify-comment-clipboard.mjs CANDIDATE_ARCHIVE BUNDLE OUTPUT_DIRECTORY HOST_BINARY CLIPBOARD_BINARY` | Native and host-mediated comment movement, preserved source and clipboard restoration.                       |
| `verify-terminal-blocks.mjs CANDIDATE_ARCHIVE BUNDLE OUTPUT_DIRECTORY HOST_BINARY`                    | Trusted keyboard input after terminal blocks and source replacement.                                         |
| `verify-link-typing.mjs CANDIDATE_ARCHIVE BUNDLE OUTPUT_DIRECTORY HOST_BINARY`                        | Link boundaries, shared history, reopening and native composition.                                           |
| `verify-find-delete.mjs CANDIDATE_ARCHIVE BUNDLE OUTPUT_DIRECTORY HOST_BINARY`                        | Find followed by immediate arrow/delete input with event timings.                                            |
| `verify-long-source.mjs CANDIDATE_ARCHIVE BUNDLE OUTPUT_DIRECTORY HOST_BINARY`                        | Trusted source typing on 10,000 paragraphs after entry, undo, redo and paste; exact bytes and frame latency. |
| `verify-reference-raw.mjs CANDIDATE_ARCHIVE BUNDLE OUTPUT_DIRECTORY HOST_BINARY`                      | Exact authored references in adapter callbacks across edits and reopening.                                   |
| `verify-selection-appearance.mjs CANDIDATE_ARCHIVE OUTPUT_DIRECTORY [formatted,source,txt]`           | Active/inactive selection, native focus, two editors and gap-cursor presentation.                            |
| `verify-drop-indicator.mjs CANDIDATE_ARCHIVE BUNDLE OUTPUT_DIRECTORY DROP_HOST_BINARY`                | Trusted native drag exit/reentry, insertion and history.                                                     |

The drop probe uses `DropIndicatorHost.swift`, built like the normal host, and needs permission to post native mouse events. It uses the drag pasteboard, not the general clipboard. The selection probe creates a native text field and a second window; WKWebView snapshots omit native textarea selection, so source/TXT pixel recordings alone do not prove its paint. Report these limits with the evidence.

The long-source probe gates trusted input and exact saved/reopened bytes. It also reports each latency sample and whether all phase medians meet issue #206's 35 ms target. Its correctness exit status does not establish performance acceptance; inspect `performanceTargetMet` separately and retain an unmet target as outstanding work.
