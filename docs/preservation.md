# Preservation and clipboard behavior

Unedited documents retain their original bytes. Edits retain unchanged source blocks, original gaps, supported line endings and definitions. The reconstructed source is reparsed before it is returned. If safe reconstruction is impossible, the editor reports a preservation error; the host must retain the document rather than save an incomplete result.

Mermaid is stored as ordinary fenced code. Previews do not change revisions or source. Body edits retain authored fence characters, lengths, information strings and line endings; a fence grows when the edited body would otherwise close it. Invalid or unsupported diagrams retain their source through snapshots, save/reopen and undo. Complete diagram Markdown selections preserve authored fences; partial source selections retain selected code text.

Unsupported syntax, raw HTML, frontmatter, unresolved references and unmanaged image references remain editable literal Markdown within a formatted document. HTML is not executed. An ordinary HTML clipboard round trip retains those literal blocks rather than turning them into fenced code. Author-created spacer paragraphs survive saving and reopening.

Footnotes and full, collapsed and shortcut reference links retain authored labels and shared, unused definitions. Editing implicit link text expands only that occurrence to a full reference when needed to retain its target. Definition edits update every reference to that label; undo restores the original source.

Selection Markdown includes the definitions required by the copied references, including dependencies in footnote bodies. InkKit HTML carries inert reference metadata for its own paste path. Other applications can discard this metadata while retaining semantic links and readable footnotes. Pasted label collisions rename incoming labels and definitions together without changing existing targets. Private image references are excluded from HTML metadata.

Ordinary Copy exports readable text and semantic HTML. Copy as Markdown explicitly exports source. Literal `&#x20;` in code or TXT stays literal; Markdown entities are interpreted by the parser where appropriate. No global entity replacement or edge-space trimming occurs.

Tables retain cell boundaries. Unsupported HTML tables, including merged cells and nested block content, remain literal source. Managed images export portable bytes in HTML and native image slots. Private display URLs are not exported as external image URLs. An unavailable image retains alt text and reports the failure.

Mixed image paste preserves surrounding text and commits one transaction. A result for a stale document is rejected. Native hosts must retain original clipboard content until export succeeds and keep imports bound to the captured document.

Supported callout markers, titles and fold markers remain in source. Folding and comment visibility are presentation changes, so they do not affect snapshots or undo history. Highlights retain their source delimiters and adjacent formatting. Unsupported callout variants remain editable literal Markdown; see [supported syntax](supported-syntax.md).

Complete HTML and Obsidian comments remain editable author content. Ordinary clipboard text, HTML and its inert metadata exclude comments, including comments inside required footnote definitions and preserved literal blocks. Explicit Markdown copy and snapshots retain them. Print hides comments even when revealed and includes collapsed callout bodies without editor controls. Incomplete delimiters, escaped syntax, code and TXT remain literal.

When comments occur inside an authored reference label, ordinary sharing removes that label's reference provenance while retaining its semantic link target. Comment-free labels retain their authored reference form in InkKit's HTML paste path.

Footnote identifiers and link destinations remain literal values under the Markdown grammar, including delimiter-looking text. This preserves their authored identity; comments in footnote bodies are excluded from ordinary sharing.

Printable output uses the complete frozen document model rather than the rendered editor or its selection. It includes folded content and excludes comments even when revealed. Exporting does not change source, revision, folding or undo history. Portable assets are copied and decoded before completion; unavailable authored assets reject the whole export. Invalid diagrams retain readable code with explicit warnings. An edit, undo or document replacement during export rejects the stale result.

Table movement and sorting retain complete cells and authored spelling of unchanged moved rows/cells where safe. Each operation is isolated from neighbouring edits in undo history. Spreadsheet paste replaces and grows a rectangular region without flattening cells. Unsupported clipboard tables inside an editable table reject with `preservation` before changing any cell; the host retains the captured clipboard for an explicit alternative. Outside a table, unsupported HTML continues through literal preservation.

Source editing keeps complete authored Markdown separate from its formatted interpretation. Unsupported and incomplete source remains saveable. Spelling-only edits are undoable even when the formatted tree is unchanged; returning to the loaded exact source clears dirty state without resetting revision. Switching modes preserves document identity and history.

Replacement preflights formatted source reconstruction before changing the document. Source/TXT replacements remain literal; formatted replacement does not rewrite attribute metadata or cross structural boundaries. A failed replacement leaves the complete original document intact. Heading entries are scoped to the current document, revision and editing mode; navigation changes presentation and selection only.

Read-only and text-input policy changes preserve exact source and shared history. Entering read-only invalidates pending imports and deferred Cut deletion even if editing is later restored. Failed mutation or composition-policy transitions leave the document unchanged. Command availability is observational: reading it or receiving its event does not change revision or dirty state.
