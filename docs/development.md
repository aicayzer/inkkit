# Development

CI runs Node.js 26. The package supports Node.js 22.14 or later (`engines` in `package.json`). Use the package-manager version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm build:playground
pnpm test:built-playground
```

`pnpm test:built-playground` opens the built `_local/playground/index.html` as a file and checks that a diagram renders, so a build that has lost Mermaid fails. It guards the `./src/index.ts` entry in `sideEffects` in `package.json`, which stops the playground build from tree-shaking the Mermaid registration; the package does not ship `src`, so the entry has no effect on hosts. Run `pnpm exec playwright install chromium` once, and build first. CI runs it after the build.

`pnpm test:docs` reads the built declarations and fails when [the API reference](api.md) doesn't mention an export, a public member of `InkKitEditor`, or an option, event or label key. Build first. A new public name needs a description in `docs/api.md`, not only a mention.

`pnpm dev` starts the [development playground](playground.md); it does not start a browser automatically. `pnpm test:package` packs the built package, installs it in a fresh consumer with an isolated npm cache, checks declarations and CSS, and builds an offline single-file Vite page. It builds a second consumer from the `@aicayzer/inkkit/core` entry and checks that its page contains no Mermaid code. It then opens both pages from a file URL in headless Chromium and WebKit. Each page fails on a page error, a network request, or a stylesheet that does not style the editor root, and fails unless `snapshot()` returns the loaded bytes exactly and a typed edit, undo and redo save the expected bytes. Install both browsers first with `pnpm exec playwright install chromium webkit`. The archive and `package-evidence.json` are written to ignored `_local/release/<version>/`, preserving evidence from earlier releases. Evidence records the commit, working-tree state, compressed SHA-256, npm integrity, decompressed tar SHA-256, and the SHA-256 and size of both offline pages. Commit the candidate before recording final evidence; release verification rejects evidence from a dirty working tree.

The public API is `src/core.ts`; `src/index.ts` registers Mermaid and re-exports it. App hosts own persistence, native menus and file access. Regression tests cover formatting, source preservation, clipboard import/export, tables, snapshots, asynchronous image/file operations and optional wiki links. The clean consumer compiles `FileAdapter`, `WikiLinkAdapter`, their reference/context/presentation types and `EditorOptions` alongside the existing public facade. CI uses hosted runners.

## Dependencies

The package bundles its runtime dependencies into `dist`, so a host runs the exact code that InkKit tested. Milkdown, ProseMirror, micromark, the mdast utilities, lowlight and DOMPurify are `devDependencies`, and the build bundles them with their own dependencies. `pnpm build` bundles the versions in `pnpm-lock.yaml`, the same tree that Vitest, the browser suite and the playground run. A host's lockfile cannot resolve a different parser, serializer or ProseMirror version for InkKit.

Mermaid is the one runtime dependency, pinned exactly. It draws diagram previews and validates diagram source, never changes saved bytes, and would multiply the package size if bundled.

- `pnpm build` runs `tsc` for declarations only, then `vite build --config vite.package.config.ts` for the JavaScript, then `scripts/finish-build.mjs`. That script keeps only the declarations the public entries reach and fails if one of them imports a package, because hosts do not install the bundled packages.
- The build writes `dist/THIRD-PARTY-NOTICES.txt` with the name, version and licence of every bundled package. It is also the record of the tree a release ships.
- To update a bundled package, change `pnpm-lock.yaml` in a pull request. CI then runs the preservation tests in `pnpm check`, the packed-consumer pages and the whole browser suite against the new tree before it can merge.

The pinned `prosemirror-view@1.42.6` patch in `patches/` cancels deferred focus restoration when a key that can edit or move the caret arrives. Otherwise, the focus timer can restore an old caret before the browser delivers `selectionchange`. Before handling a non-modifier key, it also reads the current DOM selection even if no observer timer is pending, then retires the recent-focus safeguard. This keeps a deletion after a find-and-arrow movement at the browser's caret while preserving focus correction during the first arrow. Composition and Android input guards still run before this read. Pure modifier keys retain the normal focus correction; blur and destruction clear the pending timer. Keep the patch's source and both distributed JavaScript entries aligned. `test/focus-input.test.ts` controls that event ordering through the public facade and DOM; native host checks must also exercise real keyboard input. Reassess the patch when updating ProseMirror.

The trade-off: a security fix in a bundled package reaches hosts only through an InkKit release, and a host's dependency audit does not see bundled packages. Dependabot alerts are on for this repository and read `pnpm-lock.yaml`, so they cover the bundled packages. When an alert affects a bundled package, update it in a pull request and release.

## Bounded verification

Choose checks from the changed behaviour, not from every available fixture combination.

The randomized list-preservation and source-typing tests run a sample by default: 400 and 10 seeds. Set `SEEDS` to run more, for example `SEEDS=2000 pnpm exec vitest run test/preservation-lists.test.ts` or `SEEDS=200 pnpm exec vitest run test/source-typing.test.ts`.

| Trigger                                                                                 | Required evidence                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate code or package changes                                                       | `pnpm check`, `pnpm format:check`, `pnpm build:playground`, `pnpm test:built-playground`, actual packed-consumer verification and the whole browser suite in Chromium and WebKit. |
| Changed editor behaviour                                                                | Focused regression tests and selected browser cases for the changed contract, including failure and untidy input.                                                                 |
| Changed WKWebView, focus/input, bridge, clipboard, print or resource lifecycle boundary | Selected native core plus relevant feature cases from the existing WKWebView runner, using the actual candidate archive.                                                          |
| Source-only documentation change                                                        | Review changed facts and examples; no editor or native run. Mintlify page, asset or configuration changes validate the site.                                                      |
| Publication                                                                             | Clean committed candidate evidence, exact registry-version consumer and archive/integrity comparison under [releases](releasing.md).                                              |

Browser tests use the public facade and normal DOM interaction. Use [Playwright's standard CLI](https://playwright.dev/docs/test-cli) to list and select tests, inspect reports and open traces; see the [playground guide](playground.md). The fixture catalogue is selectable. Do not run its fixtures, configurations and adapters as a Cartesian matrix. For code, dependency and workflow changes, CI runs every browser test in Chromium on GitHub-hosted Linux and in WebKit on GitHub-hosted macOS, uploads the Playwright report and traces when a job fails, and requires both jobs to pass. A test that cannot run in an engine calls `test.skip` with the reason, for example because it uses the Chrome DevTools Protocol or a macOS key binding. Fix a flaky test at its cause; CI does not retry. Local results do not establish that hosted CI passed.

CI runs browser tests with `node scripts/test-browser.mjs --project=<engine>`. The runner owns Vite and Playwright, waits up to 30 seconds for readiness, and terminates both process groups if the server exits during the run. Its error includes the server exit code or signal. Vite stdout, stderr and the exit diagnostic are saved in `_local/playwright/server.log`, which the browser job uploads with its failure artifacts. Playwright's `webServer.timeout` bounds startup only, so the runner supervises the server for the whole run. Direct `pnpm exec playwright test` commands continue to use Playwright's server management. Run `node --test scripts/test-browser.test.mjs` to check crash handling and normal completion.

The [existing native runner](../scripts/interop/README.md) preserves earlier scenarios and supports `--list`, `--group` and `--scenario` selection. Run a bounded core and the cases matching a changed native boundary. Retain its summary and individual input/result JSON beside package evidence. A rejected or empty selection is a failure, not a zero-case pass. Record exact commands, reviewed commit, bundle/host hashes and failures. Preserve older release evidence.

```sh
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.10 --list
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.9 --group core --group native-search --group layout
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.10 --group core --group linked-files --group media --group portable-files
node scripts/interop/verify-native.mjs BUNDLE OUTPUT_DIRECTORY HOST_BINARY 0.0.10 --scenario SCENARIO_NAME
```

Groups are `core`, `host-controls`, `native-search`, `layout`, `linked-files`, `media`, `portable-files`, `integration`, `references`, `tables`, `source`, `diagrams`, `print` and `legacy`. Repeat `--group` or `--scenario` to select a union. `--list` lists selection without launching WKWebView; versions from 0.0.8 default to the bounded core. Explicitly select changed-contract cases and keep their evidence in a distinct output directory. Optional linked-file/media work uses the `linked-files` playground fixture, browser tag `@linked-files` and the corresponding native groups. These checks exercise local fixture resources and host callbacks; they do not establish consumer-app storage, permissions or native opening actions.

A native facade consumer establishes behaviour in WKWebView with its fixture bridge. Browser WebKit does not prove WKWebView behaviour, and neither proves a consumer app's native actions or compatibility with an external clipboard destination. Synthetic composition events test guards and transitions; they do not establish complete IME interoperability. Include those limits in the handover.

Run an external-app check only for a changed interoperability contract or a reproduced destination-specific bug. State the contract, application and transfer direction before testing one relevant case with disposable content. Reuse captured clipboard fixtures when an app is unnecessary. Do not routinely repeat Obsidian/Mail/consumer-app combinations or resume the unfinished 0.0.7 return matrix. Protect and restore the clipboard and affected preferences for native probes that use them; never use production notes or send mail.

An intentional assertion failure can demonstrate reporting only when explicitly selected and excluded from normal suites. Retain its expected non-zero exit and actionable diagnostics separately from passing evidence. An unrun test is unverified.

App integrations and app releases follow package publication as a separate delivery phase. Temporary `file:` dependencies must not enter merged app lockfiles.

Documentation-only changes to Markdown guides, the README or agent instructions run a formatting check and skip editor tests. Mintlify pages, assets and configuration run `mint validate`. Unknown file types, mixed changes and release runs retain the full checks. The workflow still starts for every pull request so required checks resolve; it skips expensive steps rather than filtering out the workflow.

## GitHub workflow

The [InkKit Project](https://github.com/users/aicayzer/projects/3) is the working roadmap. Issues describe outcomes and acceptance criteria; milestones group releases. [GitHub releases](https://github.com/aicayzer/inkkit/releases) record published versions and their verification evidence. Permanent client-app adoption remains separate work. Use feature-first Project views to track implementation, and version milestones to group delivery scope and publication status.

- **Roadmap** lists open feature issues, excluding release records, ideas and cancelled work.
- **Upcoming** groups the scheduled version milestones.
- **Delivery** shows Ready, In progress and Review work.
- **Feature board** shows feature status; **Ideas** and **Cancelled** retain separate decisions.

Use the version milestone to read scope and the publication checklist. These views are navigation aids; live issue acceptance criteria and milestone records remain authoritative. Keep implementation decisions with their issue rather than duplicating the backlog in documents.

- **Backlog:** scoped work awaiting readiness or dependencies.
- **Ready:** agreed and sufficiently scoped. This does not start an agent session.
- **In progress:** an authorised session is implementing the issue.
- **Review:** a reviewable result awaits acceptance or merge.
- **Done:** accepted implementation has merged, or a release has been published and verified.
- **Cancelled:** work will not proceed. Record the reason and close as **not planned**.

A delivery session names its issue or milestone and stopping point. Read the current issue, dependencies and relevant contracts; choose the implementation and delegate useful independent work. An issue being Ready is not publication authority.

Add new work to the Project. Keep unapproved ideas unscheduled with the `idea` label; remove it when scope is accepted. Link pull requests to their implementation issues and include relevant verification and remaining limitations. Use closing references for completed implementation. Keep future publication checklists and their results in milestone descriptions and release evidence; do not create new version-shaped release issues.

Main requires pull requests with passing CI and resolved review conversations. Use squash merges; merged remote branches are deleted automatically.

When stopping with work outstanding, leave a short issue update with the current state, decisions and next action. Update status when it changes; avoid routine progress narration. Close completed issues as **completed** and set **Done**. Generic closed-to-Done and automatic issue-closing workflows are disabled so cancellation and publication gates remain explicit.

Existing historical release issues retain their records. For future versions, complete the milestone publication checklist only after npm version, integrity and clean-consumer installation are verified. Review status or an open milestone does not authorise publication. App adoption and app releases are separate work. Follow [the publication procedure](releasing.md) before pushing a version tag.

Repository prose follows the Google developer documentation style guide. Keep issues, pull requests and comments concise; code comments explain reasons or constraints that the code cannot express.
