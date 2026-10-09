# Supported syntax

This matrix applies to 0.0.7–0.0.9. Versions 0.0.8 and 0.0.9 add host controls, development fixtures and native text/layout contracts without expanding syntax support. Source mode can edit all Markdown literally; the statuses below describe formatted mode.

- **Rendered and editable:** InkKit recognises the construct and exposes its content for editing.
- **Preserved literally:** source remains editable and saveable, without that construct's formatted behaviour.
- **Adapter-dependent:** a host image adapter supplies presentation and portable bytes; the source reference stays opaque.
- **Unsupported:** the file format or feature has no package implementation. Planned work is not supported content.

| Content                                                           | Example                                                 | Status from 0.0.7                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| CommonMark headings, paragraphs, emphasis, lists, quotes and code | `# Heading`, `**bold**`, `[link](https://example.com)`  | Rendered and editable.                                                                                       |
| Task lists, strikethrough and autolinks                           | `- [x] Done`, `~~old~~`, `https://example.com`          | Rendered and editable.                                                                                       |
| GFM tables                                                        | `\| Name \| Value \|` with a delimiter row              | Rendered and editable; row/column movement, sorting and rectangular paste follow bounded contracts.          |
| Footnotes                                                         | `A note[^1]` and `[^1]: Definition`                     | Rendered and editable; shared definitions and source labels are retained.                                    |
| Reference links                                                   | `[label][id]` and `[id]: https://example.com`           | Rendered and editable when resolved; unresolved references are preserved literally.                          |
| Supported callouts                                                | `> [!NOTE]- Details` followed by quoted body lines      | Rendered and editable; folding changes presentation only.                                                    |
| Highlights                                                        | `==important==`                                         | Rendered and editable.                                                                                       |
| Author comments                                                   | `<!-- private -->`, `%% private %%`                     | Preserved author content, editable when revealed; excluded from ordinary sharing and print.                  |
| Bounded Mermaid                                                   | A `mermaid` code fence containing `flowchart LR; A-->B` | Editable source with offline preview; invalid or unsupported diagrams retain source and report a diagnostic. |
| Managed images                                                    | `![Alt](opaque-reference)`                              | Adapter-dependent display, import and portable export.                                                       |
| Unmanaged images                                                  | `![Alt](unmanaged-reference)` without an adapter        | Preserved literally; no host storage or image fetch is implied.                                              |
| Raw HTML and frontmatter                                          | `<section>Text</section>`, a YAML frontmatter block     | Preserved literally; HTML is not executed.                                                                   |
| Unsupported or unfinished Markdown                                | `$math$`, `[[wiki link]]`, an unfinished delimiter      | Preserved literally; no maths or wiki-link interpretation.                                                   |
| TXT                                                               | `# This stays text` in a `txt` document                 | Literal editing; no Markdown rendering.                                                                      |
| RTF files, audio/video and richer embedded media                  | An RTF document or media embed                          | Unsupported.                                                                                                 |

