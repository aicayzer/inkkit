# Development playground

The playground is an internal fixture and inspection tool. It uses the public facade and reusable controlled image adapters. It is not a separate showcase or a client app, and its automation helpers are not package exports.

```sh
pnpm dev
pnpm build:playground
```

Vite prints the local URL; it does not open a browser. The build produces the single-file offline page `_local/playground/index.html` (about 6 MB with Mermaid). If the page is about 1 MB, Mermaid was dropped and diagrams render as code: `pnpm test:built-playground` opens the built page as a file and fails in that case. Select a fixture and a minimal or rich configuration, then edit, change modes, invoke host controls or inspect observations. The minimal configuration omits optional adapters and input overrides; rich adds the controlled image adapter and explicit input preferences. In the `linked-files` fixture, rich also enables controlled file and wiki-link adapters; minimal leaves the optional syntax literal.

## Reproducible fixtures

Use query parameters on the Vite URL, for example:

```text
/?fixture=untidy&configuration=rich&adapter=hold
/?fixture=tables&configuration=minimal&editable=false&editors=2
/?fixture=linked-files&configuration=rich
/?generate=paragraphs:4000&observe=false
```

Changing a fixture, configuration, image adapter, **Linked file adapters**, **Second read-only editor**, **Make read-only**, **Observe** or **Generate document** on the page writes that choice to the address, so you can copy the address to share the state. Default values are left out. Reloading, or **Reset fixture**, keeps these choices.

