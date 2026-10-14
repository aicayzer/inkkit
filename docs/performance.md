# Lightweight performance

Measurements use the actual packed package in the generic offline facade consumer. Run on Atlas with the package-manager version in `package.json`:

```sh
node scripts/measure-performance.mjs CANDIDATE_ARCHIVE _local/release/0.0.11/performance
```

The script builds a single-file Vite consumer, launches Chromium, rejects HTTP requests, and measures three fresh pages for each minimal/rich configuration and document. It records archive/bundle hashes, raw and gzip bytes, rendered module sizes, machine/browser versions and every sample. A failed render deadline or lost authored source fails the measurement. Results are observations, not performance budgets.

Startup is navigation through the initial empty editor mount (`performance.now()`), with one shared browser process. Mount measures a subsequent mount separately. Load measures synchronous document loading; render-ready measures waiting for diagram completion and one animation frame. Editing measures ten synchronous buffered single-character insertions in the first heading, including change events, preservation and selection reveal. Snapshot measures the subsequent save capture. These are Chromium timings on Atlas, not WKWebView latency guarantees or an IME benchmark.

The everyday fixture is a short document with formatting and tasks. The large fixture has 1,000 Unicode paragraphs (146,915 bytes). The mixed fixture has 120 headings, code blocks and tables, four diagrams, eight named images and a shared reference definition (16,342 bytes). Exact source sizes are in the evidence. Minimal omits asset adapters; from 0.0.11 it also disables code highlighting and diagram previews. Rich enables adapters and both presentation plugins. Both retain code and unsupported source, offline CSS/declarations and explicit portable output.

## Atlas measurements, 10 October 2026

The retained 0.0.10 baseline and clean 0.0.11 candidate comparison use the same measurement harness. Median values are milliseconds; edit medians use all 30 insertions per configuration/document. The release evidence contains all clean-candidate measurements and their hashes.

| Configuration/document | Ready 0.0.10 / 0.0.11 | Load 0.0.10 / 0.0.11 | Edit 0.0.10 / 0.0.11 | Snapshot 0.0.10 / 0.0.11 |
| ---------------------- | --------------------: | -------------------: | -------------------: | -----------------------: |
| Minimal/everyday       |             203 / 193 |              14 / 14 |            2.2 / 1.6 |               0.7 / <0.1 |
| Minimal/large          |             189 / 193 |            273 / 293 |             176 / 92 |                85 / <0.1 |
| Minimal/mixed          |             198 / 190 |            262 / 250 |             150 / 75 |                72 / <0.1 |
| Rich/everyday          |             200 / 191 |              14 / 14 |            2.4 / 1.5 |               1.1 / <0.1 |
| Rich/large             |             200 / 192 |            297 / 286 |             184 / 92 |                89 / <0.1 |
| Rich/mixed             |             205 / 186 |            261 / 247 |             151 / 75 |                70 / <0.1 |

Minimal mixed render waiting fell from 60 ms to the timer floor when preview work was disabled; rich mixed remained about 63 ms before and 64 ms after. Small startup differences are within machine/run variation and do not establish a general startup improvement.

The all-in-one measurement page was 6,086,749 bytes (gzip 1,720,663) for the baseline and 6,095,767 (gzip 1,724,624) for the clean candidate. Both configurations use the same bundled page. The page includes the test bridge, fixture assets and measurement code, so these are consumer sizes, not the package tarball size. Rendered module attribution is before final minification and cannot be added directly to compressed bytes; Mermaid alone accounts for about 3 MB at that stage, with further layout dependencies elsewhere.

## Decisions

A Chromium CPU profile of mixed loading/editing attributed the dominant editing work to source serialization and reopen validation. Highlighting was a small fraction of sampled work. InkKit now caches successful preserved source by immutable document identity, scoped to each load/reload. Repeated plugin updates and snapshot/export captures reuse that result; new documents, provenance changes, edits and history still produce the correct source. Failures remain uncached. This roughly halves the measured large/mixed edit cost without weakening the reopen check.

Optional presentation plugins can be skipped at mount through `rendering: { codeHighlighting: false, diagramPreview: false }`. Mermaid is imported only after validating an actual render request. Explicit diagram copy/print still renders on demand. These changes reduce execution work for minimal hosts while retaining the default rich behaviour.