See the sections below for limits and [the API](api.md) for host controls. The [Project](https://github.com/users/aicayzer/projects/3) holds planned syntax and media work.

`printableSnapshot()` exports all supported document content as standalone semantic HTML with print styles and portable assets. Footnotes, resolved reference links, tables, full folded callouts and highlights remain readable; author comments and editor controls are excluded even when revealed. Invalid or unsupported Mermaid retains code with an explicit warning. Unavailable assets reject the export. TXT remains literal.

InkKit supports CommonMark, task lists, strikethrough, autolinks, GFM tables, footnotes and full, collapsed and shortcut reference links. Unresolved references and unsupported constructs remain editable literal source. TXT mode treats every character literally.

## Mermaid

Fences labelled `mermaid` retain editable source beside an offline preview. Supported types are `flowchart`/`graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram`/`stateDiagram-v2`, `erDiagram` and `pie`, using Mermaid 12.1.0 and the default theme and system fonts. Other types remain editable source with a reported preview failure. Rendering is limited to 30,000 source characters and 500 edges; portable PNGs are bounded to 4096 pixels on either axis.

Author configuration, HTML, entities, actions, URLs, images, icons, maths and CSS declarations are disabled before rendering. Backslash escapes and resource syntax are also rejected. These restrictions apply even when that text occurs in a label or comment. Rejected or invalid source remains available; editing or saving does not depend on successful rendering. No diagram callbacks or external links are activated.

Copy as Markdown retains the complete source fence for whole documents and complete diagram selections. Ordinary rich export uses an offline PNG for complete diagrams, retaining surrounding content and inert Mermaid source metadata for InkKit paste. Partial source selections remain code text. Other applications can retain the image while discarding Mermaid metadata. If rendering or rasterisation fails, rich output retains readable code and reports the failure. TXT does not render diagrams.

## Callouts

The bounded callout set follows [GitHub alerts](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts) and selected [Obsidian callout syntax](https://obsidian.md/help/callouts).

| Syntax                                                         | Support                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`          | Editable bodies; type spelling is retained. Types are case-insensitive. |
| `> [!note] Custom title`                                       | Plain-text title on the marker line.                                    |
| `> [!note]+ Custom title`                                      | Initially expanded, keyboard-operable fold control.                     |
| `> [!note]- Custom title`                                      | Initially collapsed, keyboard-operable fold control.                    |
| Other types, spaced or repeated fold markers, formatted titles | Editable literal Markdown.                                              |

Put the body on subsequent quoted lines. Fold markers must directly follow the closing bracket. Enter and Space operate the focused fold button. Folding changes presentation without changing source or dirty state. Ordinary export and printing include the complete body and title without fold controls.

## Highlights

`==highlight==` renders as editable highlighted text. Escaped delimiters and code remain literal. Exactly two delimiters are required; adjacent and nested supported formatting is retained. Ordinary copy provides readable text and semantic `<mark>` HTML. Copy as Markdown retains the source delimiters.

## Comments

Complete HTML `<!--comments-->` and Obsidian `%%comments%%` are editable author content, including inline and multiline comments. They start hidden; hosts can reveal them with `setCommentsVisible(true)`. Markdown snapshots and explicit Markdown copy retain comments. Ordinary text, HTML, clipboard metadata and print omit them even when revealed. Code and TXT remain literal; incomplete comment syntax remains literal. HTML is never executed.

Comment delimiters inside footnote identifiers or link destinations are literal identifier or destination text. They are not author comments. Footnote body comments follow the ordinary comment rules.

## Spreadsheet clipboard

Ordinary paste supports tab-separated rows with LF, CRLF or CR endings and simple HTML tables containing inline text and supported formatting. Tab-separated fields can use paired double quotes and doubled quote escapes. Ragged rows are padded with empty cells; trailing empty cells are retained. One terminal row separator is ignored. The first row becomes a new table's header. Existing table headers keep their role when their cells are overwritten. New HTML tables use the header row’s per-column alignment. Logical `start` and `end` alignment resolves from text direction to GFM left or right; body cells follow their column’s header alignment. Tables are bounded to 100 rows and 100 columns, including growth.

Merged or nested HTML tables, block or multiline cell content, images requiring import, unsupported inline elements, malformed quoted fields and oversized input are outside this spreadsheet path. Malformed or unsupported TSV rejects without mutation. Existing editable tables also reject unsupported tabular HTML and reference-provenance metadata; outside a table, unsupported HTML retains its existing preservation path. Explicit Markdown and Paste as Plain Text do not trigger spreadsheet interpretation. Spreadsheet text is literal cell content: Markdown punctuation is escaped on save.

## Editing tools

Complete Markdown source is editable through the facade alongside formatted editing. Unsupported syntax and unfinished delimiters remain source; TXT stays literal. Mode switches retain history and document identity. Literal find, replacement and replace-all support source/TXT text and editable formatted segments, with safe rejection when a formatted replacement cannot reconstruct the source. Ordered heading data and navigation cover actual Markdown headings, including nested supported content; heading-looking code or unsupported literal source is excluded. See [the host API](api.md) for matching, clipboard, undo and stale-navigation contracts.
