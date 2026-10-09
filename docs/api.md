# Host API

This reference includes the **unpublished 0.0.8 candidate**. Version 0.0.7 is published; the host-policy and availability sections below describe candidate additions.

`InkKitEditor.mount(root, events, options?: EditorOptions)` creates the editor. `EditorOptions` accepts optional `images`, `editable`, `textInput`, `labels` and `keymap`. Editing defaults to enabled; omitted text-input preferences retain browser behaviour. Import `@aicayzer/inkkit/style.css` into the host bundle. Keep the root alive until `destroy()` completes.

`loadDocument({ documentId, generation, format, text })` loads Markdown (`md`) or literal text (`txt`). Increment the generation when replacing a document. `reloadDocument(input)` retains the caret, scroll position and Markdown editing mode for an external reload.

`snapshot(expectedGeneration?)` returns the complete current text, format, document ID, generation, revision and dirty state. It throws for a missing document, composition, pending image operations, stale generations or a destroyed editor. A snapshot failure is not an unchanged document. Save, close, switching and Copy as Markdown must capture a fresh snapshot before changing native state.

`await printableSnapshot(expectedGeneration?)` returns a `PrintableDocument` for the whole current document, independent of selection, viewport, folding and comment visibility. It contains document ID, generation, revision, format, a complete standalone `html` document with embedded print CSS, the same CSS in `styles`, portable `assets` in HTML image order, and explicit `warnings` for Mermaid source fallbacks. Assets contain owned byte copies. Metadata and result arrays are frozen; asset bytes belong to the caller. The output includes footnotes, resolved reference links, tables, images, Mermaid, full callout bodies and highlights. It excludes author comments, clipboard provenance and editor controls. TXT remains escaped literal text.

Printing captures a fresh snapshot and rechecks document identity, generation and revision after asynchronous work, including edit/undo or reload during export. Composition, pending imports, stale documents and destruction reject the operation. Missing, empty, mismatched or undecodable authored image bytes reject with `image-unavailable`. Invalid or unsupported Mermaid prints readable code with a `diagram-unavailable` warning; failure to rasterise a successfully rendered diagram rejects with `diagram-unavailable`. No failed operation returns partial printable content. Local `blob:` image permission is required during portable asset validation; the returned HTML uses only `data:` images. Client apps own Print/PDF commands, dialogs, file generation and file access.

Print styles wrap long text and tables and fit images within the available width and 90% of the print viewport height while preserving their aspect ratio. Client apps can adapt these styles to their paper and layout requirements.

`clipboardSnapshot(all = true)` returns a frozen whole-document or current-selection export with readable text, semantic HTML, Markdown source and portable image results. Resolve it before touching the native clipboard, check document identity, and retain the existing clipboard on failure. `paste({ text, markdown?, html?, images?, plainText? })` captures one operation; do not reread the global clipboard after awaiting it. Optional `markdown` explicitly supplies source, taking precedence over text and HTML semantics; HTML remains available for portable image bytes. `pasteAsPlainText(text)` inserts literal text.

Mermaid previews leave code source editable. Clipboard output adds `diagrams`, with each complete diagram's source, optional portable PNG and optional error. Successful PNGs also appear in `images` in HTML order, so existing native attachment bridges can export them. Generated diagrams have an empty image reference and do not use the host image adapter. `events.error` reports `diagram-unavailable` for preview or export failures; failed diagrams retain readable source in rich output. Partial code selections produce source rather than a rendered diagram. Hosts enforcing a Content Security Policy must permit local `blob:` image URLs for diagram rasterisation. A blocked decoder reports a diagram export failure and retains source.

`format(command, argument?)`, `table(command, options?)`, `find(text)`, `focus()` and `setKeymap(bindings)` implement host controls. Table commands include insert, row/column addition and deletion, alignment and exit. Default inserted tables have three rows and two columns. `insertText` and `keyDown` accept a generation for buffered native input; composition leaves buffered input unhandled.

