# Development

Use Node.js 26 and the package-manager version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm build:playground
```

`pnpm dev` opens the development server; it does not start a browser automatically. `pnpm test:package` packs the built package, installs it in a fresh consumer with an isolated npm cache, checks declarations and CSS, and builds an offline single-file Vite page. The archive and `package-evidence.json` are written to ignored `_local/release/<version>/`, preserving evidence from earlier releases. Evidence records the commit, working-tree state, compressed SHA-256, npm integrity, decompressed tar SHA-256 and offline bundle SHA-256. Commit the candidate before recording final evidence; release verification rejects evidence from a dirty working tree.

The public API is `src/index.ts`. App hosts own persistence, native menus and file access. Regression tests cover formatting, source preservation, clipboard import/export, tables, snapshots and asynchronous image operations. CI uses hosted runners.

Before publication, install the same tarball into isolated app integrations. Verify WKWebView behavior and real clipboard exchange with representative Markdown and rich-text applications using disposable content. The 0.0.1 record includes Obsidian and Apple Mail; Craft is an additional example, not a required destination. Do not use production notes or send mail. Browser-model tests do not prove native clipboard compatibility.

App integrations and app releases follow package publication as a separate delivery phase. Temporary `file:` dependencies must not enter merged app lockfiles.

## GitHub workflow

The [InkKit Project](https://github.com/users/aicayzer/projects/3) is the working roadmap. Issues describe outcomes and acceptance criteria; milestones group releases. Versions 0.0.6 and 0.0.7 are published and verified, completing the authorised table refinements and editing tools delivery. Version 0.0.7 implementation began after the 0.0.6 release gate closed. Later roadmap work and permanent client-app adoption require separate delivery scope. Keep implementation decisions with their issue rather than duplicating the backlog in documents.

- **Backlog:** scoped work awaiting readiness or dependencies.
- **Ready:** agreed and sufficiently scoped. This does not start an agent session.
- **In progress:** an authorised session is implementing the issue.
- **Review:** a reviewable result awaits acceptance or merge.
- **Done:** accepted implementation has merged, or a release has been published and verified.
- **Cancelled:** work will not proceed. Record the reason and close as **not planned**.

A delivery session names its issue or milestone and stopping point. Read the current issue, dependencies and relevant contracts; choose the implementation and delegate useful independent work. An issue being Ready is not publication authority.

Add new work to the Project. Keep unapproved ideas unscheduled with the `idea` label; remove it when scope is accepted. Link pull requests to their implementation issues and include relevant verification and remaining limitations. Use closing references for completed implementation, not for release issues that still await publication.

Main requires pull requests with passing CI and resolved review conversations. Use squash merges; merged remote branches are deleted automatically.

When stopping with work outstanding, leave a short issue update with the current state, decisions and next action. Update status when it changes; avoid routine progress narration. Close completed issues as **completed** and set **Done**. Generic closed-to-Done and automatic issue-closing workflows are disabled so cancellation and publication gates remain explicit.

A release issue stays open until npm version, integrity and clean-consumer installation are verified. App adoption and app releases are separate work. Follow [the publication procedure](releasing.md) before pushing a version tag.

Repository prose follows the Google developer documentation style guide. Keep issues, pull requests and comments concise; code comments explain reasons or constraints that the code cannot express.
