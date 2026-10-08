# Host API

`InkKitEditor.mount(root, events, { images? })` creates the editor. Import `@aicayzer/inkkit/style.css` into the host bundle. Keep the root alive until `destroy()` completes.

`loadDocument({ documentId, generation, format, text })` loads Markdown (`md`) or literal text (`txt`). Increment the generation when replacing a document. `reloadDocument(input)` retains the caret and scroll position for an external reload.

`snapshot(expectedGeneration?)` returns the complete current text, format, document ID, generation, revision and dirty state. It throws for a missing document, composition, pending image operations, stale generations or a destroyed editor. A snapshot failure is not an unchanged document. Save, close, switching and Copy as Markdown must capture a fresh snapshot before changing native state.

`clipboardSnapshot(all = true)` returns a frozen whole-document or current-selection export with readable text, semantic HTML, Markdown source and portable image results. Resolve it before touching the native clipboard, check document identity, and retain the existing clipboard on failure. `paste({ text, html?, images?, plainText? })` captures one operation; do not reread the global clipboard after awaiting it. `pasteAsPlainText(text)` inserts literal text.

`format(command, argument?)`, `table(command, dimensions?)`, `find(text)`, `focus()` and `setKeymap(bindings)` implement host controls. Table commands include insert, row/column addition and deletion, alignment and exit. Default inserted tables have three rows and two columns. `insertText` and `keyDown` accept a generation for buffered native input; composition leaves buffered input unhandled.

`insertPaths(paths, x, y)` places literal paths at a drop location. `insertImages([{ path, alt, title? }], x?, y?)` inserts already-stored references when an image adapter is configured. `destroy()` cancels pending work and releases the editor.

## Images

The optional `ImageAdapter` provides:

- `presentation(reference)`: a host-controlled display URL or an unavailable result.
- `importImage({ bytes, mimeType, filename?, source? }, context)`: stores captured bytes and returns a reference. `source` associates bytes with an HTML image URL when available.
- `exportImage(reference, context)`: returns bytes and MIME type for portable clipboard output.

The operation context contains document ID, generation and operation ID. Validate it in native callbacks. Alt text, title and the existing `alt|width` convention remain editor metadata. The adapter owns storage, access control and networking. InkKit contains no Marfa types or storage-path assumptions.

Keep imported bytes available while the captured operation is pending and after insertion, including before the host saves its document. Retention and orphan cleanup belong to the host; a sweep based only on saved Markdown can miss an in-flight import or an unsaved edit. Reject stale callbacks without inserting their references into a replacement document.

The `events.error` callback reports asynchronous failures. Hosts with native clipboards use `events.clipboard` to receive ordinary image selections as portable clipboard output. Return a promise that resolves only after the native clipboard write succeeds; reject it on failure. Image Cut awaits this acknowledgement before removing source content. Encode byte arrays explicitly when crossing a WebKit JSON bridge.
