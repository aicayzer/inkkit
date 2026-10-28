# Editor internals

`src/core.ts` defines the package entry. `InkKitEditor` validates public calls, coordinates document generations and atomic operations, and delivers events after successful calls. Internal modules are not package exports or a host API.

## Input and assembly

- `editor-milkdown.ts` installs the dialect, views and plugins in their input and transaction order. It receives explicit policy and dispatch callbacks.
- `editor-keymap.ts` builds configured key handlers. Its callbacks return to the facade so keyboard operations use the same guards as public calls.
- `editor-input.ts` contains transaction-based input plugins. `editor-selection.ts` reads formatted caret state, and `editor-commands.ts` applies formatting commands.

## Document and source history

- `editor-document.ts` owns the loaded source, preservation instances, carried-block identities and successful save caches. Cache identity is scoped to a document load. It also supplies authored block text and temporary export documents without settling pending source.
- `editor-history.ts` owns pending source, typed undo steps and the permitted formatted redo tail. A pending source edit is already authoritative. Settling it updates the formatted document without another revision or change event. Dispatch reports accepted state transitions to history; the facade captures and restores its rollback state.
- `editor-source.ts` owns the source/TXT textarea, composition and input selection state, literal editing, and mode-switch selection and scroll mapping. Large textarea replacements retain the off-tree assignment needed by WebKit.

The collaborators receive the context, values or callbacks their responsibility needs. None receives an `InkKitEditor` instance. `DocumentSession` remains the owner of generation and revision identity; document caches and history do not create competing freshness counters.

## Readable text, viewport and search

- `editor-text.ts` owns readable projection identity, offset validation and selection. Its snapshot IDs derive from `DocumentSession`; capture and restore retain the projection associated with an atomic call.
- `editor-viewport.ts` owns viewport settings, visible ranges, geometry and scrolling through nested containers. It reuses callout unfolding and keeps textarea scroll handling separate from formatted geometry.
- `editor-search.ts` owns the literal query and the raw match behind a normalized textarea selection, including either half of CRLF. It applies search and readable-range replacements through narrow source-edit and preservation callbacks. Accepted edits invalidate the remembered match; mode changes and loads reset the query too.

The facade keeps public argument validation, readiness and mutation guards, and the ordering of focus, reveal and command-state events. It still coordinates load/reload, focus and mode transitions. Output, clipboard and the remaining command/lifecycle coordination await their separate extraction. [Development](development.md#bounded-verification) defines the verification gates for changes to these boundaries.
