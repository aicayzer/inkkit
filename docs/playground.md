# Development playground

The playground is a local fixture workbench for agents developing InkKit. It exercises the public facade, shares controlled adapters with the native consumer, and keeps automation independent of its UI. It is not a client app or a package export.

```sh
pnpm dev
pnpm build:playground
```

Vite prints the local URL without opening a browser. The build produces the offline single-file page `_local/playground/index.html`. No hosted service or external resource is required.

## Workspace

Choose a fixture in the searchable rail. The main editor supports formatted and source editing with shared history. The adjacent **Source snapshot** is read-only and preserves authored text exactly; **Escaped source** exposes the BOM, line endings and whitespace without changing the document. Snapshot failures appear explicitly instead of showing stale content as unchanged.

**Editor tools** contains find/replace, table operations, headings, literal paste, document reload and range/viewport probes. **Configuration** changes the minimal/rich configuration, optional file adapters and independent editor probes. These changes recreate the editor. Read-only is a runtime policy.

The inspector has four views:

- **State:** public snapshots, selection, command availability, geometry and errors.
- **Operations:** the operation catalogue, editable JSON arguments and a bounded execution history. Selecting an operation supplies its description and example. Execute it with **Run operation**.
- **Adapters:** independent image import, image export and file behaviour, release controls and host callbacks.
- **Output:** explicitly captured clipboard and printable content. HTML is displayed as text, never executed. Copying readable content and copying Markdown are separate actions.

**Download evidence** captures current setup, observations, operation history and previously captured outputs. It does not run an export or change the document. Binary data uses `{ "$binary": "base64", "data": "…", "byteLength": 123 }`. An operation result is not a test verdict; assertions belong in Playwright tests.

## Reproducible setup

```text
/?fixture=untidy&configuration=rich&adapter=hold
/?fixture=tables&configuration=minimal&editable=false&editors=2
/?fixture=images&imageImport=hold&imageExport=reject
/?fixture=linked-files&configuration=rich&fileAdapter=corrupt
```

| Parameter       | Values and default                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `fixture`       | `everyday` (default), `tables`, `references`, `mermaid`, `images`, `txt`, `unsupported`, `untidy`, `native-search`, `linked-files` |
| `configuration` | `rich` (default), `minimal`                                                                                                        |
| `adapter`       | `normal` (default), `reject`, `hold`; combined initial adapter setting                                                             |
| `imageImport`   | `normal`, `reject`, `hold`; overrides `adapter` for imports                                                                        |
| `imageExport`   | `normal`, `reject`, `hold`, `corrupt`; overrides `adapter` for image exports                                                       |
| `fileAdapter`   | `normal`, `reject`, `hold`, `corrupt`; overrides `adapter` for file resolution/exports                                             |
| `editable`      | `false` starts read-only; otherwise editable                                                                                       |
| `editors`       | `2` adds the independent read-only editor and unrelated host probes; otherwise one editor                                          |
| `files`         | `true` enables optional files/wiki links on other fixtures in rich mode                                                            |

Minimal omits optional adapters and disables code highlighting and diagram preview. Rich uses controlled image adapters and explicit text-input preferences. Rich enables file/wiki adapters automatically for `linked-files`.

Unknown fixture, configuration and adapter values produce an observable error. The UI and `configure()` can recover from invalid initial setup. Effective settings are reflected in the URL. **Copy setup link** reproduces starting conditions, not edits or interaction history. No hidden settings are persisted in local storage.

**Reset fixture** reloads original fixture content under the current effective setup, advances generation, clears session evidence and disposes old fixture resources. Overlapping resets are serialised; superseded work cannot publish into the final session. **Replace document** exercises document replacement separately. Release controls unblock held adapter work. Changing an adapter mode also releases its existing gate, following the shared fixture contract. Do not use sleeps to guess completion.

## Automation boundary

`window.inkkitPlayground` is published before mounting. Its lifecycle is `initialising`, `resetting`, `ready` or `error`. Ready means the editor and document are loaded; it does not imply that media or exports have finished. Poll the particular operation, adapter event or DOM state needed by the test.

The `Playground` type is exported from `playground/controller.ts` and can be imported with `import type` without running the application. Existing helpers remain available:

- `fixtures`, `configurations`, `reset(fixture?, configuration?)`, `selectFixture(fixture?, configuration?)` and `replaceDocument(text, format, documentId?)`.
- `operation(name, args?)`: invokes a named public-facade operation and retains its return/rejection behaviour.
- `observe()`: returns snapshots or explicit errors, selection, command state, geometry, adapter events, diagnostics and `lastResult`, plus lifecycle, effective setup, operations and captured outputs.
- `adapter.setMode(kind, mode)` and `adapter.release(kind)`, where `kind` is `import` or `export`. Files use `operation('fileMode', { mode })` and `operation('fileRelease')`.

Additional helpers are `configure(partialSetup)`, `describe()`, `captureEvidence()` and `subscribe(listener)`. `describe()` provides fixture metadata, defaults, supported adapter modes and operation descriptions/examples from the same registry used by execution. Subscriptions are coalesced and do not replace explicit observations in assertions.

