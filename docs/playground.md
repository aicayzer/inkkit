# Development playground

The playground is an internal fixture and inspection tool. It uses the public facade and reusable controlled image adapters. It is not a separate showcase or a client app, and its automation helpers are not package exports.

```sh
pnpm dev
pnpm build:playground
```

Vite prints the local URL; it does not open a browser. The build produces the single-file offline page `_local/playground/index.html`. Select a fixture and a minimal or rich configuration, then edit, change modes, invoke host controls or inspect observations. The minimal configuration omits optional adapters and input overrides; rich adds the controlled image adapter and explicit input preferences. In the `linked-files` fixture, rich also enables controlled file and wiki-link adapters; minimal leaves the optional syntax literal.

## Reproducible fixtures

Use query parameters on the Vite URL, for example:

```text
/?fixture=untidy&configuration=rich&adapter=hold
/?fixture=tables&configuration=minimal&editable=false&editors=2
/?fixture=linked-files&configuration=rich
```

| Parameter       | Values                                                                                                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture`       | `everyday`, `tables`, `references` (footnotes and callouts), `mermaid`, `images`, `txt`, `unsupported`, `untidy`, `native-search` (Unicode, folding, embeds and long scrolling content), `linked-files` (wiki links, named/path images, audio, video, PDF and file cards). Default: `everyday`. |
| `configuration` | `minimal`, `rich`. Default: `rich`.                                                                                                                                                                                                                                                             |
| `adapter`       | `normal` (success), `reject` (failure), `hold` (manually released delay). Default: `normal`. Applies when the rich adapter is present.                                                                                                                                                          |
| `editable`      | `false` starts read-only; otherwise editable.                                                                                                                                                                                                                                                   |
| `editors`       | `2` adds a separate read-only editor beside unrelated host content for style/focus checks.                                                                                                                                                                                                      |
| `files`         | `true` enables the controlled file and wiki-link adapters on other fixtures when `configuration=rich`. The `linked-files` fixture enables them automatically in rich mode.                                                                                                                      |

Unknown fixture, configuration or adapter values fail explicitly. The fixture selectors switch the loaded content/configuration. **Reset fixture** recreates the selected configuration and original content, advances generation, clears observations/diagnostics and disposes pending fixture resources. **Replace document** tests replacement separately. The adapter selector changes deterministic behaviour; **Release image operations** completes a held import/export without timing-dependent sleeps.

Observations contain the complete snapshot or an explicit snapshot error, selected text, editing mode, editability, command availability or its error, adapter events, diagnostics and the last operation result. A failed snapshot is not an unchanged document. Observe these values without reaching into Milkdown internals.

The linked-file fixture uses local disposable resources and opaque references. `fileMode` selects `normal`, `reject`, `hold` or `corrupt`; `fileRelease` releases held resolution/export work and `fileEvents` captures host callbacks and cancellation. Inspect missing/error states and Retry through normal DOM controls. The fixture covers named and path sizing, shared undo, read-only media controls, lifecycle cancellation and each kind's clipboard/print representation. These controls belong to the development fixture, not the package API.

Development-only `window.inkkitPlayground` exposes `fixtures`, `configurations`, `reset(fixture?, configuration?)`, `selectFixture(fixture?, configuration?)`, `replaceDocument(text, format, documentId?)`, `operation(name, args?)`, `observe()` and controlled `adapter.setMode(kind, mode)` / `adapter.release(kind)` helpers. `operation` delegates to public editor operations; its names and arguments are defined in `playground/main.ts`. Supported operations include formatting, tables, mode/editability/input policies, history, source replacement, find/replace, headings, readable-text snapshots/ranges, geometry, viewport insets, clipboard/printable capture and held image paste. Browser tests use this boundary plus ordinary DOM locators.

## Browser selection and diagnostics

Use Playwright's [standard CLI](https://playwright.dev/docs/test-cli), reports and [trace viewer](https://playwright.dev/docs/trace-viewer). List tests before selecting a regression. Keep the small Chromium smoke as the candidate baseline, then select cases for the changed contract; do not multiply every fixture, configuration, adapter and browser.

```sh
pnpm exec playwright test --list
pnpm exec playwright test --project=chromium --grep @smoke
pnpm exec playwright test --project=chromium --grep @host-controls
pnpm exec playwright test --project=chromium --grep @native-search
pnpm exec playwright test --project=chromium --grep @linked-files
pnpm exec playwright test --project=webkit --grep @host-controls
pnpm exec playwright show-report _local/playwright/report
pnpm exec playwright show-trace PATH_TO_TRACE_ZIP
```

The configured report is `_local/playwright/report`, individual artefacts are in `_local/playwright/results`, and machine-readable results are `_local/playwright/results.json`. Failure evidence includes screenshots, structured observations and traces. Keep failed evidence alongside the reviewed commit and command. The controlled failure is excluded by the default configuration. Select it explicitly, overriding that exclusion, to demonstrate reporting:

```sh
pnpm exec playwright test --project=chromium --grep @intentional-failure --grep-invert '^$'
```

Record its expected non-zero result separately from passing smoke/regression evidence, and retain that run's artefacts before another run overwrites the configured output. See [development](development.md#bounded-verification) for check triggers and confidence limits, and the [native runner](../scripts/interop/README.md) for selected WKWebView checks.