`insertPaths(paths, x, y)` places literal paths at a drop location. `insertImages([{ path, alt, title? }], x?, y?)` inserts already-stored references when an image adapter is configured. `destroy()` cancels pending work and releases the editor.

## Editability and text input

`editable` returns the current editing policy. `setEditable(boolean)` changes it on both formatted and source/TXT surfaces. `setTextInputPreferences(preferences: TextInputPreferences)` replaces the preferences and updates native HTML input attributes on both surfaces. Omitted fields remove explicit attributes rather than retaining earlier overrides. `TextInputPreferences` contains optional `spellcheck: boolean`, `autocorrect: boolean` and `autocapitalize: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters'`. Omitted preferences leave behaviour to the browser; these are input preferences rather than guarantees of OS behaviour.

Read-only permits selection, copying, find, navigation, folding and formatted/source switching. Host document loading and reloading remain explicit host operations. Mutating facade calls reject with `InkKitError` code `read-only`; typing, paste/drop, cut completion, task toggles, table controls, reference editing and resizing cannot change content. Undo/redo are disabled while read-only, retaining history for later re-enabling.

Entering read-only cancels pending imports and invalidates deferred destructive operations, including acknowledged Cut. A late result cannot mutate the editor after editing is re-enabled. Active image resize previews are cancelled. Imported asset retention and cleanup remain the host adapter's responsibility.

Editability and input-preference transitions reject during active composition with code `composition` and no partial change. Successful changes preserve focus, selection, source, document identity, revision, dirty state and shared history. These transitions are presentation changes, not document edits.

## Command availability

`commandState(expectedGeneration?)` returns the current `CommandState` without dispatching edits or changing history. A missing document, stale expected generation or destroyed editor rejects the query. Unlike a save snapshot, availability remains readable during composition and pending imports, with affected commands disabled.

The state contains `documentId`, `generation`, `revision`, `format`, `mode`, `editable`, `composing`, `pending`, `caret: CaretState`, optional `table` context (`row`, `column`, `rows`, `columns`) and `commands`. The command booleans cover `undo`, `redo`, `insertText`, `paste`, `replace`, `replaceSource`, `insertImages`, `insertPaths`, `insertFootnote` and `editReferenceDefinition`; `commands.format` maps each `FormatCommand` to availability, and `commands.table` maps each `TableCommand`. Row and column indices are zero-based.

The optional `events.commandStateChanged(state)` callback publishes current state after selection, editing, history, mode or input-policy changes and after document replacement. Document loading suppresses intermediate state. The existing `events.stateChanged(CaretState)` contract is retained for active formatting.

Source and TXT disable formatted commands. Read-only disables mutations while retaining non-mutating operations. Availability is contextual: recheck generation and handle the operation's result/errors when a user acts. The host owns toolbar/menu presentation; querying availability never dirties the document.

## Footnotes and reference links

`insertFootnote(label?)` inserts a reference after the current selection without removing selected text. An omitted label uses the lowest available positive integer. A new definition is appended and focused for editing; an existing label inserts another reference to its definition. Reference insertion and definition creation form one undo step.

`navigateFootnote('definition' | 'reference')` moves between the current footnote reference and its definition, returning whether a destination was found. **Alt+Enter** visits the definition; **Alt+Shift+Enter** returns to its first reference.

`editReferenceDefinition(label, destination, title?)` updates the shared link definition and returns whether it exists. Omitted title retains the current title. `format('link', destination)` edits that shared definition when the selection is in a reference link.

These operations retain the existing document, generation and composition checks. Footnote and definition editing are disabled in TXT and Markdown source modes. Hosts continue to import only the public facade.

## Highlights, callouts and comments

`format('highlight')` toggles the highlight mark; `CaretState.marks` reports `highlight`. Hosts can bind the `highlight` keymap name through `setKeymap`. Formatting is disabled in TXT and Markdown source modes.