`configure()` recreates the editor when the fixture, configuration, file support or editor count changes. Editable and adapter settings apply at runtime and preserve the current document and history. Concurrent configuration requests retain each requested setting; `desiredSetup` reports the requested setup while a reset is pending.

Operations record sequence, generation, arguments, status and result/error. History retains the latest 200 entries and exposes `droppedOperations`. Reset clears history. Async imports/exports remain pending until they settle; obsolete operations cannot overwrite fresh diagnostics or outputs. `startImagePaste`/`finishImagePaste` and `startOutput`/`finishOutput` support controlled asynchronous cases. A finish call can wait on a held adapter: release the relevant adapter separately. Direct `clipboard` and `printable` operations also expose pending status while awaited.

Readable text/range operations accept `instance: 'second'` where described. Formatting and document-editing operations retain their primary-editor semantics. Use `headings` and `textSnapshot` to obtain fresh scoped identifiers before navigation or range operations; catalogue examples are not valid substitutes for captured identifiers.

### Reproduce a held export

```ts
await page.goto('/?fixture=images&configuration=rich&imageExport=hold')
await expect
  .poll(() => page.evaluate(() => window.inkkitPlayground?.observe().lifecycle))
  .toBe('ready')
await page.evaluate(() =>
  window.inkkitPlayground.operation('startOutput', { kind: 'print' }),
)
await expect
  .poll(() =>
    page.evaluate(
      () =>
        window.inkkitPlayground
          .observe()
          .operations.find((entry) => entry.name === 'startOutput')?.status,
    ),
  )
  .toBe('pending')
await page.evaluate(() => window.inkkitPlayground.adapter.release('export'))
await page.evaluate(() => window.inkkitPlayground.operation('finishOutput'))
await page.evaluate(() => window.inkkitPlayground.reset())
```

To exercise cancellation, reset before releasing instead and assert that old work cannot change the new document or evidence. Inspect structured errors rather than assuming that all clipboard and print failures have identical fallbacks.

To reproduce a held-operation failure through the UI:

1. Select **Opaque image references** and set **Image export** to **Hold**.
2. In **Operations**, run `startOutput` with `{"kind":"print"}`. Its history entry stays pending.
3. Set **Image export** to **Reject**. Changing mode releases the held work, and the export settles with a structured error.
4. Run `finishOutput` to observe its rejection. Download evidence before resetting; inspect the setup, operation arguments, error and adapter events.
5. Select **Reset fixture**. Check that lifecycle returns to `ready`, the generation advances and the operation history is empty. The current rejection setting remains selected; choose **Success** to run a successful export.

## Extend the playground

1. Reuse a fixture from `scripts/interop/consumer/fixtures.ts`, or add a deterministic fixture there when a new case is needed. Keep private resources and production documents out of fixtures.
2. If needed, add a typed operation definition to `playground/operations.ts`, using the public facade. Include its argument description and example. The UI catalogue and `describe()` discover it automatically; do not add a parallel dispatcher.
3. Add a focused browser regression using `test/browser/fixtures.ts`. Use accessible DOM controls for interaction assertions and the automation boundary for precise setup and observations. Test failure or untidy input alongside the normal path. Do not reach into Milkdown state.
4. Select the relevant test group, inspect failure evidence, and update this guide only when the workflow or contract changes. Do not expand routine CI into a fixture/configuration/adapter Cartesian matrix.

## Verification and failure evidence

```sh
pnpm exec playwright test --list
pnpm exec playwright test --project=chromium --grep '@smoke|@playground-smoke'
pnpm build:playground
pnpm exec playwright test --project=chromium --grep @playground
pnpm exec playwright test --project=chromium --grep @playground-offline
pnpm exec playwright test --project=chromium --grep @host-controls
pnpm exec playwright test --project=chromium --grep @native-search
pnpm exec playwright test --project=chromium --grep @linked-files
pnpm exec playwright test --project=webkit --grep @host-controls
pnpm exec playwright show-report _local/playwright/report
pnpm exec playwright show-trace PATH_TO_TRACE_ZIP
```

Build before running the full Chromium suite or the playground selection. The offline regression requires that bundle, disables network access, opens it through `file://`, edits source and exercises local linked resources and printable output. It checks resource mounting and native media controls, not audio/video decoding or playback.

Standard Playwright reports live in `_local/playwright/report`, artefacts in `_local/playwright/results`, and machine-readable results in `_local/playwright/results.json`. On failure, attachments include browser errors and URL, structured observations, playground evidence, screenshot and trace. If boot fails, browser context and capture-error attachments still identify the failure. Preserve a run's evidence before another run overwrites the configured destinations.

The controlled assertion failure is excluded by default. Run it separately to demonstrate reporting:

```sh
INKKIT_INTENTIONAL_FAILURE=1 pnpm exec playwright test --project=chromium
```

This explicit opt-in selects only the controlled failure. CLI grep filters narrow the configured selection and cannot restore a test already excluded by configuration.

Retain its expected non-zero exit separately from passing evidence, including the reviewed commit and exact command. Follow [bounded verification](development.md#bounded-verification) for package and native checks. Browser success does not establish WKWebView compatibility, full IME behaviour, native clipboard permissions or a consumer app's storage/opening actions. Clipboard writes require browser permission; captured output remains inspectable without that permission.
