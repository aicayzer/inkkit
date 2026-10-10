# Lightweight performance

Measurements use the actual packed package in the generic offline facade consumer. Run on Atlas with the package-manager version in `package.json`:

```sh
node scripts/measure-performance.mjs CANDIDATE_ARCHIVE _local/release/0.0.11/performance
```

The script builds a single-file Vite consumer, launches Chromium, rejects HTTP requests, and measures three fresh pages for each minimal/rich configuration and document. It records archive/bundle hashes, raw and gzip bytes, rendered module sizes, machine/browser versions and every sample. A failed render deadline or lost authored source fails the measurement. Results are observations, not performance budgets.

Startup is navigation through the initial empty editor mount (`performance.now()`), with one shared browser process. Mount measures a subsequent mount separately. Load measures synchronous document loading; render-ready measures waiting for diagram completion and one animation frame. Editing measures ten synchronous buffered single-character insertions in the first heading, including change events, preservation and selection reveal. Snapshot measures the subsequent save capture. These are Chromium timings on Atlas, not WKWebView latency guarantees or an IME benchmark.

The everyday fixture is a short document with formatting and tasks. The large fixture has 1,000 Unicode paragraphs (146,915 bytes). The mixed fixture has 120 headings, code blocks and tables, four diagrams, eight named images and a shared reference definition (16,342 bytes). Exact source sizes are in the evidence. Minimal omits asset adapters; from 0.0.11 it also disables code highlighting and diagram previews. Rich enables adapters and both presentation plugins. Both retain code and unsupported source, offline CSS/declarations and explicit portable output.

## Atlas measurements, 10 October 2026

The retained 0.0.10 baseline and initial 0.0.11 comparison use the same measurement harness. Median values are milliseconds; edit medians use all 30 insertions per configuration/document. The release evidence contains final clean-candidate measurements and their hashes.

| Configuration/document | Ready 0.0.10 / 0.0.11 | Load 0.0.10 / 0.0.11 | Edit 0.0.10 / 0.0.11 | Snapshot 0.0.10 / 0.0.11 |
| ---------------------- | --------------------: | -------------------: | -------------------: | -----------------------: |
| Minimal/everyday       |             189 / 174 |              12 / 13 |            2.1 / 1.3 |               0.6 / <0.1 |
| Minimal/large          |             184 / 172 |            277 / 272 |             175 / 89 |                85 / <0.1 |
| Minimal/mixed          |             192 / 182 |            245 / 239 |             146 / 73 |                68 / <0.1 |
| Rich/everyday          |             194 / 195 |              13 / 15 |            2.2 / 1.5 |               0.8 / <0.1 |
| Rich/large             |             194 / 191 |            279 / 284 |             176 / 91 |                86 / <0.1 |
| Rich/mixed             |             190 / 186 |            245 / 250 |             146 / 76 |                68 / <0.1 |

Minimal mixed render waiting fell from 54 ms to the timer floor when preview work was disabled; rich mixed remained about 62–67 ms. Small startup differences are within machine/run variation and do not establish a general startup improvement.

The all-in-one measurement page was 6,085,945 bytes (gzip 1,720,432) for the baseline and 6,095,095 (gzip 1,724,429) for the initial candidate. Both configurations use the same bundled page. The page includes the test bridge, fixture assets and measurement code, so these are consumer sizes, not the package tarball size. Rendered module attribution is before final minification and cannot be added directly to compressed bytes; Mermaid alone accounts for about 3 MB at that stage, with further layout dependencies elsewhere.

## Decisions

A Chromium CPU profile of mixed loading/editing attributed the dominant editing work to source serialization and reopen validation. Highlighting was a small fraction of sampled work. InkKit now caches successful preserved source by immutable document identity, scoped to each load/reload. Repeated plugin updates and snapshot/export captures reuse that result; new documents, provenance changes, edits and history still produce the correct source. Failures remain uncached. This roughly halves the measured large/mixed edit cost without weakening the reopen check.

Optional presentation plugins can be skipped at mount through `rendering: { codeHighlighting: false, diagramPreview: false }`. Mermaid is imported only after validating an actual render request. Explicit diagram copy/print still renders on demand. These changes reduce execution work for minimal hosts while retaining the default rich behaviour.

No bundle-size reduction is claimed. Single-file offline consumers include optional rendering code even with dynamic imports. Splitting delivery would require a different packaging/host contract; measurements do not justify changing that contract in this consolidation wave. No renderer replacement, arbitrary budget or general plugin platform was introduced. Remaining large-document editing costs come principally from whole-document preservation/reopen validation, which remains the correctness boundary. Hosts should evaluate their actual documents using this reproducible baseline.
