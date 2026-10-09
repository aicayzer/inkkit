# Development playground

The playground is an internal fixture and inspection tool for the **unpublished 0.0.8 candidate**. It uses the public facade and reusable controlled image adapters. It is not a separate showcase or a client app, and its automation helpers are not package exports.

```sh
pnpm dev
pnpm build:playground
```

Vite prints the local URL; it does not open a browser. The build produces the single-file offline page `_local/playground/index.html`. Select a fixture and a minimal or rich configuration, then edit, change modes, invoke host controls or inspect observations. The minimal configuration omits images and input overrides; rich adds the controlled image adapter and explicit input preferences.

## Reproducible fixtures

Use query parameters on the Vite URL, for example:

```text
/?fixture=untidy&configuration=rich&adapter=hold
/?fixture=tables&configuration=minimal&editable=false&editors=2
```

| Parameter       | Values                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture`       | `everyday`, `tables`, `references` (footnotes and callouts), `mermaid`, `images`, `txt`, `unsupported`, `untidy`. Default: `everyday`. |
| `configuration` | `minimal`, `rich`. Default: `rich`.                                                                                                    |
| `adapter`       | `normal` (success), `reject` (failure), `hold` (manually released delay). Default: `normal`. Applies when the rich adapter is present. |
| `editable`      | `false` starts read-only; otherwise editable.                                                                                          |
| `editors`       | `2` adds a separate read-only editor beside unrelated host content for style/focus checks.                                             |

Unknown fixture, configuration or adapter values fail explicitly. The fixture selectors switch the loaded content/configuration. **Reset fixture** recreates the selected configuration and original content, advances generation, clears observations/diagnostics and disposes pending fixture resources. **Replace document** tests replacement separately. The adapter selector changes deterministic behaviour; **Release image operations** completes a held import/export without timing-dependent sleeps.

Observations contain the complete snapshot or an explicit snapshot error, selected text, editing mode, editability, command availability or its error, adapter events, diagnostics and the last operation result. A failed snapshot is not an unchanged document. Observe these values without reaching into Milkdown internals.

Development-only `window.inkkitPlayground` exposes `fixtures`, `configurations`, `reset(fixture?, configuration?)`, `selectFixture(fixture?, configuration?)`, `replaceDocument(text, format, documentId?)`, `operation(name, args?)`, `observe()` and controlled `adapter.setMode(kind, mode)` / `adapter.release(kind)` helpers. `operation` delegates to public editor operations; its names and arguments are defined in `playground/main.ts`. Supported operations include formatting, tables, mode/editability/input policies, history, source replacement, find/replace, headings, clipboard/printable capture and held image paste. Browser tests use this boundary plus ordinary DOM locators.

## Browser selection and diagnostics

Use Playwright's [standard CLI](https://playwright.dev/docs/test-cli), reports and [trace viewer](https://playwright.dev/docs/trace-viewer). List tests before selecting a regression. Keep the small Chromium smoke as the candidate baseline, then select cases for the changed contract; do not multiply every fixture, configuration, adapter and browser.

```sh
pnpm exec playwright test --list
pnpm exec playwright test --project=chromium --grep @smoke
pnpm exec playwright test --project=chromium --grep @host-controls
pnpm exec playwright test --project=webkit --grep @host-controls
pnpm exec playwright show-report _local/playwright/report
pnpm exec playwright show-trace PATH_TO_TRACE_ZIP
```

The configured report is `_local/playwright/report`, individual artefacts are in `_local/playwright/results`, and machine-readable results are `_local/playwright/results.json`. Failure evidence includes screenshots, structured observations and traces. Keep failed evidence alongside the reviewed commit and command. The controlled failure is excluded by the default configuration. Select it explicitly, overriding that exclusion, to demonstrate reporting:

```sh
pnpm exec playwright test --project=chromium --grep @intentional-failure --grep-invert '^$'
```

Record its expected non-zero result separately from passing smoke/regression evidence, and retain that run's artefacts before another run overwrites the configured output. See [development](development.md#bounded-verification) for check triggers and confidence limits, and the [native runner](../scripts/interop/README.md) for selected WKWebView checks.