Supported callouts render editable bodies, plain titles and optional fold buttons. Enter and Space toggle the focused fold button. Folding retains authored source and does not dirty the document. See the [syntax matrix](supported-syntax.md) for the bounded types and variants.

`setCommentsVisible(boolean)` reveals or hides author comments. Comments start hidden. This changes presentation without changing revision, history or dirty state. Snapshots and `ClipboardOutput.markdown` retain comments; ordinary text, HTML, inert clipboard metadata and printing exclude them even when revealed. A selection inside a comment copies its selected body with comment delimiters only in explicit Markdown.

## Images

The optional `ImageAdapter` provides:

- `presentation(reference)`: a host-controlled display URL or an unavailable result.
- `importImage({ bytes, mimeType, filename?, source? }, context)`: stores captured bytes and returns a reference. `source` associates bytes with an HTML image URL when available.
- `exportImage(reference, context)`: returns bytes and MIME type for portable clipboard output.

The operation context contains document ID, generation and operation ID. Validate it in native callbacks. Alt text, title and the existing `alt|width` convention remain editor metadata. The adapter owns storage, access control and networking. InkKit contains no Marfa types or storage-path assumptions.

Keep imported bytes available while the captured operation is pending and after insertion, including before the host saves its document. Retention and orphan cleanup belong to the host; a sweep based only on saved Markdown can miss an in-flight import or an unsaved edit. Reject stale callbacks without inserting their references into a replacement document.

The `events.error` callback reports asynchronous failures. Hosts with native clipboards use `events.clipboard` to receive ordinary image and diagram selections as portable clipboard output. Return a promise that resolves only after the native clipboard write succeeds; reject it on failure. Image and diagram Cut await this acknowledgement before removing source content. Encode byte arrays explicitly when crossing a WebKit JSON bridge.

## Table refinements

`table('moveRowUp' | 'moveRowDown' | 'moveColumnLeft' | 'moveColumnRight')` moves the selected contiguous rows or columns one position. A caret chooses its cell's row or column. The header remains the first row and cannot be moved into the body; moving a column includes its header and alignment. Selection follows the moved cells. Boundary movements return `false`. Complete cell nodes, including formatting, references, comments and images, travel together. Unsupported literal tables are not reordered.

`table('sortRows', { column?, order?, comparison? })` explicitly sorts all body rows. `column` is zero-based and defaults to the active column; `order` defaults to `ascending`, with `descending` also supported. `comparison` defaults to `text`: case-sensitive UTF-16 code-unit comparison of complete readable clipboard text, including surrounding whitespace. Author comments are excluded; images contribute alt text and footnote references contribute `[label]`. Number comparison trims surrounding whitespace and accepts finite decimal numbers, including signs, fractions and exponents; it rejects other nonblank values without changing the table. Empty and whitespace-only cells always come last, and equal keys retain their authored order. The header and column alignments remain fixed; selection follows the original top-left row and retains the selected columns within that row.

Ordinary paste accepts rectangular tab-separated spreadsheet text and supported simple HTML tables. Inside a table it begins at the selection's top-left cell, replaces the selected rectangle and clears selected cells not covered by the incoming rectangle. It grows the table to the right and bottom as needed. Outside a table it inserts a new table using the first incoming row as the header. Explicit Markdown, plain-text paste and image imports retain their existing paths. Each movement, sort and spreadsheet paste is one isolated undo operation. See [supported syntax](supported-syntax.md) for input limits and safe fallback.

## Source editing and history

`editingMode` returns `formatted` or `source`. Markdown loads in formatted mode; TXT is always literal source. `setEditingMode(mode, expectedGeneration?)` switches the current Markdown document without changing its identity, generation, revision, dirty state or history. It returns `false` when unchanged or when formatted mode is requested for TXT. Hosts own the mode control.

