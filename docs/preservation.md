# Preservation and clipboard behavior

Unedited documents retain their original bytes. Edits retain unchanged source blocks, original gaps, supported line endings and definitions. The reconstructed source is reparsed before it is returned. If safe reconstruction is impossible, the editor reports a preservation error; the host must retain the document rather than save an incomplete result.

Unsupported syntax, raw HTML, frontmatter, unresolved references and unmanaged image references remain editable literal Markdown within a formatted document. HTML is not executed. An ordinary HTML clipboard round trip retains those literal blocks rather than turning them into fenced code. Author-created spacer paragraphs survive saving and reopening.

Footnotes and full, collapsed and shortcut reference links retain authored labels and shared, unused definitions. Editing implicit link text expands only that occurrence to a full reference when needed to retain its target. Definition edits update every reference to that label; undo restores the original source.

Selection Markdown includes the definitions required by the copied references, including dependencies in footnote bodies. InkKit HTML carries inert reference metadata for its own paste path. Other applications can discard this metadata while retaining semantic links and readable footnotes. Pasted label collisions rename incoming labels and definitions together without changing existing targets. Private image references are excluded from HTML metadata.

Ordinary Copy exports readable text and semantic HTML. Copy as Markdown explicitly exports source. Literal `&#x20;` in code or TXT stays literal; Markdown entities are interpreted by the parser where appropriate. No global entity replacement or edge-space trimming occurs.

Tables retain cell boundaries. Unsupported HTML tables, including merged cells and nested block content, remain literal source. Managed images export portable bytes in HTML and native image slots. Private display URLs are not exported as external image URLs. An unavailable image retains alt text and reports the failure.

Mixed image paste preserves surrounding text and commits one transaction. A result for a stale document is rejected. Native hosts must retain original clipboard content until export succeeds and keep imports bound to the captured document.
