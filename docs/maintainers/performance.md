# Performance evidence

## Browser fixture comparison, 28 October 2026

The opt-in built fixture reduced the wall time of a fixed browser-test workload on candidate `91802f4`. The source, lockfile, tests and browser versions were identical between modes. These are browser-test timings; package consumers and WKWebView have separate checks.

The workload contains 88 cases in nine files. Each engine ran three observations per mode, ordered development/built, built/development, development/built. Every observation started a fresh supervised server and used the ordinary Playwright context lifecycle. Elapsed time includes the fixture build, server startup, all cases and process shutdown; listing and evidence collection are outside that interval. Existing dependency and operating-system caches were not cleared. The fixture rebuilds its output on every built-mode invocation.

```sh
INKKIT_BROWSER_FIXTURE=dev node scripts/test-browser.mjs --project=chromium \
  test/browser/mode-selection.spec.ts test/browser/open-link-keyboard.spec.ts \
  test/browser/preservation-long.spec.ts test/browser/source-typing.spec.ts \
  test/browser/paste-html.spec.ts test/browser/linked-files.spec.ts \
  test/browser/selection-presentation.spec.ts test/browser/consolidation.spec.ts \
  test/browser/playground-tools.spec.ts
```

Repeat with `INKKIT_BROWSER_FIXTURE=built` and `--project=webkit` in the stated order. The development mode in this comparison uses the dedicated fixture configuration; commands without the variable still use the ordinary development playground.

| Engine   | Development median (range) |     Built median (range) | Median reduction |
| -------- | -------------------------: | -----------------------: | ---------------: |
| Chromium |   52.094 s (52.075–52.236) | 30.935 s (30.774–31.391) |            40.6% |
| WebKit   |   54.031 s (53.838–54.729) | 42.496 s (42.316–42.502) |            21.3% |

Measured on Apple M4 (10 cores, 16 GB), macOS 27.0, Node.js 26.11.0, pnpm 11.0.9, Vite 8.3.3 and Playwright 1.64.0. No competing test or build job was observed in 39 process samples across the two series. Background services remained active; an existing development server stayed idle. The measurements are from one machine and one candidate.

The listings were identical between modes. Every measured run passed all 88 cases without skips, failures or retries. Built-output hashes were identical across repetitions. Before measuring, both modes in both engines passed five fresh-context module-identity probes and the 17 preservation, mode-selection and keyboard-link cases. The probes also patched the imported editor prototype and verified that playground observation invoked it. The existing preservation-refusal test injected a failure through the imported preservation prototype and checked visible DOM, saved bytes and usable history. An initial redirect-based alias failed class identity; module re-exports fixed it before the measured candidate was frozen.

A separate five-context loading probe per mode and engine recorded 202 navigation/resource entries in development mode and nine in built mode. Median navigation-to-observable-document time was 133.0/76.7 ms in Chromium and 176.4/96.7 ms in WebKit (development/built). This probe ran separately from suite timing, and measured before its additional identity imports. It is supplementary loading evidence, not an editor interaction measurement.

The separate long-note scaling case passed in both modes and both engines. Built mode also passed the nine changed accessibility/style cases in each engine. The intentional-failure configuration exited non-zero in both engines with the expected assertion, fixture observations, screenshot and trace. These expected failures are kept separate from passing evidence.

