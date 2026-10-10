# Development

Use Node.js 26 and the package-manager version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm build:playground
```

`pnpm dev` starts the [development playground](playground.md); it does not start a browser automatically. `pnpm test:package` packs the built package, installs it in a fresh consumer with an isolated npm cache, checks declarations and CSS, and builds an offline single-file Vite page. The archive and `package-evidence.json` are written to ignored `_local/release/<version>/`, preserving evidence from earlier releases. Evidence records the commit, working-tree state, compressed SHA-256, npm integrity, decompressed tar SHA-256 and offline bundle SHA-256. Commit the candidate before recording final evidence; release verification rejects evidence from a dirty working tree.

The public API is `src/index.ts`. App hosts own persistence, native menus and file access. Regression tests cover formatting, source preservation, clipboard import/export, tables, snapshots, asynchronous image/file operations and optional wiki links. The clean consumer compiles `FileAdapter`, `WikiLinkAdapter`, their reference/context/presentation types and `EditorOptions` alongside the existing public facade. CI uses hosted runners.

## Bounded verification

Choose checks from the changed behaviour, not from every available fixture combination.

| Trigger                                                                                 | Required evidence                                                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate code or package changes                                                       | `pnpm check`, `pnpm format:check`, `pnpm build:playground`, actual packed-consumer verification and the small Chromium browser smoke.          |
| Changed editor behaviour                                                                | Focused regression tests and selected browser cases for the changed contract, including failure and untidy input.                              |
| Changed WKWebView, focus/input, bridge, clipboard, print or resource lifecycle boundary | Selected native core plus relevant feature cases from the existing WKWebView runner, using the actual candidate archive.                       |
| Source-only documentation change                                                        | Format and reference/example review; no native run is required. A README change affects the packed package, so refresh final package evidence. |
| Publication                                                                             | Clean committed candidate evidence, exact registry-version consumer and archive/integrity comparison under [releases](releasing.md).           |

Browser tests use the public facade and normal DOM interaction. Use [Playwright's standard CLI](https://playwright.dev/docs/test-cli) to list and select tests, inspect reports and open traces; see the [playground guide](playground.md). The fixture catalogue is selectable. Do not run its fixtures, configurations and adapters as a Cartesian matrix. CI runs the small Chromium smoke on GitHub-hosted Linux and macOS; WebKit and targeted cases remain selectable. Local results do not establish that hosted CI passed.

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
