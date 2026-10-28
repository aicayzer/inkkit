# Test and CI audit for 0.3.4

28 October 2026. Audit for [#398](https://github.com/aicayzer/inkkit/issues/398), covering the starting test inventory, subsequent maintenance changes and two fixed CI samples.

**Retain every exact-saving case, deterministic seed, independent preservation comparison and required engine gate.** The supported reductions are expectation storage, two repeated read-only browser setups and four identical Mermaid refusal registrations. There is no supported test-count or line-count quota, and this audit does not establish an overall CI speed improvement.

## CI samples and method

The original 100-run baseline covers 26 October 01:02:51 UTC to 27 October 17:26:26 UTC: 65 successful, 11 failed and 24 cancelled runs; 112 attempts, 888 jobs and nine workflow revisions. Its source baseline is `3f346a7a6fa6bade42c2f26d6f62e5ed8dbf2a10`.

A separate latest-100 snapshot collected at **28 October 20:31:34 UTC** covers 26 October 13:36:32 UTC to 28 October 20:24:22 UTC: **73 successful, 13 failed, 13 cancelled and one in-progress run**, containing 108 attempts, 987 jobs and seven workflow revisions. The in-progress run is [40762982716](https://github.com/aicayzer/inkkit/actions/runs/40762982716). Its unfinished work is not assigned a completed duration. Completed jobs from that run remain valid individual job observations, so job sample sizes can exceed completed workflow sample sizes.

Collection uses `gh api repos/aicayzer/inkkit/actions/workflows/ci.yml/runs?per_page=100`, every run's paginated `jobs?filter=all` endpoint, individual attempt records for reruns, exact workflow files at each head SHA and failed/cancelled executable-job logs. Workflow revisions are grouped by SHA-256 of the workflow file. Run inventory is frozen at collection start; job and log reads follow, so the API snapshot is not atomic. The fixed run inventories, raw API responses, logs and calculation scripts are retained as audit evidence; refreshing a sample must use a separate output directory.

All durations below are seconds. Median is the ordinary median; p90 uses nearest rank, `ceil(0.9 × n)`. Completed duration samples include successful and failed attempts, excluding cancellations, skipped jobs and unfinished executions. Conclusions are counted separately. Workflow elapsed is attempt `run_started_at` to the latest job completion; job execution is `started_at` to `completed_at`; runnable queue delay is job `created_at` to `started_at`. Dependency wait is not job queue delay. These API timestamps do not expose every scheduler phase.

| Sample                           | Completed attempts | Elapsed median | Elapsed p90 |
| -------------------------------- | -----------------: | -------------: | ----------: |
| Original baseline, all events    |                 83 |            772 |        1784 |
| Original baseline, pull requests |                 53 |            471 |        1738 |
| Original baseline, pushes        |                 30 |         1040.5 |        1825 |
| Latest snapshot, all events      |                 92 |            648 |        1371 |
| Latest snapshot, pull requests   |                 56 |            464 |        1410 |
| Latest snapshot, pushes          |                 36 |          804.5 |        1371 |

The supplied approximately **10-minute median and 31-minute p90** are historical estimates with a different or unspecified sampling method. The baseline's 471/1738 seconds and latest snapshot's 464/1410 seconds are overlapping, mixed-revision, mixed-workload samples, **not a causal before/after benchmark**. Maintenance also added facade save/reopen checks and correctness regressions; equal workflow files do not establish equal test work.

Initial scheduling delay, from attempt start to first job start, has median/p90 **3/92 seconds for pull requests** (n=70 attempts with a started job) and **3/598 seconds for pushes** (n=36). The latest workflow revision has **3/3 seconds** for both events (PR n=15, push n=13), but one push waited 415 seconds. A long total run is not necessarily a slow test.

### Workflow revisions

The original starting workflow, `0590fa3fe2`, already used three browser shards, Chromium-only pull-request execution, supervised browser-server failures and Chromium installation without system dependencies. These changes predate this maintenance work. The latest workflow, `5505595a9b`, includes the action upgrades from [#387](https://github.com/aicayzer/inkkit/pull/387); its observed jobs retain those execution policies.

| Workflow SHA-256 prefix | PR completed n | PR elapsed median / p90 | Push completed n | Push elapsed median / p90 |
| ----------------------- | -------------: | ----------------------: | ---------------: | ------------------------: |
| `f8950c1eb2`            |              6 |         1464.0 / 2153.0 |                2 |           2262.5 / 2700.0 |
| `2477d740b1`            |              3 |         1574.0 / 1577.0 |                2 |           1626.5 / 2149.0 |
| `5f76d65365`            |             11 |          462.0 / 1060.0 |                5 |           1049.0 / 1106.0 |
| `565544ae42`            |              3 |           944.0 / 979.0 |                1 |           1032.0 / 1032.0 |
| `565b1d9089`            |              5 |           468.0 / 772.0 |                2 |           1119.0 / 1294.0 |
| `0590fa3fe2`            |             14 |           453.0 / 577.0 |               11 |            733.0 / 1333.0 |
| `5505595a9b`            |             14 |           463.0 / 474.0 |               13 |             730.0 / 913.0 |

Revision sample sizes are deliberately visible. In particular, a one- or two-run p90 is an observed tail value, not a stable prediction.

### Latest 100 runs: job execution, queue and outcomes

Historical serial suites and current aggregate jobs share names, so they are separated by their actual executed steps. Queue statistics use the same completed-job sample as execution statistics. Success/failure/cancelled counts include all recorded attempts; skipped and still-running jobs are excluded from these three columns.

| Job role                     | Completed n | Execution median / p90 | Runnable queue median / p90 | Success / failure / cancelled |
| ---------------------------- | ----------: | ---------------------: | --------------------------: | ----------------------------: |
| browser (chromium) aggregate |          94 |                  3 / 4 |                       2 / 3 |                   77 / 17 / 0 |
| browser (chromium) serial    |          11 |            1225 / 1656 |                       2 / 2 |                    10 / 1 / 0 |
| browser (webkit) aggregate   |          95 |                  3 / 4 |                       2 / 3 |                    92 / 3 / 0 |
| browser (webkit) serial      |           9 |            1599 / 1814 |                     3 / 488 |                     9 / 0 / 2 |
| browser shard (chromium 1/3) |          85 |              428 / 462 |                       2 / 3 |                    79 / 6 / 7 |
| browser shard (chromium 2/3) |          87 |              404 / 444 |                       2 / 3 |                    84 / 3 / 6 |
| browser shard (chromium 3/3) |          87 |              421 / 449 |                       2 / 3 |                    84 / 3 / 6 |
| browser shard (webkit 1/3)   |          39 |              663 / 757 |                     3 / 304 |                    39 / 0 / 2 |
| browser shard (webkit 2/3)   |          39 |              633 / 745 |                     3 / 154 |                    39 / 0 / 2 |
| browser shard (webkit 3/3)   |          39 |              616 / 787 |                      3 / 16 |                    38 / 1 / 2 |
| changes                      |         106 |                  6 / 8 |                       2 / 3 |                   106 / 0 / 0 |
| check                        |         102 |            352.5 / 568 |                       2 / 3 |                    93 / 9 / 3 |
| docs                         |          45 |                48 / 54 |                       2 / 2 |                    45 / 0 / 0 |

### Latest workflow: event-specific job timing

These figures describe the observed current workflow, not the speed of the proposed audit-only changes. Every completed `check` in this revision executed `pnpm check`; none is a documentation-only substitute. `browser (webkit)` on pull requests is a short aggregate gate with engine execution skipped by design.

| Event, latest workflow | Job                          | Completed n | Execution median / p90 | Runnable queue median / p90 |
| ---------------------- | ---------------------------- | ----------: | ---------------------: | --------------------------: |
| pull_request           | browser (chromium)           |          14 |                  3 / 4 |                       2 / 3 |
| pull_request           | browser (webkit)             |          15 |                  3 / 4 |                       2 / 3 |
| pull_request           | browser shard (chromium 1/3) |          14 |            382.5 / 456 |                       2 / 3 |
| pull_request           | browser shard (chromium 2/3) |          15 |              366 / 444 |                       2 / 3 |
| pull_request           | browser shard (chromium 3/3) |          15 |              424 / 446 |                       2 / 3 |
| pull_request           | changes                      |          15 |                 7 / 10 |                       2 / 2 |
| pull_request           | check                        |          14 |            384.5 / 399 |                       2 / 3 |
| pull_request           | docs                         |           2 |                44 / 48 |                       2 / 2 |
| push                   | browser (chromium)           |          13 |                  3 / 4 |                       2 / 2 |
| push                   | browser (webkit)             |          13 |                  3 / 4 |                       2 / 2 |
| push                   | browser shard (chromium 1/3) |          13 |              440 / 462 |                       2 / 3 |
| push                   | browser shard (chromium 2/3) |          13 |              432 / 452 |                       2 / 3 |
| push                   | browser shard (chromium 3/3) |          13 |              370 / 445 |                       2 / 3 |
| push                   | browser shard (webkit 1/3)   |          13 |              658 / 710 |                       3 / 6 |
| push                   | browser shard (webkit 2/3)   |          13 |              656 / 785 |                       3 / 5 |
| push                   | browser shard (webkit 3/3)   |          13 |              602 / 685 |                       3 / 4 |
| push                   | changes                      |          13 |                  7 / 8 |                       2 / 3 |
| push                   | check                        |          13 |              424 / 527 |                       2 / 2 |
| push                   | docs                         |           1 |                48 / 48 |                       2 / 2 |

For comparison, the starting workflow's PR `check` median/p90 was **285/353 seconds** (n=16 completed jobs), and its Chromium shard medians were **421.5, 377.5 and 418.5 seconds** (n=14 each). In the latest workflow, Chromium remains a material PR critical path and WebKit dominates pushes. The check job now carries additional preservation work. Comparing its whole-job time with Vitest-only time would be misleading.

### Failures, cancellations and intermittence

The latest snapshot contains **43 failed job attempts**: **15 browser-install failures, four browser-assertion failures, four unit-test failures and 20 aggregate failures**. Aggregate failures report failed or cancelled shards; they are not 20 additional root causes. There are 30 cancelled job attempts, with overlaps between run failures, cancelled shards and aggregate failures.

- Browser installation failures include apt mirror stalls and retries blocked by an orphaned package-manager lock. The sample includes the old implementation and its already-merged mitigations. See [install failure](https://github.com/aicayzer/inkkit/actions/runs/40375181282/job/121756260859) and [lock failure](https://github.com/aicayzer/inkkit/actions/runs/40354154660/job/121682030816). Same-head successful reruns primarily establish environmental recovery, not an intermittent browser assertion.
- Browser assertion failures include the task shortcut collision corrected in [#393](https://github.com/aicayzer/inkkit/pull/393), image-move expectations and selection tests corrected or reworked in [#386](https://github.com/aicayzer/inkkit/pull/386), and a failed development-branch link/punctuation candidate. The wider original baseline also contains older selection and host-facade failures. Neither sample establishes a browser assertion that fails and then passes at an unchanged head.
- The four unit failures are a lone-CR preservation assertion corrected in [#384](https://github.com/aicayzer/inkkit/pull/384), the old 60-second correspondence loop timeout ([40698828314](https://github.com/aicayzer/inkkit/actions/runs/40698828314/job/122852847611)), and region seed 19 exceeding its ordinary five-second case budget twice ([40743677073](https://github.com/aicayzer/inkkit/actions/runs/40743677073/job/123011791314), [40758449580](https://github.com/aicayzer/inkkit/actions/runs/40758449580/job/123063627142)). Keep this observed timeout variability distinct from a product assertion failure or a claim that the whole suite is flaky.
- Cancellations include likely supersession, a check around the former 30-minute limit and logs that report only cancellation or runner shutdown. The records do not identify every actor or cause. Do not count a cancelled test as a completed slow test or assign an invented cause.

The correction for [#417](https://github.com/aicayzer/inkkit/issues/417), merged in [#418](https://github.com/aicayzer/inkkit/pull/418), reports each region edit as an ordinary bounded case. It retains all generated work, normal timeouts and independent checks. The subsequent main run [40762192928](https://github.com/aicayzer/inkkit/actions/runs/40762192928) passed; one successful post-fix main run does not establish a long-term failure rate.

## Coverage and retention audit

The original inventory classified all **122 unit files and 93 browser specs**. A refresh at merged source `51c36c6` accounts for **126 unit files, 96 browser specs and 18 support files**. The prepared audit candidate has 17 support files because the stored slash snapshot is replaced. Every path has a retained contract or a specific reduction decision. This is a complete file inventory and a targeted assertion-overlap review, not proof that every assertion is mathematically minimal.

The fresh same-source macOS baseline at `3f346a7` enumerated **4,155 unit cases and 1,101 browser cases per engine**: Chromium 1,096 passed and five skipped; WebKit 1,077 passed and 24 skipped. Use these consistently for the controlled maintenance comparison. The hosted Linux Chromium baseline registered 1,102 cases because `hidden-comments.spec.ts` registers four non-Mac deletion chords but three Mac chords; platform skips also differ. This is a platform-conditioned inventory difference, not removed coverage. Built-playground checks are separate. Runtime-expanded counts must not be confused with source-level `test` declarations or the supplied approximate unit count. Reporting existing random seeds and edit positions separately increases registered test counts without adding or deleting generated coverage.

| Family                                  | Retained evidence and decision                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact Markdown and dialect preservation | Keep every unchanged-byte, outside-edited-block, unsupported-syntax, LF/CRLF, Unicode, save/reopen and undo/redo assertion. Keep all 312 slash combinations.                                                          |
| Generated preservation                  | Keep local, region, list, structural and correspondence seeds, independent whole-document comparisons, semantic reparses and public facade save/reopen checks. Keep existing exclusions explicit.                     |
| Editing and history                     | Keep formatted/source/TXT commands, real keyboard/browser routes, composition, stale generations, refusal atomicity and source-history branch handling. Similar inputs across layers exercise different event paths.  |
| Imports and portable output             | Keep cross-parser HTML safety, link schemes, paste/drop routes, spreadsheet fixtures, opaque references, readable clipboard output and private URL/comment exclusion.                                                 |
| Images, files and wiki links            | Keep asynchronous lifecycle, cancellation, resolver identity, resources, adapter calls, stale results and context-sensitive authored bytes.                                                                           |
| Rendering and accessibility             | Keep static namespace checks, actual computed CSS, focus/forced-colour geometry, translated labels, browser accessibility trees and axe. Merge only the two identical read-only setup pairs below.                    |
| Mermaid                                 | Keep real parser grammar, annotation safety, mocked lifecycle and actual browser SVG/network checks. Remove only the four repeated inputs below.                                                                      |
| API, documentation and errors           | Keep runtime shortcut uniqueness and documented bindings, runtime error-code rows, ordered event fields and declaration coverage. The newer declaration checker does not subsume all runtime-to-reference contracts.  |
| Scaling and bounded work                | Keep long-note exact saving, bounded interactive work and algorithm budgets. Four expensive measurement specs are opt-in through `INKKIT_MEASURE`, so deleting them would not speed ordinary CI.                      |
| Package and browser infrastructure      | Keep full/core entry separation, packed offline consumers, built playground, engine gates, installer recovery and fatal-server supervision. Development, built and packed consumers have different startup contracts. |
| Native boundaries                       | Keep trusted AppKit input, native clipboard extraction/restoration, image-drag destination checks and native history/selection conditions. Browser WebKit does not replace WKWebView or consumer-app evidence.        |
| Added correctness regressions           | Keep repeated-BOM clipboard privacy, grapheme deletion, typed preservation failure/atomic recovery, shared-helper callers and actual spreadsheet HTML paste/drop checks added during maintenance.                     |

### Reductions and their retained equivalents

| Reduction                                                                    | Retained equivalent                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remove the 3,117-line slash snapshot file                                    | Twelve independently authored command bodies, thirteen explicit context rows and divider forms define the same 312 cases. Inputs, readable text, exact saves, reopen, undo and redo remain.                            | Baseline and candidate both pass 331 slash tests with identical full names. Migration compares all 312 stored expectations with zero differences. Old Vitest snapshots normalised CRLF; migration parity uses that old representation only. New `toBe` assertions compare raw saved bytes against explicit LF/CRLF expectations without normalising actual output. |
| Combine accessibility-tree and axe tests sharing one initial fixture         | Named semantic-tree and axe steps retain every assertion; inspect the tree before axe injection.                                                                                                                       | Along with the style pair, selected specs change from 11 to 9 registrations per engine. Both Chromium and WebKit pass all nine, without retries or skips.                                                                                                                                                                                                          |
| Combine initial rendered-class and computed-style checks sharing one fixture | Named class and CSS steps retain all runtime classes, fallback/highlighting checks and computed-style assertions.                                                                                                      | The same two-engine focused verification above. At most two fixture setups per engine disappear; no large CI saving is claimed.                                                                                                                                                                                                                                    |
| Remove four repeated Mermaid matrix registrations                            | Stronger explicit cases retain `style A fill:#f0e`, `classDef c fill:#f0e`, `linkStyle 0 stroke:#f00` and `click A callback`. The distinct no-tooltip href input remains an explicit case; all other positions remain. | Directives change from 136 to 132 cases. The affected scope retains the same 45 unique inputs, with no weakened assertion. All 277 tests in the four focused Mermaid files pass.                                                                                                                                                                                   |

Expected values are test-owned; they are not generated by Inkkit's serializer. No source-preservation case, seed, engine, input route or lifecycle boundary is removed. TypeScript test code may grow while bulky snapshot storage and duplicate registrations shrink.

## Unit runtime findings

The added facade preservation checks explain real additional work: source load, replacement dispatch, exact snapshot, reopening load and independent semantic comparisons. The three largest preservation files account for about 51% of summed file durations in the reviewed logs; those durations overlap across workers and are not wall time. No evidence supports disabling global isolation, removing seeds or introducing a custom sequencer merely to reduce this total.

Region seed 19 selects a 182-block CRLF document and up to eight edits. On a controlled Apple M4, 10-core, 16-GB environment with Node 26.11.0, pnpm 11.0.9 and Vitest 5.0.3, three unmodified selected runs gave a 1.225-second median; instrumentation and the prefix through seeds 1–18 found distributed required work, one connected root and no accumulated connected-DOM growth. This is not a retained-heap measurement or a hosted speed comparison.

The reporting correction changes the complete region file from **301 to 2,401 cases**, representing the same 300 seeds and eight attempted positions each, plus the existing regression. Old/new ordered ledgers were byte-identical across **3,046 records**; both complete runs recorded **579 region validations and 628 global cross-check comparisons**. A selected `seed 19 step 5$` passed without claiming complete-sample coverage. Generation and assertions remain inside ordinary test bodies; timeouts were not raised and assertions were not moved into hooks.

A separate duplicate-parse candidate was rejected after three paired runs of `pnpm exec vitest run test/preservation-matching.test.ts --maxWorkers=1` on the same environment and source `8346346`. Original median: **25.778 seconds**, range **25.774–25.964**. Candidate median: **25.555 seconds**, range **25.198–26.193**. All runs passed 685 cases with 134 existing exclusions and 939 cross-check comparisons. The ranges overlap and one pair was slower. The 0.223-second difference is insufficient evidence of improvement; the candidate was reverted.

## Browser fixture measurement

The controlled comparison supports retaining the built fixture. The same 88 cases ran three times per mode and engine, with the source, tests and lockfile fixed at `91802f4`. Median elapsed time, including build and startup, changed from **52.094 to 30.935 seconds in Chromium** and **54.031 to 42.496 seconds in WebKit**. The reductions are 40.6% and 21.3%, respectively. Every run passed all 88 cases without exclusions or retries; ranges did not overlap within either engine.

[Performance evidence](performance.md#browser-fixture-comparison-28-october-2026) records the exact command, environment, ranges, loading measurements, module-identity and fault-injection checks, scaling and intentional-failure diagnostics. Test contexts remain isolated. The change builds the common fixture once per invocation instead of transforming source modules during navigation; it does not share an editor between tests.

The first hosted audit candidate retained ordinary development serving as a same-workload reference. CI adoption changes only the browser serving mode and its policy documentation; source, tests and lockfile remain identical. The [audit pull request](https://github.com/aicayzer/inkkit/pull/423) records the hosted jobs and comparison. A single hosted observation per mode is descriptive, not a stable median or p90. Local repeated measurements and the historical 100-run samples remain separate evidence.

## Delivery limits and next decisions

Retain the current sharding, browser-install policy, aggregate job names and engine/release gates. The baseline PR browser download cost was only about 8–9 seconds; main's packed-consumer browser installation varied from a 68-second median to a 375-second maximum in the reviewed starting-revision logs. Those are measured setup costs worth separating from test execution, not reasons to weaken consumer verification.

The combined audit candidate passes 463 focused unit cases: 331 slash-menu cases, including all 312 exact-saving combinations, and 132 Mermaid directive cases. The slash run records 780 independent cross-check comparisons. Both engines pass the nine combined accessibility/style cases. Type checking, formatting and browser-runner checks also pass. Hosted CI remains a merge gate; complete browser, package and relevant native verification remains a release gate. [Issue 398](https://github.com/aicayzer/inkkit/issues/398) links the delivery and final release evidence. Browser, WKWebView and consumer-app compatibility remain separate evidence boundaries.
