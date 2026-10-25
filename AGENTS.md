# Inkkit

Inkkit is an MIT TypeScript Markdown editor for the web and for apps that host a web view, published to npm as `@aicayzer/inkkit`. It is built on Milkdown and ProseMirror. Memos and PadPad bundle it into one offline page in a `WKWebView`; each is a separate repository.

## What belongs in Inkkit and what belongs in the host

Inkkit owns what happens to the document inside the editor root:

- Markdown parsing, the supported dialect and source preservation ([preservation](docs/preservation.md), [supported syntax](docs/supported-syntax.md)).
- Editing behavior in formatted, source and TXT modes: formatting, tables, footnotes, references, callouts, comments, image placement, find and replace, undo history, and the composition, generation and read-only guards.
- Paste and drop import and its safety: web HTML, spreadsheets, plain text and link schemes.
- What it draws: code highlighting, Mermaid validation and previews, file and media cards, and their labels, focus and keyboard access.
- Portable output: clipboard text, HTML and Markdown, and printable HTML with embedded assets.
- The public facade in `src/core.ts`: exports, events, adapter interfaces, `InkKitError` codes, labels and `--inkkit-*` tokens, each documented in [the API reference](docs/api.md).

The host owns everything outside the editor root, and anything that needs storage, the platform or a product decision:

- Files, saving, autosave policy, sync, and what to do when a snapshot fails.
- Image and file bytes, references, display URLs, permissions and cleanup, through `ImageAdapter`, `FileAdapter` and `WikiLinkAdapter`.
- Windows, toolbars, menus, the search field, headers, titles and metadata. Inkkit takes shortcut choices through `keymap`, localized text through `labels` and appearance through tokens.
- Writing the native clipboard, Print and PDF dialogs, and opening links and files (`openLink`, `WikiLinkAdapter.open`, `FileAdapter.open`, `FileAdapter.contextMenu`).
- Marfa and anything specific to one app.

To place a new case: if two hosts would build it the same way and it needs no storage, platform or product knowledge, it belongs in Inkkit. Otherwise Inkkit offers an adapter, event, option or token and the host decides. A host workaround, such as matching an error message, toggling a class Inkkit's CSS reads or styling `.ProseMirror`, points to a gap in the facade. Fix the facade instead of documenting the workaround.

Rules that follow from the boundary:

