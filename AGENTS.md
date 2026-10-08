# InkKit

InkKit is an MIT TypeScript Markdown editor published as `@aicayzer/inkkit`.

- Keep the exported facade independent of native storage, Marfa and app UI. Hosts do not import Milkdown internals.
- Preserve original source and unsupported syntax. Clipboard plain text is readable content; Markdown source is an explicit operation.
- Keep image references opaque. Native adapters own bytes, storage and private display URLs.
- Prefer maintained libraries that fit offline bundling and source preservation.
- Comments explain reasons or constraints that the code cannot express; do not narrate implementation.
- Use scoped Conventional Commits and feature branches. Preserve unrelated changes.
- Run `pnpm check` and `pnpm format:check`. Behavior changes need regression cases, including failures and untidy input.
- Use GitHub-hosted runners for this public repository.
- GitHub issues and milestones hold scope and decisions. Follow the GitHub workflow in `docs/development.md`; publication follows `docs/releasing.md`.
