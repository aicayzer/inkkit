# Editor internals

`src/core.ts` defines the package entry. `InkKitEditor` validates public calls, coordinates document generations and atomic operations, and delivers events after successful calls. Internal modules are not package exports or a host API.

## Input and assembly

- `editor-milkdown.ts` installs the dialect, views and plugins in their input and transaction order, and constructs replacement editor states. It receives explicit policy and dispatch callbacks; the facade installs document caches before dispatching the initial selection.
- `editor-keymap.ts` builds configured key handlers, their plugins and native key routing. Its callbacks return to the facade so keyboard operations use the same guards as public calls. Plugin handlers read the current bindings after a keymap change.
- `editor-policy.ts` applies input attributes and constructs editability, history-input and document-change plugins. The facade owns the predicates and the accepted-change sequence, including revision, cancellation, cache reads and event delivery.
- `editor-input.ts` contains transaction-based input plugins. `editor-selection.ts` reads formatted caret state, and `editor-commands.ts` applies formatting commands.

## Commands and activation

- `editor-insert.ts` applies formatted plain-text, native-text, path and image insertions. It receives checked arguments and reads authored text only when an operation needs it. The facade keeps source/TXT routing, mutation guards and focus decisions.
- `editor-links.ts` validates Markdown link destinations, applies link and shared-reference edits, and activates the selected link. Shared-reference edits return through the public method so nested calls retain the same atomic boundary.
- `editor-footnotes.ts` inserts and locates footnotes. Automatic numbering reads both authored text and parsed references; an explicit label does not need that source read.
- `editor-activation.ts` owns root link and footnote listeners and modifier tracking. The facade retains their installation and teardown order relative to clipboard, source and Milkdown.
- `editor-suggestions.ts` assembles slash/wiki providers, applies their transactions and handles host action results. The facade captures the current session and chosen state, validates the eventual commit and temporarily supplies the slash transaction's base state. Host action failures and editor insertion failures retain separate reporting paths.
- `editor-focus.ts` releases text-surface focus and captures/restores selection, focus and scroll around reload. The facade owns load/mode transitions and suppresses intermediate command-state events.

## Document and source history

- `editor-document.ts` owns the loaded source, preservation instances, carried-block identities and successful save caches. Cache identity is scoped to a document load. It also supplies authored block text and temporary export documents without settling pending source.
- `editor-history.ts` owns pending source, typed undo steps and the permitted formatted redo tail. A pending source edit is already authoritative. Settling it updates the formatted document without another revision or change event. Dispatch reports accepted state transitions to history; the facade captures and restores its rollback state.
- `editor-source.ts` owns the source/TXT textarea, composition and input selection state, literal editing, and mode-switch selection and scroll mapping. Large textarea replacements retain the off-tree assignment needed by WebKit.

The collaborators receive the context, values or callbacks their responsibility needs. None receives an `InkKitEditor` instance. `DocumentSession` remains the owner of generation and revision identity; document caches and history do not create competing freshness counters.

## Readable text, viewport and search

- `editor-text.ts` owns readable projection identity, offset validation and selection. Its snapshot IDs derive from `DocumentSession`; capture and restore retain the projection associated with an atomic call.
- `editor-viewport.ts` owns viewport settings, visible ranges, geometry and scrolling through nested containers. It reuses callout unfolding and keeps textarea scroll handling separate from formatted geometry.
- `editor-search.ts` owns the literal query and the raw match behind a normalized textarea selection, including either half of CRLF. It applies search and readable-range replacements through narrow source-edit and preservation callbacks. Accepted edits invalidate the remembered match; mode changes and loads reset the query too.

The facade keeps public declarations, argument validation, readiness and mutation guards, and the ordering of focus, reveal and command-state events. It coordinates load/reload, focus, mode transitions and destruction. Its transaction gate validates the final document after appended plugins, restores refused calls and delivers queued events only after a successful call. [Development](development.md#bounded-verification) defines the verification gates for changes to these boundaries.

## Output and clipboard

- `editor-output.ts` owns export cancellation and preparation of portable clipboard and printable documents. It reads temporary export documents without settling pending source history. The facade supplies the validated snapshot, session capture and final freshness guard; the guard still runs from the export cleanup path, so staleness can supersede an export failure.
- `editor-clipboard.ts` owns the capturing copy/cut listeners and local-copy provenance. It retains authored private comments only for matching text and HTML from this editor, clears provenance at the existing load, source replacement and destruction boundaries, and leaves TXT copying to the source surface.
- Source and formatted portable cuts use one deferred pipeline: prepare output, refuse missing image or diagram output, await the host clipboard write, retain provenance, validate the original capture and delete the captured selection. A selection movement does not redirect deletion; a document or editability change prevents it. Synchronous ordinary copies retain their surface-specific fallback and event handling.

Output records provenance through a narrow clipboard callback. Neither collaborator owns document freshness, public validation or the facade's atomic/event boundary. The facade cancels output at accepted edits and lifecycle transitions, and destroys clipboard listeners before the source surface and Milkdown.

## Source preservation

`Preservation` coordinates source retention and decides whether a changed document can be saved. Its extracted algorithms do not own editor state or document generations:

- `preserve-types.ts`, `preserve-shape.ts` and `preserve-parse.ts` define source-tree shapes, structural comparisons and parsing/serialization instrumentation.
- `preserve-alignment.ts` matches original and edited blocks, retaining the existing matching and similarity budgets.
- `preserve-inline.ts`, `preserve-list.ts`, `preserve-table.ts` and `preserve-literal.ts` retain authored spelling within their syntax. `preserve-containers.ts` handles split and joined containers through an explicit retention callback; `preserve-retain.ts` coordinates recursive node retention.

The remaining collaborators separate state by responsibility:

- `preserve-source.ts` owns the loaded trees, authored block offsets, canonical forms and incremental source reading. Reuse is tied to the same parser context and loaded source.
- `preserve-context.ts` validates block edits with the definition context they need. `preserve-local.ts` owns validated block/item caches; `preserve-regions.ts` validates changed regions and neighbours.
- `preserve-moves.ts` tracks carried block identities and correspondence for the current save. `preserve-reconstruction.ts` assembles authored and newly written pieces, including list boundaries and changed link forms.

`Preservation` selects the local, regional or whole-document path and retains final reparse validation. It also owns the recent-instance cache and cross-check policy. Collaborators receive only the fields and operations they use; they do not receive the coordinator or an editor. Temporary move and link-rewrite state is cleared after each attempt. The extraction keeps fallback eligibility, cache lifetimes, work budgets and exact output unchanged.

## Shared primitives

- `bom.ts` recognises or removes exactly one leading byte-order mark. Callers retain control of parser offsets, incremental-read eligibility and saved output.
- `text-edges.ts` finds non-overlapping matching UTF-16 prefixes and suffixes. Callers keep source mapping and syntax-boundary adjustments; comparisons involving hard-break identity or syntax-node arrays stay with their owning algorithms.
- `portable-image.ts` shares byte encoding and the exact lowercase image MIME allowlist. Clipboard, paste and print retain their own MIME coercion, case, base64 and image-validation rules.
