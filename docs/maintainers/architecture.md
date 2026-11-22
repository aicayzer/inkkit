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
- `editor-activation.ts` owns root link, link menu and footnote listeners and modifier tracking. `link-hint.ts` draws the hover hint outside the document, and `link-target.ts` finds the link a DOM element belongs to. The facade retains their installation and teardown order relative to clipboard, source and Milkdown.
- `editor-suggestions.ts` assembles slash/wiki providers, applies their transactions and handles host action results. The facade captures the current session and chosen state, validates the eventual commit and temporarily supplies the slash transaction's base state. Host action failures and editor insertion failures retain separate reporting paths.
- `editor-focus.ts` releases text-surface focus and captures/restores selection, focus and scroll around reload. The facade owns load/mode transitions and suppresses intermediate command-state events.

## Document formats

`formats/` holds one `FormatHandler` per document format: `markdown.ts`, `text.ts` and `rich-text.ts`, registered in `formats/index.ts`, with the shared interface in `formats/types.ts`. A handler states what differs by format: how text loads and reads into the formatted document, whether only the literal surface edits it, whether source mode and headings exist, how the literal surface pastes and inserts text, and how the format prints and fills the clipboard. Its `promise` is the public `FormatPromise`.

`EditorDocument` sets the handler on each load, and the facade and its collaborators read its fields directly, so a keystroke does no lookup. The Markdown handler wraps `Preservation`, the dialect parser, Markdown printing and the portable Markdown clipboard. The shared schema in `dialect.ts` also serves RTF: its paragraph has an `align` attribute that only RTF sets, which Markdown's DOM rule never reads and its writer ignores. The TXT handler reaches none of them. `test/formats/boundary.test.ts` walks the runtime import graph of each non-Markdown handler and fails if it reaches `preserve*.ts`, `dialect.ts`, `html-import.ts` or `paste-html.ts`. Format commands, tables and block moves follow `literalOnly`, because a literal-only format has no formatted surface.

### Rich text

An RTF document reaches the editor as the JSON `RichTextDocument` that the host's `InkKitRTF` converter produced. The editor never parses or writes RTF.

