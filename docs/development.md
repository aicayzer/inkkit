# Development

Use Node.js 26 and the package-manager version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm build:playground
```

`pnpm dev` opens the development server; it does not start a browser automatically. `pnpm test:package` packs the built package, installs it in a fresh consumer, checks declarations and CSS, and builds an offline single-file Vite page. The tested tarball and hash are written to ignored `_local/release/`.

The public API is `src/index.ts`. App hosts own persistence, native menus and file access. Regression tests cover formatting, source preservation, clipboard import/export, tables, snapshots and asynchronous image operations. CI uses hosted runners.

Before publication, install the same tarball into isolated app integrations. Verify WKWebView behavior and real clipboard exchange with representative Markdown and rich-text applications using disposable content. The 0.0.1 record includes Obsidian and Apple Mail; Craft is an additional example, not a required destination. Do not use production notes or send mail. Browser-model tests do not prove native clipboard compatibility.

App integrations and app releases follow package publication as a separate delivery phase. Temporary `file:` dependencies must not enter merged app lockfiles.