- Keep the facade free of native storage, Marfa, app names and app UI. Hosts import only `@aicayzer/inkkit`, `@aicayzer/inkkit/core` and `@aicayzer/inkkit/style.css`. Internal classes and markup are not a styling API.
- The package bundles every runtime dependency except Mermaid, so hosts run the tree Inkkit tested; a dependency update is a lockfile change in a pull request ([development](docs/development.md#dependencies)).
- Keep image and file references opaque. Never infer a storage path, fetch from the network or export a private display URL.
- Everything runs offline from one bundled page. Prefer maintained libraries that bundle offline and do not rewrite source. Only `src/index.ts` registers Mermaid; the `core` entry must bundle without it.
- A failed operation changes nothing and reports an `InkKitError` with a documented code. A failed snapshot is never an unchanged document.
- Ordinary copy is readable text and semantic HTML. Markdown source is an explicit operation.

## Build and verify

Use Node.js 22.14 or later (CI runs 26) and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check            # typecheck, Vitest, build, API reference check, packed-consumer test (opens Chromium and WebKit)
pnpm format:check     # Prettier; `pnpm format` rewrites
pnpm build:playground
pnpm test:built-playground  # opens the built page; needs the build first
```

- One unit file: `pnpm exec vitest run test/<name>.test.ts`.
- Browser tests use Playwright against the playground: `pnpm exec playwright install chromium webkit` once, then `pnpm exec playwright test --project=chromium test/browser/<name>.spec.ts`. For code, dependency and workflow changes, CI runs every browser test, in Chromium on Linux and in WebKit on macOS, and both jobs must pass. Before pushing, run the specs for what you changed, in WebKit too when selection, input, clipboard or layout changes. A test that cannot run in an engine calls `test.skip` with the reason.
- The native runner in `scripts/interop/` tests the packed candidate in a real `WKWebView`. Run selected groups when focus, input, the bridge, clipboard, print or resource lifecycle changes. Browser WebKit does not prove `WKWebView` behavior. A rejected or empty selection is a failure, not a pass.
- Documentation-only edits run a formatting check and skip editor and browser tests. Mintlify page, asset or configuration changes validate the site. Release runs retain all checks.
- Choose checks from the changed behavior, not every fixture and configuration; [development](docs/development.md) has the table. Say which checks you did not run. A local pass does not show that hosted CI passed.

## Conventions

- Public-facing prose uses **Inkkit**. Keep package names and API identifiers such as `InkKitEditor` and `InkKitError` unchanged. Use the [brand assets and palette](docs/images/brand/README.md); retain Mintlify’s native component styling.

- A behavior change needs a regression test that fails without it, through the public facade, including failure and untidy input: CRLF, unusual list markers, Unicode, composition, stale generations.
- During the Mintlify migration, maintain essential factual corrections in the existing guides. Replace each guide once; do not keep a second hand-maintained copy for the website. Development and release procedures remain repository documentation.
- A public API change updates `docs/api.md`, and any of `integration.md`, `supported-syntax.md` and `preservation.md` that describe it, in the same pull request.
- A performance claim cites a measurement: command, machine, document and before and after medians. Record lasting results in `docs/performance.md`.
- Comments explain reasons or constraints the code cannot show.
- Use feature branches and scoped Conventional Commits, and preserve unrelated changes. `main` takes squash-merged pull requests with passing CI and resolved conversations.
- CI uses GitHub-hosted runners only, because the repository is public.
- Repository prose follows the Google developer documentation style guide.
- Change the version or push a tag only in an authorized release ([releasing](docs/releasing.md)).

## Where scope and decisions live

- GitHub issues hold outcomes, acceptance criteria and decisions; record a decision on its issue. Version milestones hold release scope and the publication checklist. The [Inkkit Project](https://github.com/users/aicayzer/projects/3) is the roadmap.
- [Development](docs/development.md) has the GitHub workflow and verification policy; [releasing](docs/releasing.md) has publication.
- Adopting a release in a host is separate work in that host's repository, after publication. Temporary `file:` dependencies never reach a host's merged lockfile.

## Code Review Rules

Report problems that a host or a person would meet: changed source, unsafe import, a broken public contract or missing evidence. Leave formatting, lint and type errors to CI, and do not ask for refactors or naming changes.

### Source preservation

- Flag a change that can alter bytes of an unedited document, bytes outside the edited block, or unsupported syntax. Safe path: the rebuilt source is parsed again, and a mismatch rejects the edit with `preservation` and leaves the document, revision and history unchanged.
- Flag a new syntax or editing path without a test that saves, reopens and compares the bytes.
- Flag new syntax in `src/dialect.ts` that can span blocks or change how other blocks read, as link definitions, HTML and `%%` comments do, unless `localEdits` and `regions` in `src/preserve.ts` keep text holding it on the whole-document path. Those paths validate an edit by reading only the changed blocks and their neighbors.

### Import safety

- Flag HTML paste or drop that inserts content without `importableSlice` in `src/html-import.ts`. HTML import keeps only what reads back as the same structure in GitHub Flavored Markdown, strict CommonMark and CommonMark without raw HTML, with no refused link address. Safe path: import the simpler form. Markdown and plain-text paste keep their text as authored and are exempt.
- Flag a scheme added to `src/link-safety.ts`, a loosened Mermaid check in `src/mermaid.ts`, or any path that executes pasted or authored HTML.

### Boundary and public API

- Flag host knowledge in `src/`: app names, Marfa, storage paths, network access, `window.webkit`, or a private display URL in exported output. Flag an import of the `mermaid` package reachable from `src/core.ts`.
- Flag a change to the exports, options, adapter types, events, error codes, labels or tokens without the matching `docs/api.md` change, and a removal or rename without migration notes for current hosts.
- Flag a new failure reported to the host as a plain `Error` instead of an `InkKitError` code.

### Evidence

- Flag a behavior change without a regression test, and a performance claim without a measurement.
- Flag a claim that browser WebKit or a fixture host proves `WKWebView` or app behavior.