The ranges do not overlap within either engine, supporting the built fixture for this workload. Three observations per mode do not establish tail latency or complete-suite savings. CI adopts the built fixture while keeping check names, sharding, engine rules and retries unchanged. [The audit pull request](https://github.com/aicayzer/inkkit/pull/423) records a separate same-workload hosted comparison; these local results do not establish a hosted improvement. The final complete browser suites and native checks remain release-candidate gates.

## Long-note work, 27 October 2026

These measurements compare `main` at `2837dbf` with the implementation in `ad43fd0`. They ran on an Apple M4 Pro MacBook Pro, Darwin 27.0.0, Node.js 26.12.1 and Playwright 1.64.0, with headless Chromium 156.0.8078.4 and WebKit 27.2. Other work shared the machine. Values are medians, not latency guarantees or evidence about WKWebView.

Run the same harness in each checkout, installing its own frozen dependencies. When measuring an older checkout, copy the named test files and `test/browser/key-timing.ts` from the candidate first. Each command records its samples in the named folder; the long-note report also records the machine, browser and checkout commit.

```sh
INKKIT_PLAYGROUND_PORT=4191 INKKIT_MEASURE=_local/performance INKKIT_MEASURE_RUNS=3 INKKIT_MEASURE_SIZE=5000 pnpm exec playwright test --project=chromium --project=webkit test/browser/measure-long-note.spec.ts
INKKIT_PLAYGROUND_PORT=4191 INKKIT_MEASURE=_local/performance INKKIT_MEASURE_RUNS=5 pnpm exec playwright test --project=chromium --project=webkit test/browser/measure-footnote.spec.ts
INKKIT_PLAYGROUND_PORT=4191 INKKIT_MEASURE=_local/performance INKKIT_MEASURE_RUNS=3 pnpm exec playwright test --project=chromium --project=webkit test/browser/source-latency.spec.ts
```

The long-note fixture contains 5,000 blocks: a heading every 100 blocks and ordinary paragraphs elsewhere, with `alpha` in every paragraph. It uses the development playground's minimal configuration with observation disabled. Facade timings include the playground's control refresh; its outline refresh is cached after the change. Source setup dispatches textarea input before measuring the first outline read, then another edit before leaving source mode, so those measurements include reading the changed text. Enter uses a trusted browser key and runs through the following frame. Paste inserts 500 Markdown paragraphs. Other timings cover the synchronous facade operation and its control refresh.

| Action at 5,000 blocks                             | Chromium before / after (ms) | WebKit before / after (ms) |
| -------------------------------------------------- | ---------------------------: | -------------------------: |
| Ordinary typing                                    |                    9.1 / 9.1 |                    16 / 20 |
| Enter, through next frame                          |                  13.4 / 14.3 |                    21 / 21 |
| Paste 500 paragraphs                               |                  81.5 / 81.5 |                    94 / 92 |
| Type with active search                            |                 137.2 / 11.2 |                   227 / 22 |
| Repeat unchanged source outline                    |                   717.7 / <1 |                 1,075 / <1 |
| First outline read after a source edit             |                 731.5 / 21.2 |                 1,032 / 19 |
| Return to formatted mode after another source edit |                  758 / 116.3 |                 4,658 / 95 |

Ordinary typing, Enter and paste did not materially improve; their existing bounded paths remain. The source-mode improvement includes avoiding a full DOM rebuild when source-history metadata changes. It is not simply a reduction in parser calls.

Footnote typing was already below the issue's 30 ms target at the current baseline. A separate fixture with 4,500 paragraphs and 500 footnote definitions measured **11 / 19 ms** in Chromium / WebKit before, and **12.5 / 30 ms** with the candidate plus selection commit `65da320`. These are five-sample medians; an earlier three-sample candidate run measured 10 / 18 ms, so the wall-clock threshold is sensitive to shared machine load. The later region-preservation path had already addressed the original report. This delivery adds a bounded work regression without expanding which inline atoms use local validation.

### Source textarea input

The source fixture has 10,000 Unicode paragraphs. Three fresh-page runs measure a real keydown through the following frame after entering source mode, undoing, redoing and pasting. These are browser keyboard timings; the native runner must establish WKWebView behaviour separately.

| Source input at 10,000 paragraphs | Chromium before / after (ms) | WebKit before / after (ms) |
| --------------------------------- | ---------------------------: | -------------------------: |
| After entering source mode        |                  17.5 / 19.7 |                   113 / 31 |
| After undo                        |                  16.4 / 14.7 |                   110 / 28 |
| After redo                        |                  18.2 / 20.6 |                   109 / 27 |
| After paste                       |                  15.3 / 16.3 |                   115 / 27 |

Assigning a large value while the textarea is detached avoids WebKit's slower subsequent input path. The same replacement helper is used after undo, redo, paste and loads, and retains the element, focus, selection and scroll. Composition keeps its existing guards. The former claim that WebKit's source latency was an unavoidable browser cost was incorrect: setup of the same textarea changes that cost.

### Native source input

On 27 October 2026, the native probe compared the published 0.3.1 archive with candidate commit `3d1ec35` on an Apple M4 running macOS 27.0, using its 60 Hz display and system WKWebView. The command was `node scripts/interop/verify-long-source.mjs ARCHIVE BUNDLE OUTPUT HOST`, with both consumers built from the same fixture. The document has 10,000 Unicode paragraphs, 478,888 UTF-8 bytes and CRLF endings. Each phase uses a fresh document and three trusted AppKit keystrokes at offset 20; the reported figures are medians from keydown through the following frame and timer.

| Native source input | 0.3.1 / candidate (ms) |
| ------------------- | ---------------------: |
| Enter source mode   |                48 / 47 |
| After undo          |                67 / 55 |
| After redo          |                68 / 57 |
| After paste         |                68 / 55 |

Trusted input, focus, exact changed bytes and save/reopen all passed. **The native 35 ms target in #206 remains unmet.** These timings are not the browser results above and do not close that criterion.

A bounded diagnostic comparison found most native cost between `beforeinput` and the capture-phase `input` event, before Inkkit's input handler; that handler added about 1–5 ms. A listener-free textarea with the same value and styling still had a 52 ms median. Disabling spelling and correction did not remove the cost, and LF and CRLF behaved similarly. Resetting the same textarea value off-tree between keystrokes produced subsequent samples of 32–33 ms, but those samples exclude the reset's own cost. Including that reset inside input raised the median to 90 ms, so it is not a viable production fix. Any further improvement must include its complete input cost and retain focus, selection, history and composition.

### Whole-text selection

The selection implementation in `65da320` was measured separately with `node scripts/measure-selection.mjs CHECKOUT`, on the same machine and browser versions. It uses `selectTextRange` over the complete text with `focus: false`, a cached text snapshot, one warm-up and five samples through the next animation frame. It includes no parsing or source-mode transition.

| Paragraphs | Chromium before / after (ms) | WebKit before / after (ms) |
| ---------- | ---------------------------: | -------------------------: |
| 5,000      |                  54.2 / 17.2 |                   215 / 81 |
| 10,000     |                   226 / 21.3 |                  715 / 181 |

The first linear implementation still missed the 100 ms WebKit target at 10,000 paragraphs. A follow-up coalesces adjacent plain paragraph and heading text into one highlight range. Decorated blocks, controls, code and list boundaries keep separate ranges. Pixel checks in both engines confirm that the selection still excludes margins and gaps between blocks.

The same command and fixture on an Apple M4 running macOS 27, Node.js 26.11.0, Chromium 156.0.8078.4 and WebKit 27.2 measured the first linear implementation at `a4bedf7` against the coalesced ranges. Each median uses five samples after one warm-up:

| Paragraphs | Chromium before / after (ms) | WebKit before / after (ms) |
| ---------- | ---------------------------: | -------------------------: |
| 5,000      |                  12.3 / 16.6 |                    69 / 16 |
| 10,000     |                  18.9 / 17.3 |                   150 / 21 |

Both engines now meet the 100 ms target on this fixture, and doubling the document does not double the median. These timings measure text selection through the next frame, not document loading or native host activation.

## Checks and limits

`test/browser/long-note-scaling.spec.ts` compares median costs at 1,000 and 4,000 blocks for typing, trusted Enter, leaving source mode after an edit, whole-text selection, active-query typing and outline reads. It permits eight times the smaller measurement plus a small timer allowance. It runs with the existing browser checks; there is no extra CI job. Focused command:

```sh
pnpm exec playwright test --project=chromium test/browser/long-note-scaling.spec.ts
```

Deterministic regressions also bound parser work and search calls, verify unchanged DOM survives source-history changes, and compare incremental parsing against a full structural parse. Byte-preserving save, undo and reopen checks include CRLF, lone CR, Unicode, syntax-boundary changes and parser-failure fallback. The full preservation comparison remains the correctness check for formatted edits. Search selection changes update only active match decoration; changed text is searched again within the affected top-level blocks.

The source parser reuses a checked syntax tree and unchanged blocks only for safe paragraph/heading documents. References, HTML, comments and other block structures retain the complete parse path. Root document metadata no longer forces ProseMirror to destroy unchanged child views: the root keeps the host DOM, updates outer decorations and still rebuilds for a different node type. The patch is covered by explicit attribute and node-type tests. See [Preservation](../concepts/preservation.mdx) for the preservation contract.

Long single lists and diagram-heavy documents have separate costs and are outside this optimisation. These development-page results do not replace packed-package checks, native input evidence or host-app verification. Historical measurements, including earlier structural-edit and package-size evidence, remain in [the dated archive](performance-history.md); they describe the versions measured there.
