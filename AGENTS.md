# InkKit

InkKit is an MIT TypeScript Markdown editor published as `@aicayzer/inkkit`.

- Keep the exported facade independent of native storage, Marfa and app UI. Hosts do not import Milkdown internals.
- Preserve original source and unsupported syntax. Clipboard plain text is readable content; Markdown source is an explicit operation.
- Keep image references opaque. Native adapters own bytes, storage and private display URLs.
- Use scoped Conventional Commits and feature branches. Preserve unrelated changes.
- Run `pnpm check` and `pnpm format:check`. Behavior changes need regression cases, including failures and untidy input.
- Use GitHub-hosted runners for this public repository.
- Development, host contracts and publication procedures are in `docs/`. Follow the manual first-release gate in `docs/releasing.md`.