- `rich-text-model.ts` mirrors `apple/Sources/InkKitRTF/Validation.swift`: it checks a loaded document, reports the first bad path as `invalid-argument`, and builds the canonical form (sorted marks, a link's underline removed, merged runs, NFC text, default `align` and `start` left out). Keep the two in step; the golden files in `test/formats/rtf/fixtures/` are the shared contract, and the Swift tests write them.
- Inside the editor, an RTF document's text is the canonical JSON of its document. `EditorDocument.original`, `changed` comparisons, `dirty` and save caches work on that string as they do on Markdown, and the facade turns it into `document` only for public snapshots. Preservation's line cleanup (`cleanSourceDoc`) is skipped, because an RTF break is content.
- `rich-text-prose.ts` maps between the JSON and the shared schema: paragraphs carry the `align` attribute, which only this module and the alignment commands set; lists map to `bullet_list` and `ordered_list` with tight items; a table's first row becomes the header row and is written back first. It also holds `allows`, the transaction check behind the `richTextGuard` plugin in `editor-milkdown.ts`, which reads only the changed range and its ancestors.
- `rich-text-import.ts` converts pasted HTML and text through `DOMParser` and link safety, without Markdown's HTML import.
- Markdown behaviour is gated by `FormatHandler.markdownInput` through `format-input.ts`: input rules other than smart punctuation return no transaction, and bare-address linking stops. Command availability masks the commands RTF can't hold in `editor-commands.ts`.
- `formats/convert.ts` converts between Markdown and RTF for `convertDocument`. It is the one module that reads both formats; `rich-text.ts` doesn't import it, so the boundary test still holds.

The editor's type argument is its offered formats, defaulting to `TextDocumentFormat`, so code written for Markdown and TXT keeps text snapshots. `mount` has an overload for each case; the text-only one is last, because `Parameters<typeof InkKitEditor.mount>` reads the last overload.

## Document and source history

- `editor-document.ts` owns the loaded format handler, the loaded source, the format sources read from it, carried-block identities and successful save caches. Cache identity is scoped to a document load. It also supplies authored block text and temporary export documents without settling pending source.
- `editor-history.ts` owns pending source, typed undo steps and the permitted formatted redo tail. A pending source edit is already authoritative. Settling it updates the formatted document without another revision or change event. Dispatch reports accepted state transitions to history; the facade captures and restores its rollback state.
- `editor-source.ts` owns the source/TXT textarea, composition and input selection state, literal editing, and mode-switch selection and scroll mapping. Large textarea replacements retain the off-tree assignment needed by WebKit.

The collaborators receive the context, values or callbacks their responsibility needs. None receives an `InkKitEditor` instance. `DocumentSession` remains the owner of generation and revision identity; document caches and history do not create competing freshness counters.

## Readable text, viewport and search

- `editor-text.ts` owns readable projection identity, offset validation and selection. Its snapshot IDs derive from `DocumentSession`; capture and restore retain the projection associated with an atomic call.
- `editor-viewport.ts` owns viewport settings, visible ranges, geometry and scrolling through nested containers. It reuses callout unfolding and keeps textarea scroll handling separate from formatted geometry.
- `editor-search.ts` owns the literal query and the raw match behind a normalized textarea selection, including either half of CRLF. It applies search and readable-range replacements through narrow source-edit and preservation callbacks. Accepted edits invalidate the remembered match; mode changes and loads reset the query too.

The facade keeps public declarations, argument validation, readiness and mutation guards, and the ordering of focus, reveal and command-state events. It coordinates load/reload, focus, mode transitions and destruction. Its transaction gate validates the final document after appended plugins, restores refused calls and delivers queued events only after a successful call. [Development](development.md#bounded-verification) defines the verification gates for changes to these boundaries.

## Output and clipboard

- `editor-output.ts` owns export cancellation and the freshness checks around portable clipboard and printable output, which the format handler prepares. It reads temporary export documents without settling pending source history. The facade supplies the validated snapshot, session capture and final freshness guard; the guard still runs from the export cleanup path, so staleness can supersede an export failure.
- `editor-clipboard.ts` owns the capturing copy/cut listeners and local-copy provenance. It retains authored private comments only for matching text and HTML from this editor, clears provenance at the existing load, source replacement and destruction boundaries, and leaves TXT copying to the source surface.
- Source and formatted portable cuts use one deferred pipeline: prepare output, refuse missing image or diagram output, await the host clipboard write, retain provenance, validate the original capture and delete the captured selection. A selection movement does not redirect deletion; a document or editability change prevents it. Synchronous ordinary copies retain their surface-specific fallback and event handling.

Output records provenance through a narrow clipboard callback. Neither collaborator owns document freshness, public validation or the facade's atomic/event boundary. The facade cancels output at accepted edits and lifecycle transitions, and destroys clipboard listeners before the source surface and Milkdown.

## Display preferences

`display.ts` holds the preferences that the editor reads when a document loads, so a load starts from the current settings. `setDisplayPreferences` applies them to the loaded document in one transaction outside the history, and both plugins keep their state in the editor state, so nothing reaches the document or its saved text.

- `heading-fold.ts` keeps the folded top-level headings in plugin state, each with the range it hides, and maps them through each transaction. One pass over the top-level blocks finds every section's end. An edit that stays inside one block and keeps its type, markup and the block count moves positions by mapping alone, and any other change reads the document once for all sections. A heading that moves, by a block move or by its undo or redo, is found again by its node, so it keeps its fold. Node decorations hide the covered blocks and carry each heading's fold state. A heading view puts a top-level heading in a wrapper beside its button, with the heading as the view's content, so the button is outside the heading's text and name. A heading that cannot fold, and every heading while the option is off, is the plain schema element. The decoration changes when the option or a fold changes, which makes ProseMirror ask the view whether it still fits. The plugin's state update is where the selection rule lives: a selection that reaches a section's hidden range without covering the whole section opens it in the same transaction, for every selection change, so paste, typing, keys, composition, cut and drop act on shown text. `refuseFoldedEdit` is the check that remains for a collapsed caret: `InkKitEditor` calls it before it applies a transaction, and a transaction whose steps touch a section's hidden range without covering the section is not applied and unfolds the section instead. A section that a selection or the check opened is also kept in plugin state as not yet shown: a range of the document with the epoch at which it opened, mapped through every transaction, so it survives display updates, a change to the heading and any edit around it. The plugin view clears it only after a paint: a `requestAnimationFrame` callback, which runs before its own frame is painted, starts a `setTimeout(0)` that runs after. While `document.visibilityState` is `hidden`, or the editor isn't rendered, nothing clears it, and the wait starts again on `visibilitychange` or a poll. Until then `refuseFoldedEdit` refuses any edit whose steps touch it, covering the section or not. It reads every step's affected range, including mark, node-mark and attribute steps, whose step maps are empty, so formatting is refused like an edit. `holdFoldOpening` postpones the selection rule while a find session moves the selection through its transient places, so only the final selection opens a fold. `InkKitEditor.refusesHiddenText` applies the check to every transaction and reports `hidden-text`: a host call throws it, and any other input, which the editor consumes, goes to `events.error`. The clipboard handler asks it before it writes a cut, so a refused cut writes nothing. The section stays open. Coverage comes from the transaction's own steps, never the live selection, so a cut that waited on the host clipboard deletes what it captured. A host operation that names its target (`replace`, `replaceAll`, `replaceTextRange`), a history step, a source replacement and a block move skip it. The cost that remains with many folded sections is ProseMirror's: each update looks at every top-level decoration for every top-level block, which `docs/maintainers/performance.md` records.
- `code-line-numbers.ts` gives each code block a view that keeps a gutter of numbers beside the `code` element, so no node of the gutter is inside the text the browser edits. The digit count is a custom property on the block. Without wrapping every line is one line tall, so the gutter is one element that draws every number from one data attribute, and no per-line node exists. While lines wrap, the gutter has an entry for each line holding a hidden mirror of it, built from the same highlight classes as the code (the highlight decorations keep their classes in their spec) and drawing its text from `data-text` attributes through `::before`, with the code's font, width and wrapping, so the browser places each number by flow and nothing measures. A font, token or width change reflows the mirror with the text. The mirror is `visibility: hidden` and `aria-hidden`, and holds no text node, so it never enters a DOM range. A node decoration on each block makes ProseMirror ask its view whether it still fits when the option changes. `code-block-decorations.ts` redecorates only the code blocks an edit touched, from each step's own range, and highlighting shares it.
- `selection.ts` repaints when the DOM under a painted range was replaced, which a decoration or a view can do without changing the document or selection.
- A block that holds a control, such as a code block with its copy and language buttons, is not a plain block for `selection.ts`, so the painted selection splits into one range for each such block. `drawn-selection.ts` starts each range's walk at the range, so the cost does not grow with the document for each range.

## Diagram rendering

`src/index.ts` registers the Pele renderer from `pele.ts`. That module validates parsed models against Inkkit's supported diagram policy and sanitizes SVG with DOMPurify. The `core` entry reaches neither dependency. `diagram-validation.ts` retains the supported families, source limits and refusals independently of the renderer.

Each editor owns a `DiagramStore` from `mermaid.ts`. It retains geometry for diagram sources in the current document, removes obsolete entries after edits, and clears the store on document replacement or destruction. Preview jobs yield between diagrams and defer hidden or offscreen cards. Clipboard and print reuse the same geometry.

`diagram-theme.ts` applies presentation separately from layout: it gives each placement unique SVG IDs, maps renderer variables to private theme variables for previews, and embeds the light palette and fonts for portable output. The source and saved Markdown do not contain renderer choices, palette settings or generated SVG.

## Source preservation

`Preservation` coordinates source retention and decides whether a changed document can be saved. Its extracted algorithms do not own editor state or document generations:

- `preserve-types.ts`, `preserve-shape.ts` and `preserve-parse.ts` define source-tree shapes, structural comparisons and parsing/serialization instrumentation.
- `preserve-alignment.ts` matches original and edited blocks, retaining the existing matching and similarity budgets.
- `preserve-inline.ts`, `preserve-list.ts`, `preserve-table.ts` and `preserve-literal.ts` retain authored spelling within their syntax. `preserve-containers.ts` handles split and joined containers through an explicit retention callback; `preserve-retain.ts` coordinates recursive node retention.

The remaining collaborators separate state by responsibility:

- `preserve-source.ts` owns the loaded trees, authored block offsets, canonical forms and incremental source reading. Reuse is tied to the same parser context and loaded source.
- `preserve-context.ts` validates block edits with the definition context they need. `preserve-local.ts` owns validated block/item caches; `preserve-item-regions.ts` validates structural item runs within bullet and task lists; `preserve-regions.ts` validates changed top-level regions and neighbours.
- `preserve-moves.ts` tracks carried block identities and correspondence for the current save. `preserve-reconstruction.ts` assembles authored and newly written pieces, including list boundaries and changed link forms.

`Preservation` selects the local, regional or whole-document path and retains final reparse validation. It also owns the recent-instance cache and cross-check policy. Collaborators receive only the fields and operations they use; they do not receive the coordinator or an editor. Temporary move and link-rewrite state is cleared after each attempt. The extraction keeps fallback eligibility, cache lifetimes, work budgets and exact output unchanged.

Production consumers import shared algorithms from their owning modules. `preserve.ts` also re-exports selected algorithms and instrumentation for direct tests that compare independent paths and count work. These internal test seams are not package exports; facade tests continue to verify saved bytes and reopening.

## Shared primitives

- `bom.ts` recognises or removes exactly one leading byte-order mark. Callers retain control of parser offsets, incremental-read eligibility and saved output.
- `text-edges.ts` finds non-overlapping matching UTF-16 prefixes and suffixes. Callers keep source mapping and syntax-boundary adjustments; comparisons involving hard-break identity or syntax-node arrays stay with their owning algorithms.
- `portable-image.ts` shares byte encoding and the exact lowercase image MIME allowlist. Clipboard, paste and print retain their own MIME coercion, case, base64 and image-validation rules.
