# Host API

`InkKitEditor.mount(root, events, { images? })` creates the editor. Import `@aicayzer/inkkit/style.css` into the host bundle. Keep the root alive until `destroy()` completes.

`loadDocument({ documentId, generation, format, text })` loads Markdown (`md`) or literal text (`txt`). Increment the generation when replacing a document. `reloadDocument(input)` retains the caret and scroll position for an external reload.

`snapshot(expectedGeneration?)` returns the complete current text, format, document ID, generation, revision and dirty state. It throws for a missing document, composition, pending image operations, stale generations or a destroyed editor. A snapshot failure is not an unchanged document. Save, close, switching and Copy as Markdown must capture a fresh snapshot before changing native state.

`await printableSnapshot(expectedGeneration?)` returns a `PrintableDocument` for the whole current document, independent of selection, viewport, folding and comment visibility. It contains document ID, generation, revision, format, a complete standalone `html` document with embedded print CSS, the same CSS in `styles`, portable `assets` in HTML image order, and explicit `warnings` for Mermaid source fallbacks. Assets contain owned byte copies. Metadata and result arrays are frozen; asset bytes belong to the caller. The output includes footnotes, resolved reference links, tables, images, Mermaid, full callout bodies and highlights. It excludes author comments, clipboard provenance and editor controls. TXT remains escaped literal text.

Printing captures a fresh snapshot and rechecks document identity, generation and revision after asynchronous work, including edit/undo or reload during export. Composition, pending imports, stale documents and destruction reject the operation. Missing, empty, mismatched or undecodable authored image bytes reject with `image-unavailable`. Invalid or unsupported Mermaid prints readable code with a `diagram-unavailable` warning; failure to rasterise a successfully rendered diagram rejects with `diagram-unavailable`. No failed operation returns partial printable content. Local `blob:` image permission is required during portable asset validation; the returned HTML uses only `data:` images. Client apps own Print/PDF commands, dialogs, file generation and file access.

Print styles wrap long text and tables and fit images within the available width and 90% of the print viewport height while preserving their aspect ratio. Client apps can adapt these styles to their paper and layout requirements.

`clipboardSnapshot(all = true)` returns a frozen whole-document or current-selection export with readable text, semantic HTML, Markdown source and portable image results. Resolve it before touching the native clipboard, check document identity, and retain the existing clipboard on failure. `paste({ text, markdown?, html?, images?, plainText? })` captures one operation; do not reread the global clipboard after awaiting it. Optional `markdown` explicitly supplies source, taking precedence over text and HTML semantics; HTML remains available for portable image bytes. `pasteAsPlainText(text)` inserts literal text.

Mermaid previews leave code source editable. Clipboard output adds `diagrams`, with each complete diagram's source, optional portable PNG and optional error. Successful PNGs also appear in `images` in HTML order, so existing native attachment bridges can export them. Generated diagrams have an empty image reference and do not use the host image adapter. `events.error` reports `diagram-unavailable` for preview or export failures; failed diagrams retain readable source in rich output. Partial code selections produce source rather than a rendered diagram. Hosts enforcing a Content Security Policy must permit local `blob:` image URLs for diagram rasterisation. A blocked decoder reports a diagram export failure and retains source.

`format(command, argument?)`, `table(command, dimensions?)`, `find(text)`, `focus()` and `setKeymap(bindings)` implement host controls. Table commands include insert, row/column addition and deletion, alignment and exit. Default inserted tables have three rows and two columns. `insertText` and `keyDown` accept a generation for buffered native input; composition leaves buffered input unhandled.

`insertPaths(paths, x, y)` places literal paths at a drop location. `insertImages([{ path, alt, title? }], x?, y?)` inserts already-stored references when an image adapter is configured. `destroy()` cancels pending work and releases the editor.

## Footnotes and reference links

`insertFootnote(label?)` inserts a reference after the current selection without removing selected text. An omitted label uses the lowest available positive integer. A new definition is appended and focused for editing; an existing label inserts another reference to its definition. Reference insertion and definition creation form one undo step.

`navigateFootnote('definition' | 'reference')` moves between the current footnote reference and its definition, returning whether a destination was found. **Alt+Enter** visits the definition; **Alt+Shift+Enter** returns to its first reference.

`editReferenceDefinition(label, destination, title?)` updates the shared link definition and returns whether it exists. Omitted title retains the current title. `format('link', destination)` edits that shared definition when the selection is in a reference link.

These operations retain the existing document, generation and composition checks. Footnote and definition editing are disabled in TXT mode. Hosts continue to import only the public facade.

## Highlights, callouts and comments

`format('highlight')` toggles the highlight mark; `CaretState.marks` reports `highlight`. Hosts can bind the `highlight` keymap name through `setKeymap`. Formatting is disabled in TXT mode.

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