`replaceSource(text, expectedGeneration?)` replaces the complete current source as one isolated undo operation, returning `false` for identical source. It accepts unsupported syntax, incomplete Markdown and TXT literally. Snapshots retain the actual complete source, including Markdown spelling changes that render identically. Source input retains unchanged line endings and uses the document’s existing line ending for inserted lines. Switching to formatted editing does not save or canonicalise the source.

`undo(expectedGeneration?)` and `redo(expectedGeneration?)` use the same document history in both editing modes and TXT. Each returns whether it applied a history operation. Revisions advance for actual edits and history operations; dirty state compares exact current source with the loaded source. Loading another document resets history. Composition, pending imports, stale generations and destruction retain the existing guards.

Source-mode typing and paste edit source literally; an explicitly supplied clipboard `markdown` takes precedence over plain text. Ordinary whole-document copy and printing retain the existing semantic Markdown exports. A source selection exports its exact selected substring as `ClipboardOutput.markdown`, without unselected definitions. Ordinary text/HTML interprets that selection as a standalone Markdown fragment: complete constructs are semantic, while incomplete and unsupported constructs remain literal. Intersections with complete author comments in the whole document are excluded even when only a comment body is selected. Code and TXT stay literal.

## Find and replacement

`find(text, expectedGeneration?)` selects the next match and wraps at the end. `replace(search, replacement, expectedGeneration?)` replaces the matching selection, or the next wrapped match, and selects the inserted text. It returns whether text changed. `replaceAll(search, replacement, expectedGeneration?)` applies non-overlapping matches from the original document once and returns the number changed. Empty search and identical replacements do not create history entries.

Search is literal and case-insensitive using JavaScript Unicode matching. No regular expressions, Unicode normalisation or replacement macros are interpreted; `$&`, `$1` and backslashes remain replacement text. Source and TXT search their full literal text, including line endings and syntax. Formatted matching searches editable text, code and preserved literal content within a single text segment, including author-comment bodies. It does not cross non-text nodes or structural boundaries, or search link destinations, reference identifiers and other attributes. Use source editing to search that source syntax.

Formatted replacements retain surrounding structure and formatting; replacement text inherits the first matched text’s formatting when a match spans differently formatted text. Newlines become hard breaks in ordinary formatted content and remain literal in code/source/TXT. Unsupported reconstruction, including multiline table cells, rejects with `preservation` before mutation. Each replacement or replace-all is one isolated undo operation. Selection-only find and navigation do not change revision or dirty state. Replacement obeys the same composition, pending-operation and generation guards as other edits.

## Headings and navigation

`headings(expectedGeneration?)` returns immutable, ordered `Heading` entries with `id`, `level`, readable `text`, `documentId`, `generation` and `revision`. The opaque ID belongs to the current loaded document and editing mode. Heading-looking code, unsupported literal blocks and TXT do not create outline entries. Author comments are excluded from heading text; image alt text and readable footnote labels are retained. Query again after edits, undo, document loads or mode changes.

`navigateHeading(entry)` validates the entry against the current document, generation, revision, editing mode and load epoch. A stale entry throws `stale-document`. Navigation focuses and scrolls to the heading and reveals folded callout ancestors without changing source, history, revision or dirty state. Hosts own outline layout and presentation; the playground demonstrates selection and navigation through these APIs.

## Appearance, labels and shortcuts

The mounted root receives `.inkkit-root`. Package rules, including table styles, are scoped beneath it; they do not set the host's `:root` font size or colour scheme. Set these public CSS custom properties on the root or an ancestor. Properties beginning `--_inkkit-` are internal.

