# Preservation and clipboard behavior

Unedited documents retain their original bytes. Edits retain unchanged source blocks, original gaps, supported line endings and definitions. The reconstructed source is reparsed before it is returned. If safe reconstruction is impossible, the editor reports a preservation error; the host must retain the document rather than save an incomplete result.

Unsupported syntax, raw HTML, frontmatter, footnotes and unmanaged image references remain editable literal Markdown within a formatted document. HTML is not executed. An ordinary HTML clipboard round trip retains those literal blocks rather than turning them into fenced code. Author-created spacer paragraphs survive saving and reopening.

Ordinary Copy exports readable text and semantic HTML. Copy as Markdown explicitly exports source. Literal `&#x20;` in code or TXT stays literal; Markdown entities are interpreted by the parser where appropriate. No global entity replacement or edge-space trimming occurs.

Tables retain cell boundaries. Unsupported HTML tables, including merged cells and nested block content, remain literal source. Managed images export portable bytes in HTML and native image slots. Private display URLs are not exported as external image URLs. An unavailable image retains alt text and reports the failure.

Mixed image paste preserves surrounding text and commits one transaction. A result for a stale document is rejected. Native hosts must retain original clipboard content until export succeeds and keep imports bound to the captured document.