| Parameter       | Values                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture`       | `everyday`, `tables`, `table-edge-cases` (`<br>`, empty cells, uneven rows and an image in a cell), `empty-code-fences`, `diagram-annotations` (class and state diagram annotations), `references` (footnotes and callouts), `mermaid`, `images`, `txt`, `unsupported`, `untidy`, `native-search` (Unicode, folding, embeds and long scrolling content), `linked-files` (wiki links, named/path images, audio, video, PDF and file cards). Default: `everyday`. |
| `configuration` | `minimal`, `rich`. Default: `rich`.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `adapter`       | `normal` (success), `reject` (failure), `hold` (manually released delay). Default: `normal`. Applies when the rich adapter is present.                                                                                                                                                                                                                                                                                                                          |
| `editable`      | `false` starts read-only; otherwise editable.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `editors`       | `2` adds a separate read-only editor beside unrelated host content for style/focus checks.                                                                                                                                                                                                                                                                                                                                                                      |
| `files`         | `true` enables the controlled file and wiki-link adapters on other fixtures when `configuration=rich`. The `linked-files` fixture enables them automatically in rich mode.                                                                                                                                                                                                                                                                                      |
| `generate`      | `paragraphs:<count>` (1 to 100000) replaces the fixture text with a generated Markdown document of that many blocks, for example `paragraphs:4000`. A heading starts every 50th block; the rest are paragraphs with bold, code and links.                                                                                                                                                                                                                       |
| `observe`       | `true` starts with Observe on. See [Observation and timing](#observation-and-timing).                                                                                                                                                                                                                                                                                                                                                                           |

An unknown fixture, configuration, adapter or generator is reported in an alert at the top of the page, and the playground opens with the default for that parameter. The alert clears at the next reset, such as selecting a fixture. The fixture selectors switch the loaded content/configuration. **Reset fixture** recreates the editor with the selected configuration and the current choices in the address, and loads the fixture text, or the generated document when `generate` is set. It advances generation, clears observations/diagnostics and disposes pending fixture resources. **Replace document** tests replacement separately. The adapter selector changes deterministic behaviour; **Release image operations** completes a held import/export without timing-dependent sleeps.

## Observation and timing

**Observe** is off by default. Reading the complete snapshot, readable text and command state after every change, and writing them to the page, costs time that grows with the document and distorts the timing you are trying to read. With Observe off, the status line shows the document, generation and revision, the buttons follow the editor, and the **Structured observations** panel says that observation is off. With Observe on, the panel is refreshed after typing pauses for 150 ms, and the status line also shows whether the document has unsaved changes. `window.inkkitPlayground.observe()` always returns the complete observation, whether or not Observe is on, so browser tests do not need Observe on.

The timing readout under the status line shows the last, median and 95th percentile time, in milliseconds, from a key press to the next frame, over the last 100 printable, Backspace, Delete and Enter keys. The editor serializes and caches the Markdown on every change, so the cost of an edit, including saving it, is inside this key timing. The figures are approximate and for comparing runs on one machine; **Reset fixture** clears them. `observe().timings` returns the same numbers. To compare a large document, open `/?generate=paragraphs:1500`, choose **Edit source**, type, and read the figures.

The status line shows the message of the last error until the next edit or document load; the diagnostics list in the observation keeps every error until **Reset fixture**.

**Paste as Plain Text** pastes the content of the **Plain text to paste** box, because browsers gate `navigator.clipboard.readText()` and WebKit refuses it.

Observations contain the complete snapshot or an explicit snapshot error, selected text, editing mode, editability, command availability or its error, adapter events, diagnostics and the last operation result. A failed snapshot is not an unchanged document. Observe these values without reaching into Milkdown internals.

The linked-file fixture uses local disposable resources and opaque references. `fileMode` selects `normal`, `reject`, `hold` or `corrupt`; `fileRelease` releases held resolution/export work and `fileEvents` captures host callbacks and cancellation. Inspect missing/error states and Retry through normal DOM controls. The fixture covers named and path sizing, shared undo, read-only media controls, lifecycle cancellation and each kind's clipboard/print representation. These controls belong to the development fixture, not the package API.

Development-only `window.inkkitPlayground` exposes `fixtures`, `configurations`, `reset(fixture?, configuration?)`, `selectFixture(fixture?, configuration?)`, `replaceDocument(text, format, documentId?)`, `operation(name, args?)`, `observe()`, `timings()`, `focusSettled()` and controlled `adapter.setMode(kind, mode)` / `adapter.release(kind)` helpers. `operation` delegates to public editor operations; its names and arguments are defined in `playground/main.ts`. An operation that moves focus into the editor returns about 20 ms later, after ProseMirror's own post-focus selection check, so a caret key pressed next is not undone; `focusSettled()` waits the same way after a click. Supported operations include formatting, tables, mode/editability/input policies, history, source replacement, find/replace, headings, readable-text snapshots/ranges, geometry, viewport insets, clipboard/printable capture and held image paste. Browser tests use this boundary plus ordinary DOM locators.

## Browser selection and diagnostics

Use Playwright's [standard CLI](https://playwright.dev/docs/test-cli), reports and [trace viewer](https://playwright.dev/docs/trace-viewer). List tests before selecting a regression. CI runs the whole suite in Chromium and WebKit. Locally, start from the small Chromium smoke, then select cases for the changed contract; do not multiply every fixture, configuration, adapter and browser.

```sh
pnpm exec playwright test --list
pnpm exec playwright test --project=chromium --grep @smoke
pnpm exec playwright test --project=chromium --grep @host-controls
pnpm exec playwright test --project=chromium --grep @native-search
pnpm exec playwright test --project=chromium --grep @linked-files
pnpm exec playwright test --project=chromium --grep @playground-tools
pnpm exec playwright test --project=webkit --grep @playground-tools
pnpm exec playwright test --project=webkit --grep @host-controls
pnpm exec playwright show-report _local/playwright/report
pnpm exec playwright show-trace PATH_TO_TRACE_ZIP
```

Playwright serves the playground on port 4178. Set `INKKIT_PLAYGROUND_PORT` to another port so that worktrees can run tests at the same time, for example `INKKIT_PLAYGROUND_PORT=4179 pnpm exec playwright test`.

The configured report is `_local/playwright/report`, individual artefacts are in `_local/playwright/results`, and machine-readable results are `_local/playwright/results.json`. Failure evidence includes screenshots, structured observations and traces. Keep failed evidence alongside the reviewed commit and command. The controlled failure is excluded by the default configuration. Select it explicitly, overriding that exclusion, to demonstrate reporting:

```sh
pnpm exec playwright test --project=chromium --grep @intentional-failure --grep-invert '^$'
```

Record its expected non-zero result separately from passing smoke/regression evidence, and retain that run's artefacts before another run overwrites the configured output. See [development](development.md#bounded-verification) for check triggers and confidence limits, and the [native runner](../scripts/interop/README.md) for selected WKWebView checks.