No bundle-size reduction is claimed. Single-file offline consumers include optional rendering code even with dynamic imports. Splitting delivery would require a different packaging/host contract; measurements do not justify changing that contract in this consolidation wave. The core entry, added later, is that contract change; see [Builds with and without Mermaid](#builds-with-and-without-mermaid-october-14-2026). No renderer replacement, arbitrary budget or general plugin platform was introduced. Context-sensitive and structural edits still use whole-document preservation and reopen validation. The October 12 text-block measurements below cover a narrower incremental path. Hosts should evaluate their actual documents using these reproducible baselines.

## Text-block input measurements, October 12, 2026

The preservation fix compares commit `97a45cc` (0.0.13) with the candidate on one M4 Pro MacBook Pro, using installed Chrome through Playwright. These are development-source measurements, separate from packed-package and WKWebView checks. Each row averages ten individual `keyboard.insertText('x')` operations. Paragraph and code cases edit the document end; heading cases edit the first heading. Input latency runs from `beforeinput` to the synchronous `changed` callback; it excludes subsequent painting and operating-system keyboard latency. Preservation time totals all `Preservation.serialize` calls per input, including heading DOM normalization. Diagram previews are disabled and code highlighting remains enabled.

| Document                                       | Characters | Preservation before / after (ms) | Input before / after (ms) |
| ---------------------------------------------- | ---------: | -------------------------------: | ------------------------: |
| 100 long plain paragraphs                      |     34,700 |                     29.43 / 0.53 |              30.25 / 1.09 |
| 500 long plain paragraphs                      |    173,500 |                    143.37 / 0.50 |             144.45 / 1.19 |
| 1000 long plain paragraphs                     |    347,000 |                    287.26 / 0.49 |             288.84 / 1.72 |
| 500 code blocks                                |    164,500 |                    48.93 / 49.29 |           105.69 / 106.39 |
| 500 marked paragraphs                          |    190,500 |                    210.03 / 0.88 |             212.07 / 2.33 |
| 500 paragraphs, heading edit                   |    173,511 |                    140.72 / 0.31 |             141.96 / 1.10 |
| 500 paragraphs plus mixed blocks, heading edit |    173,634 |                    143.01 / 0.28 |             144.33 / 1.06 |

To repeat the comparison, install dependencies in both checkouts and run from the candidate checkout with Chrome installed:

```sh
node scripts/measure-preservation.mjs /path/to/baseline-checkout
```

## Replace All and mid-document input, October 12, 2026

Same machine, Chrome 154 through Playwright and development source as above. The baseline is main at `e3e3687` (0.0.15). The mixed documents cycle through paragraphs with links and authored `__bold__`, lists, quotes, fenced code, tables and footnotes; the changed blocks are spread evenly and contain the searched word. Every successful replacement was checked to equal a plain text replacement of the original source, so unchanged blocks kept their exact bytes. Times are one run each and include first-use warm-up.

| Replace All, blocks changed / total | Baseline                                    | Candidate     |
| ----------------------------------- | ------------------------------------------- | ------------- |
| 100 / 300                           | 118 ms                                      | 111 ms        |
| 300 / 1,000                         | refused after 74 ms (`preservation` error)  | saved, 380 ms |
| 1,000 / 2,000                       | refused after 167 ms (`preservation` error) | saved, 866 ms |

The baseline also refused 100 changed blocks of 2,000 distinct blocks in a direct test of the matching function. The candidate matched 2,000 distinct blocks with up to 1,900 changed, and 50,000 blocks with 10,000 changed, in under 50 ms each. Once matching succeeds, it is not where the time goes. Saving 1,000 changed blocks spends its time on whole-document serialization and the reopen check, which is linear in document size.

Ten single-character insertions in the middle of a 4,000-block document, mean per input:

| Document                           | Characters | Preservation baseline / candidate (ms) | Input baseline / candidate (ms) |
| ---------------------------------- | ---------: | -------------------------------------: | ------------------------------: |
| 4,000 plain paragraphs             |  1,388,000 |                            0.81 / 0.92 |                     4.94 / 4.99 |
| 4,000 short paragraphs with a link |    169,780 |                              662 / 668 |                       672 / 677 |
| 4,000 long paragraphs with a link  |  1,464,000 |                          2,573 / 2,603 |                   2,594 / 2,624 |

Matching does not cause the slow rows. An edit inside a paragraph whose source contains `[`, `<` or `%%` (a link, a task item, a reference, HTML) cannot use the independent text-block path, so each keystroke serializes and reopens the complete document. A CPU profile of 2,000 long link paragraphs attributed 1,334 ms per input to `Preservation.serialize`, almost all of it Markdown serialization, parsing and signature comparison across all blocks. Block correspondence did not appear: with one changed block, trimming the equal head and tail leaves one block on each side. The same cost applies to list, table and code edits. A separate probe of a 4,000-item task list measured about 380 ms per input. [Local block validation](#local-block-validation-october-14-2026) addresses these rows.

The independent text-block path that this section describes covered only plain paragraphs and headings. [Local block validation](#local-block-validation-october-14-2026) replaced it.

Loading and rendering are not optimized by this change; the 1,000-paragraph load remained approximately 0.44 seconds. Code-block input remains materially slower.

Block correspondence anchors unchanged blocks first. Blocks that occur exactly once on each side, in the longest subsequence whose order both sides share, are matched to themselves; matching then repeats inside each gap. A gap with no remaining unique block uses banded edit distance with a shared one-million-cell work budget across widening attempts. Replacing a block costs more than inserting or deleting one and less than both, so an unchanged block is not paired with a deleted neighbor, and an edited block still keeps its surrounding whitespace. Between unchanged blocks, each edited block is then paired with the original that shares the most leading and trailing text with it, so it keeps its own authored syntax beside inserted and deleted blocks. That pairing has its own budget and keeps the edit-distance pairing when the budget runs out, so running out never refuses an edit. Cost follows the size of the gaps between unchanged unique blocks, not the span between two distant changes, so Replace All and other edits that touch many blocks stay saveable. Ordinary keyboard regression cases cover first/last edits across 1,000 paragraphs, authored and unsupported source, history, mode changes and reload.

A rewrite fails closed when it leaves a large gap with nothing to anchor on, such as every block in a long note changing, or hundreds of edits among a few thousand blocks that all repeat the same few texts. In an evenly spread test, 1,000 mutually identical blocks accept up to 342 edits and 2,000 accept 86. The band check counts the steps a path needs to return to the diagonal as well as to leave it; before that, the limits were 256 and 64. A document whose unchanged blocks are mostly distinct reaches the limit only when nearly every block changes. A moved block is rewritten in canonical form because only its new position is known; the blocks around it keep their source, except a list marker that must change to keep two lists apart, as [preservation](preservation.md) describes.

Formatted changes are validated after dialect normalization and before the final state reaches the view. A rejected change reports a preservation error, restores the current visible document and leaves the snapshot, revision and undo history unchanged. Browser tests exercise rejected DOM input and synthetic composition recovery; these do not establish every operating-system IME behavior.

The script starts Vite on ports 4194 and 4195, uses fixed paragraph, code, marked-text, heading, highlighted-code, link, reference, task-list and table fixtures, verifies that all ten inputs reached the snapshot, and records samples in `_local/preservation-performance.json`. Run one comparison at a time with those ports free. A single run does not establish a cross-machine latency guarantee.

## Local block validation, October 14, 2026

Same M4 Pro MacBook Pro, Chrome 155 through Playwright and development source. The baseline is `main` at `b2ca05e`. Each row averages ten single-character inputs, including the first, so it includes one-time work.

| Document                                               | Characters | Preservation baseline / candidate (ms) | Input baseline / candidate (ms) |
| ------------------------------------------------------ | ---------: | -------------------------------------: | ------------------------------: |
| 4,000 plain paragraphs                                 |  1,388,000 |                            0.81 / 0.85 |                     5.62 / 4.89 |
| 4,000 short paragraphs with a link                     |    169,780 |                              643 / 2.7 |                      652 / 10.0 |
| 4,000 long paragraphs with a link                      |  1,464,000 |                             2,451 / 11 |                      2,474 / 30 |
| 4,000 paragraphs with a reference to one definition    |    166,908 |                              638 / 2.8 |                      648 / 10.1 |
| 2,000 paragraphs with a link and 2,000 footnote bodies |    228,450 |                              766 / 3.9 |                      776 / 13.6 |
| One list of 4,000 task items with links                |    193,780 |                              940 / 6.0 |                      952 / 15.7 |
| 1,000 fenced code blocks, middle block                 |     57,000 |                              40 / 0.71 |                        47 / 9.5 |
| 500 code blocks, last block                            |    164,500 |                              46 / 0.61 |                       64 / 17.7 |
| 1,000 small tables, middle cell                        |     60,780 |                              310 / 3.3 |                       316 / 9.4 |

Replace All timings and the other rows of the earlier tables did not change beyond run-to-run variation.

A changed block is validated on its own when nothing outside it can change what it means. The block is written back from its source as before, then parsed with the document's definitions that its bracketed labels could match appended, and must reopen to the intended node. Link and footnote definitions are the only way inline content depends on other blocks, so this reproduces the meaning the block has in place. Link definitions are appended whole; a footnote definition is appended as its label alone, because a block with a footnote reference is never validated on its own. The editor no longer serializes and reparses the whole document for such a keystroke, and the cost does not grow with the number or size of definitions the block does not mention.

- **Blocks validated locally:** paragraphs, headings and tables whose inline content is text, marks and line breaks; fenced code blocks; and items of a top-level list. A list item is validated as the only item of a list with the same marker and indentation, so typing in one item of a long list does not serialize the list. Its number and spacing come from the list and are not compared.
- **Conditions:** the document keeps its block structure, the block keeps its type and attributes, and blank lines separate it from its neighbors. An edited list item keeps its blocks and its authored marker and spacing, which set the column its continuation lines and the blocks after the list are read against. Several adjacent edited blocks are validated locally only when whole-document matching would pair each with its own original. A list that now matches another list, or a result that changes where front matter ends, uses the whole-document path.
- **Kept on the whole-document path:** blocks containing `<` or `%%`, because HTML blocks, HTML comments and `%%` comments can span blocks; inline atoms such as footnote references, images and wiki links; indented code, which is rewritten fenced and can change how the next block reads; a list item whose paragraphs are split or joined, or whose first line becomes empty, which can change its content column; documents with a definition inside a quote, list or footnote, where appending the top-level definitions would not reproduce the document; definitions, footnote definitions, quotes, callouts, literal Markdown and HTML themselves; and any change in the number of blocks.
- **Matching budget:** a block edited in place needs no matching, so a rewrite of every block in place now saves even when whole-document matching would refuse it for its work budget. This already applied to plain paragraphs before this change. A rewrite that also adds or removes a block still uses whole-document matching and its budget.

A randomized comparison saves each edit both ways and requires the same output, and a reopened document equal to the edited one, whenever local validation accepts it. Its documents mix links, full, collapsed and shortcut references, labels that differ in case and spacing, footnotes, comments, HTML, unresolved references, setext and ATX headings, lists with every marker, wide, tab-indented, ten-item, task, nested, loose and lazy-continuation items, lists followed by indented paragraphs and sibling items, fenced and indented code, tables with escaped pipes, quotes, definitions inside quotes and footnotes, front matter, a byte-order mark, CRLF and trailing whitespace. Edits insert text, including Markdown punctuation, delete ranges across mark boundaries, split and join paragraphs, paste two paragraphs, add strong, emphasis and code marks, remove links and toggle tasks, four times in a row. Across 6,000 seeded documents, local validation accepted 6,226 edits and every one matched the whole-document result. A second generator with harder list and label shapes accepted 11,525 edits across 12,000 documents, all matching. The unit test runs 600 seeds; set `SEEDS` to run more.

The comparison also found that whole-document preservation compared CRLF source text with LF canonical text and rewrote the continuation lines of untouched items in an edited CRLF list. Text comparison now ignores line endings.

## Builds with and without Mermaid, October 14, 2026

`@aicayzer/inkkit` renders diagrams with Mermaid. `@aicayzer/inkkit/core` never imports Mermaid, so a page built from it does not contain Mermaid, although Mermaid is still installed as a dependency. The comparison builds the offline interop consumer from the same candidate archive twice, once per entry, and loads each page ten times in fresh pages and fresh WKWebView processes:

```sh
swiftc -target arm64-apple-macos27.0 scripts/interop/WebKitHost.swift -o _local/interop/webkit-host
node scripts/measure-startup.mjs CANDIDATE_ARCHIVE _local/startup _local/interop/webkit-host
```

The script records both pages' hashes and sizes, machine and browser versions and every sample in `startup.json`. Page start-up is the page's own `performance.now()` when the first editor mount completes, which includes parsing and running the whole inline script. WKWebView host start-up adds the time from the host's load request to the page's time origin, including the web content process launch. The candidate archive was packed from commit `d33ee4a`. Both consumers had Mermaid installed. The measurements ran on an M4 Pro MacBook Pro with macOS 27.0.1, Chromium 156 and Playwright WebKit 27.2. Values are medians in milliseconds.

| Page                   |     Bytes |      Gzip | Chromium | Playwright WebKit | WKWebView page | WKWebView host |
| ---------------------- | --------: | --------: | -------: | ----------------: | -------------: | -------------: |
| Main entry, Mermaid    | 6,122,540 | 1,733,351 |      189 |               146 |            120 |            296 |
| Core entry, no Mermaid | 1,015,166 |   318,025 |       44 |                63 |             44 |            222 |

Leaving Mermaid out removes about 83% of the page and about 75 ms from each WKWebView start-up. A single-file build inlines Mermaid's dynamic imports, so the main entry runs Mermaid's module code at start-up even before any diagram renders. Disabling previews does not avoid that cost; only the core entry does. Memory was not measured.

### Bundling only the supported diagram types

When diagrams are enabled, the main-entry page still contains every diagram type Mermaid 12.1.0 ships, not only the six that `validateDiagram` accepts. Mermaid registers all of its built-in diagram types, layouts and KaTeX when it loads, each behind a dynamic import, and has no public option or entry point that leaves any out. A single-file build inlines all of them.

A module graph of the main-entry page attributes 9.36 MB of rendered modules (before minification) to Mermaid. Of that, 6.23 MB is reachable only through diagram types, layouts and maths that InkKit refuses before rendering, mostly ELK (2.54 MB), other Mermaid diagram modules (1.62 MB), Cytoscape (0.87 MB) and KaTeX (0.48 MB). As an experiment, a host build plugin replaced those 48 dynamically imported modules with empty modules. The page fell from 6.1 MB to 2.7 MB (gzip 0.73 MB), and the six supported types still rendered in Chromium.

InkKit does not ship that plugin. It works by rewriting Mermaid's unexported chunk files, whose names and boundaries can change in any Mermaid release, and it applies only to hosts that build with Vite or Rollup. Pruning safely needs either a Mermaid entry point that registers selected diagram types or a separate decision to maintain such a plugin with InkKit's Mermaid pin.

## Source-mode typing, October 14, 2026

Typing in the Markdown source editor used to parse the whole document, build a new `Preservation`, replace the whole hidden formatted document, serialize it again, and measure a copy of the full text appended to `document.body`. A keystroke cost about as much as loading the document, and so did the first paste, cut or replacement after typing. Now every source edit, typing or not, only updates the text: the text stays authoritative, the change is reported at once, and each edit is an undo step on the text. The formatted document takes the source in when you leave source mode. Exports (`clipboardSnapshot()`, `printableSnapshot()`) read a throwaway document made from the text and leave history alone; a partial source copy reads only the selected source.

Same machine and method as above: development source, ten `insertText('x')` operations in the middle of the source editor, mean per input, in Chrome 155 and in WebKit 27.2 (Playwright's build), both through Playwright. Input runs from `beforeinput` to the synchronous `changed` callback. Paste is `pasteAsPlainText` straight after the ten keystrokes. Leave is `setEditingMode('formatted')` after them. The bare column is the same text in a plain `<textarea>` with no editor, which is what the browser itself spends on a keystroke. The baseline is main at `faa349b`. Run `node scripts/measure-preservation.mjs BASELINE_CHECKOUT source` to repeat it, with `MEASURE_BROWSER=webkit` for WebKit.

| Chrome, source document                       | Bare textarea | Keystroke before / after | Paste before / after | Leave before / after |
| --------------------------------------------- | ------------: | -----------------------: | -------------------: | -------------------: |
| 1,000 plain paragraphs (347,000 characters)   |        5.2 ms |             378 / 7.1 ms |          380 / 24 ms |          22 / 390 ms |
| 4,000 plain paragraphs (1,388,000 characters) |       81.0 ms |          1,629 / 93.3 ms |        1,555 / 98 ms |        84 / 1,570 ms |
| 1,000 paragraphs with a link                  |        5.3 ms |             707 / 6.4 ms |          711 / 28 ms |          31 / 731 ms |

| WebKit, source document      | Bare textarea | Keystroke before / after | Paste before / after | Leave before / after |
| ---------------------------- | ------------: | -----------------------: | -------------------: | -------------------: |
| 1,000 plain paragraphs       |        3.5 ms |             381 / 6.8 ms |          367 / 22 ms |          11 / 369 ms |
| 4,000 plain paragraphs       |       14.5 ms |          1,741 / 25.1 ms |        1,609 / 82 ms |        43 / 1,524 ms |
| 1,000 paragraphs with a link |        4.1 ms |             802 / 6.6 ms |          828 / 21 ms |          26 / 802 ms |

At 4,000 paragraphs in Chrome the remaining keystroke cost is the browser's own: a bare textarea with the same text takes about as long. A paste after typing costs one reveal of the caret, which measures a copy of the text. Buffered native typing arrives through `insertText` rather than the textarea and pays that reveal on every call: 381 to 25 ms at 1,000 paragraphs and 1,565 to 100 ms at 4,000 in Chrome, 442 to 21 ms and 1,781 to 81 ms in WebKit.

Taking in the source costs what loading does, once, when you leave source mode. Nothing waits on a timer, so typing never pauses for it. The formatted history receives all the source steps as a single step. Before that, undo and redo step through the source edits on the text: a pause of more than 500 ms in typing ends a step, an edit that is not typing is a step of its own, and the last 100 steps are kept.

## Long code blocks, October 14, 2026

For some text, highlight.js 11.11.2 takes time that grows with the square of the text's length. A run of one word in an `ini` or `typescript` block is one case. Lines of plain words in a `c`, `cpp`, `arduino` or `csharp` block are another, and there the slow match runs on from line to line, so neither a line limit nor a token limit bounds the cost. A run of one word of 16,000 characters takes 1,127 ms in `ini`, 972 ms in `php` and 619 ms in `typescript` in Node 26, and 16,000 characters of short lines of words take about 1,000 ms in `c`. Ordinary code costs 0.1 to 0.25 microseconds a character.

Two limits now bound highlighting:

- **Block length:** a code block longer than 5,000 characters is not highlighted. At that length, the slowest text found takes about 110 ms to highlight in Chromium and WebKit, and ordinary code takes a few milliseconds.
- **Time per load or edit:** once highlighting in one load or one edit has taken 200 ms, the blocks it has not reached stay plain until they are edited. This bounds a note with many slow blocks. On the machine below, a note of 200 ordinary TypeScript blocks of 4,830 characters each (947,000 characters) highlights every block in Chromium and 182 to 200 of them in WebKit; a slower device reaches the limit with less code.

The text of an unhighlighted block is still editable and is saved unchanged.

The measurements ran on an M4 Pro MacBook Pro with macOS 27.0.1, in Chromium 156 and Playwright WebKit 27.2, against development source. The baseline is `main` at `f5c4bb2`. Open is `loadDocument()` of a note that holds the block; type is one `insertText('x')` at the end of the block. Values are medians of three runs, in milliseconds, before / after. Run `node scripts/measure-highlighting.mjs` in each checkout to repeat them, with `INKKIT_PLAYGROUND_PORT` set to a free port.

| Code block                        | Characters | Chromium open | Chromium type | WebKit open | WebKit type |
| --------------------------------- | ---------: | ------------: | ------------: | ----------: | ----------: |
| `ini`, one word                   |      4,999 |     119 / 116 |     118 / 114 |   108 / 108 |   107 / 109 |
| `ini`, one word                   |     20,000 |     1,493 / 6 |     1,559 / 4 |   1,632 / 8 |   1,634 / 3 |
| `typescript`, one word            |     20,000 |       986 / 6 |       999 / 4 |     501 / 8 |     504 / 3 |
| `c`, lines of words               |     20,000 |    1,033 / 11 |     1,034 / 8 |    778 / 13 |     783 / 6 |
| `typescript`, ordinary code       |      4,999 |         6 / 6 |         4 / 4 |       9 / 8 |       5 / 4 |
| `typescript`, ordinary code       |     20,000 |        20 / 8 |        13 / 6 |     25 / 10 |      11 / 5 |
| No language, one word             |     20,000 |         5 / 6 |         4 / 4 |       8 / 6 |       3 / 3 |
| 20 `ini` blocks of one word, each |      4,999 |   2,212 / 251 |     112 / 121 | 2,167 / 251 |   110 / 110 |

Typing in the last of the 20 blocks still highlights that block, so it costs what one block at the length limit costs.
