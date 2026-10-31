# Inkkit

Inkkit is an MIT TypeScript Markdown editor for the web and for apps that host a web view, published to npm as `@aicayzer/inkkit`. It is built on Milkdown and ProseMirror. Native apps bundle it into one offline page in a `WKWebView`; each app is a separate repository.

Checks, CI lanes and releases are in [development](docs/maintainers/development.md) and [releasing](docs/maintainers/releasing.md). This file holds the rules those pages do not.

## What belongs in Inkkit and what belongs in the host

Inkkit owns what happens to the document inside the editor root:

- Markdown parsing, the supported dialect and source preservation ([preservation](docs/concepts/preservation.mdx), [Markdown support](docs/concepts/markdown.mdx)).
- Editing behavior in formatted, source and TXT modes: formatting, tables, footnotes, references, callouts, comments, image placement, find and replace, undo history, and the composition, generation and read-only guards.
- Paste and drop import and its safety: web HTML, spreadsheets, plain text and link schemes.
- What it draws: code highlighting, diagram validation and Pele previews, file and media cards, and their labels, focus and keyboard access.
- Portable output: clipboard text, HTML and Markdown, and printable HTML with embedded assets.
- The public facade in `src/core.ts`: exports, events, adapter interfaces, `InkKitError` codes, labels and `--inkkit-*` tokens, each documented in [the API reference](docs/reference/).

The host owns everything outside the editor root, and anything that needs storage, the platform or a product decision:

- Files, saving, autosave policy, sync, and what to do when a snapshot fails.
- Image and file bytes, references, display URLs, permissions and cleanup, through `ImageAdapter`, `FileAdapter` and `WikiLinkAdapter`.
- Windows, toolbars, menus, the search field, headers, titles and metadata. Inkkit takes shortcut choices through `keymap`, localized text through `labels` and appearance through tokens.
- Writing the native clipboard, Print and PDF dialogs, and opening links and files (`openLink`, `WikiLinkAdapter.open`, `FileAdapter.open`, `FileAdapter.contextMenu`).
- Anything specific to one app.

To place a new case: if two hosts would build it the same way and it needs no storage, platform or product knowledge, it belongs in Inkkit. Otherwise Inkkit offers an adapter, event, option or token and the host decides. A host workaround, such as matching an error message, toggling a class Inkkit's CSS reads or styling `.ProseMirror`, points to a gap in the facade. Fix the facade instead of documenting the workaround.

## Rules that follow from the boundary

- Keep native storage, app names and app UI out of the facade. Hosts import only the documented entries in `package.json` `exports`: `@aicayzer/inkkit`, `@aicayzer/inkkit/core` and the stylesheets. Internal classes and markup are not a styling API.
- The package bundles every runtime dependency, so hosts run the tree Inkkit tested. A dependency update is a lockfile change in a pull request ([dependencies](docs/maintainers/development.md#dependencies)).
- Keep image and file references opaque. Never infer a storage path, fetch from the network or export a private display URL.
- Everything runs offline from one bundled page. Prefer maintained libraries that bundle offline and do not rewrite source. Only the main entry (`src/index.ts`, through `src/pele.ts`) registers Pele and DOMPurify; the `core` entry must bundle without either.
- A failed operation changes nothing and reports an `InkKitError` with a documented code. A failed snapshot is never an unchanged document.
- Ordinary copy is readable text and semantic HTML. Markdown source is an explicit operation.

## Verification

Choose checks from the changed behavior with the table in [bounded verification](docs/maintainers/development.md#bounded-verification). Report omitted checks, and keep local, hosted CI, `WKWebView` and consumer-app evidence distinct, because one does not establish another. The [native runner](scripts/interop/README.md) documents its build and run recipe.

## Conventions

- Public-facing prose uses **Inkkit**. Keep package names and API identifiers such as `InkKitEditor` and `InkKitError` unchanged. Use the [brand assets and palette](docs/images/brand/README.md) and keep Mintlify's native component styling.
- `docs/` is the Mintlify site, configured by `docs/docs.json`. Maintainer guides live in `docs/maintainers/`, which `docs/.mintignore` keeps off the site. Give each fact one page and link to it from others.
- Repository prose follows the Google developer documentation style guide. Code comments explain reasons or constraints the code cannot show.
- A behavior change needs a regression test that fails without it, through the public facade, including failure and untidy input: CRLF, unusual list markers, Unicode, composition, stale generations.
- A public API change updates `docs/reference/`, and any concept or guide page that describes it, in the same pull request. `pnpm test:docs` fails when the reference leaves out an export, member, option, event or label.
- A performance claim cites a measurement: command, machine, document and before and after medians. Record lasting results in `docs/maintainers/performance.md`.
- Use feature branches and scoped Conventional Commits, and preserve unrelated changes. `main` takes squash-merged pull requests with passing CI and resolved conversations.
- CI uses GitHub-hosted runners only, because the repository is public.
- Change the version or push a tag only in an authorized release.
- Inkkit is in early development. Releases use patch increments within the current minor version. A minor or major increment needs an explicit instruction naming the target version; general implementation or release approval does not authorize it.
- Adopting a release in a host is separate work in that host's repository, after publication. Temporary `file:` dependencies never reach a host's merged lockfile.
- Record a decision on its GitHub issue; version milestones hold release scope.

## Code Review Rules

Report problems that a host or a person would meet: changed source, unsafe import, a broken public contract or missing evidence. Leave formatting, lint and type errors to CI, and do not ask for refactors or naming changes.

### Source preservation

- Flag a change that can alter bytes of an unedited document, bytes outside the edited block, or unsupported syntax. The safe path parses the rebuilt source again; a mismatch rejects the edit with `preservation` and leaves the document, revision and history unchanged.
- Flag a new syntax or editing path without a test that saves, reopens and compares the bytes.
- Flag new syntax in `src/dialect.ts` that can span blocks or change how other blocks read, as link definitions, HTML and `%%` comments do, unless `localEdits` and `regions` in `src/preserve.ts` keep text holding it on the whole-document path. Those paths validate an edit by reading only the changed blocks and their neighbors.

### Import safety

- Flag HTML paste or drop that inserts content without `importableSlice` in `src/html-import.ts`. HTML import keeps only what reads back as the same structure in GitHub Flavored Markdown, strict CommonMark and CommonMark without raw HTML, with no refused link address. The safe path imports the simpler form. Markdown and plain-text paste keep their text as authored and are exempt.
- Flag a scheme added to `src/link-safety.ts`, a loosened diagram check in `src/diagram-validation.ts` or `src/pele.ts`, or any path that executes pasted or authored HTML.

### Boundary and public API

- Flag app names, storage paths, network access, `window.webkit` or a private display URL in `src/` or in exported output. Flag an import of `pele` or `dompurify` reachable from `src/core.ts`.
- Flag a change to the exports, options, adapter types, events, error codes, labels or tokens without the matching change in `docs/reference/`, and a removal or rename without migration notes for current hosts.
- Flag a new failure reported to the host as a plain `Error` instead of an `InkKitError` code.

### Evidence

- Flag a behavior change without a regression test, and a performance claim without a measurement.
- Flag a claim that browser WebKit or a fixture host proves `WKWebView` or app behavior.