| Tokens                                                                                                                                        | Default or purpose                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `--inkkit-font-family`, `--inkkit-font-size`, `--inkkit-line-height`                                                                          | System sans-serif, `15px`; line height defaults to `normal` in formatted mode and `1.5` in source/TXT. |
| `--inkkit-monospace-font`                                                                                                                     | System monospace stack for source, TXT and code.                                                       |
| `--inkkit-color-scheme`                                                                                                                       | `light dark`.                                                                                          |
| `--inkkit-min-height`, `--inkkit-reading-width`                                                                                               | `100%`, `100%`.                                                                                        |
| `--inkkit-padding-top`, `--inkkit-padding-inline`, `--inkkit-padding-bottom`                                                                  | `10px`, `16px`, `48px`.                                                                                |
| `--inkkit-paragraph-spacing`                                                                                                                  | About two-thirds of the editor font size.                                                              |
| `--inkkit-accent-color`, `--inkkit-text-color`                                                                                                | `#0a84ff`, `CanvasText`.                                                                               |
| `--inkkit-muted-color`, `--inkkit-rule-color`, `--inkkit-code-background`                                                                     | System text mixed with transparency for secondary text, borders and code background.                   |
| `--inkkit-code-comment`, `--inkkit-code-keyword`, `--inkkit-code-string`, `--inkkit-code-number`, `--inkkit-code-title`, `--inkkit-code-attr` | Syntax highlighting colours.                                                                           |
| `--inkkit-focus-width`, `--inkkit-focus-color`, `--inkkit-focus-offset`                                                                       | `2px`, editor accent, `-2px`; footnote links default to current text colour and `2px` offset.          |

Inherited legacy `--accent`, `--text`, `--muted`, `--rule`, `--code-bg`, `--mono` and `--reading-width` remain fallbacks when their new tokens are absent. Each editor root can have independent styling.

```css
.document-editor {
  --inkkit-font-size: 17px;
  --inkkit-reading-width: 48rem;
  --inkkit-padding-inline: 24px;
  --inkkit-accent-color: #286343;
}
```

`EditorOptions.labels` is `Partial<EditorLabels>`. Omitted labels keep their defaults; overrides are inserted safely as text. The label keys are:

| Area                         | Label keys                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editing surfaces             | `formattedEditor`, `plainTextEditor`, `sourceEditor`, `placeholder`.                                                                                                |
| Code and callouts            | `copyCode`, `expandCallout`, `collapseCallout`.                                                                                                                     |
| Diagram status and footnotes | `diagramRendering`, `diagramUnavailable`, `footnote`; the latter two prefix a diagnostic or authored label.                                                         |
| Table operations             | `tableAddRow`, `tableAddColumn`, `tableDeleteRow`, `tableDeleteColumn`, `tableAlignLeft`, `tableAlignCenter`, `tableAlignRight`, `tableMoveColumn`, `tableMoveRow`. |

The host owns its localisation catalogue, toolbar and menu labels. Labels are fixed at mount time.

`EditorOptions.keymap` and `setKeymap(bindings: Keymap)` configure bindings in ProseMirror key notation. Formatting names are `heading1` through `heading6`, `paragraph`, `bold`, `italic`, `strikethrough`, `highlight`, `code`, `codeBlock`, `quote`, `bulletList`, `orderedList` and `taskList`. Formatting has no default host bindings.

History names are `undo` and `redo`. Table names are `tableInsert`, `tableAddRowBefore`, `tableAddRowAfter`, `tableAddColumnBefore`, `tableAddColumnAfter`, `tableDeleteRow`, `tableDeleteColumn`, `tableDeleteTable`, `tableAlignLeft`, `tableAlignCenter`, `tableAlignRight`, `tableMoveRowUp`, `tableMoveRowDown`, `tableMoveColumnLeft`, `tableMoveColumnRight`, `tableSortRows` and `tableExit`.

Omitted history bindings keep `Mod-z` for undo and `Mod-y` / `Shift-Mod-z` for redo; an explicit empty array disables configurable defaults for that name. The same history bindings apply across formatted/source/TXT surfaces. Formatted and table commands are disabled outside their applicable context and while read-only. Keyboard dispatch follows the same mutation guards as facade calls. Hosts can query command availability to present current shortcut/menu state.
