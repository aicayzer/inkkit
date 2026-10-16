# Supported syntax

This matrix describes the current package. Source mode can edit all Markdown literally; the statuses below describe formatted mode.

- **Rendered and editable:** InkKit recognises the construct and exposes its content for editing.
- **Preserved literally:** source remains editable and saveable, without that construct's formatted behaviour.
- **Adapter-dependent:** a host image adapter supplies presentation and portable bytes; the source reference stays opaque.
- **Unsupported:** the file format or feature has no package implementation. Planned work is not supported content.

| Content                                                           | Example                                                 | Status                                                                                                       |
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
| Unsupported or unfinished Markdown                                | `$math$`, an unfinished delimiter                       | Preserved literally; no interpretation beyond enabled syntax.                                                |
| TXT                                                               | `# This stays text` in a `txt` document                 | Literal editing; no Markdown rendering.                                                                      |
| RTF documents and note transclusion                               | An RTF document or document embed                       | Unsupported.                                                                                                 |

See the sections below for limits and [the API](api.md) for host controls. The [Project](https://github.com/users/aicayzer/projects/3) holds planned syntax and media work.

`printableSnapshot()` exports all supported document content as standalone semantic HTML with print styles and portable assets. Footnotes, resolved reference links, tables, full folded callouts and highlights remain readable; author comments and editor controls are excluded even when revealed. Invalid or unsupported Mermaid retains code with an explicit warning. Unavailable image assets reject the export; linked media use the defined descriptive fallbacks. TXT remains literal.

InkKit supports CommonMark, task lists, strikethrough, autolinks, GFM tables, footnotes and full, collapsed and shortcut reference links. Unresolved references and unsupported constructs remain editable literal source. TXT mode treats every character literally.

Typing a table row and pressing Enter or Tab at the end of the line starts a table without the menu. The paragraph must hold only that line, start and end with `|`, and hold at least two cells, such as `| Name | Date |`. The typed cells, trimmed of surrounding spaces, become the header row, one empty row follows, and the caret moves to its first cell. The saved Markdown is the table `table('insert')` writes. A `\|` or a pipe in inline code belongs to its cell, and cells can hold formatted text. Undo right after the conversion restores the typed line with the caret at its end. The shortcut works in lists, quotes, callouts and footnotes. Anywhere else, including code, front matter, a table, a task item, a paragraph with other lines or more than 100 cells, Enter and Tab do what they did before.

A bare URL, `www.` address or email address links to its own text. Editing that text keeps the link following it: while the text is still an address, it's saved bare, and where an edit ends the address, the rest is saved as plain text. Typing an address into plain text links it the same way, including after a bracket or parenthesis as in `[a](http://x.com`, which is saved with its brackets escaped, and a pasted link whose text is its address is saved bare. Opening a note, or editing elsewhere in it, doesn't change how its addresses are written. Typing the closing `>` of an angle autolink, such as `<https://example.com>` or `<ada@example.com>`, turns it into a link and saves it with its angle brackets. An address in angle brackets keeps its brackets while its interior is edited. Text typed at either boundary stays outside the link. Code typed around an angle autolink retains the angle brackets as literal code; closing bold formatting leaves subsequent text outside the bold span. CommonMark URI autolinks include `<xs:element>`. Text such as `<div>` and `<a b>` stays literal. A `www.` address without a scheme is not an angle autolink. A link written with brackets, such as `[docs](docs)`, keeps its form and destination when its text is edited, even when the text matches the destination. A bare URL next to a space at the edge of a block is saved as `<https://example.com>`, because the space is written as `&#x20;`, which a bare URL would take in.

Punctuation between the address and that space doesn't stop it: the URL is saved as `<https://example.com>.&#x20;`, and a `www.` address as `[www.example.com](http://www.example.com).&#x20;`. Once text follows the space, the address is saved bare again. An address in inline code isn't linked.

Shift+Enter inserts a hard line break within a paragraph. In paragraphs and setext headings, a trailing break remains pending in the editor until content follows and is omitted from saved Markdown in the meantime. Tables and ATX headings save line breaks as `<br />`. A break directly before an inline HTML comment also uses `<br />`. Shift+Enter inside a literal Markdown block does nothing. See [preservation](preservation.md) for saving and Undo behavior.

## Mermaid

Fences labelled `mermaid` retain editable source beside an offline preview. Supported types are `flowchart`/`graph`, `sequenceDiagram`, `classDiagram`, `stateDiagram`/`stateDiagram-v2`, `erDiagram` and `pie`, using Mermaid 12.1.0 and the default theme and system fonts. Other types remain editable source with a reported preview failure. Rendering is limited to 30,000 source characters and 500 edges; portable PNGs are bounded to 4096 pixels on either axis.

Before rendering, InkKit refuses author configuration (`%%{` directives and front matter), HTML, HTML entities, URL schemes, `//`, `@{` shape data, `$$` maths, backslash escapes and the CSS resource syntax `url(`, `image-set(`, `cross-fade(` and `@import`. These restrictions apply anywhere in the source, including labels and comments.

Annotations are the one exception to the HTML restriction, in the positions where Mermaid reads them:

- Class diagrams accept an annotation name of ASCII letters, digits, underscores, spaces and hyphens, such as `<<interface>>`, `<<abstract>>`, `<<service>>` or `<<enumeration>>`. It can stand on its own line in a class body, start a line before a class name (`<<interface>> Shape`) or follow a class name (`class Shape <<interface>>`).
- State diagrams accept `<<fork>>`, `<<join>>` and `<<choice>>` at the end of a `state Name` line.

Anywhere else, including labels, notes, messages and other diagram types, `<<name>>` is refused like other HTML when the name starts with an ASCII letter. In class diagrams, `<<` followed by a comment is also refused. Other `<<` text, such as `shift << 2` in a label, is accepted. After parsing, InkKit refuses the diagram if Mermaid did not read each accepted annotation as an annotation, for example one on a line inside a multi-line note.

InkKit then parses the source with Mermaid and refuses a diagram whose parse result holds a style statement, a class definition, a link style, a link, a click handler or callback, a tooltip, an icon or an image, or a sequence actor's links or properties. This applies wherever Mermaid's grammar accepts the statement, not only at the start of a line. Words such as `click`, `link`, `image`, `style` and `classDef` are ordinary text in labels, edge labels, messages, notes and attributes. Applying a class name without a definition, for example `A:::warn`, is allowed because it carries no styles.

The rendered SVG is sanitised before display: scripts, `foreignObject`, images, links and event handlers are removed, as are attributes and style elements that contain resource syntax. Rejected or invalid source remains available; editing or saving does not depend on successful rendering. No diagram callbacks or external links are activated.

A host built from the core entry, without Mermaid, shows no previews. Diagram fences stay editable source, and copy and print keep the source as readable code with the diagram-unavailable fallback. See [Builds without diagrams](api.md#builds-without-diagrams).

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

Put the body on subsequent quoted lines. Fold markers must directly follow the closing bracket. In the body, Enter starts a new paragraph. Enter in an empty paragraph leaves the callout only when that paragraph is the last one; anywhere else, it adds another paragraph, so a callout is never split in two. An empty paragraph is saved as a quoted `<br />` line. Backspace at the start of the body's first block moves that block out of the callout, which keeps its title. When the callout has only that block, Backspace does nothing while the block holds text, and removes the callout when the block is empty. Enter and Space operate the focused fold button. Folding changes presentation without changing source or dirty state. Ordinary export and printing include the complete body and title without fold controls.

## Highlights

`==highlight==` renders as editable highlighted text. Escaped delimiters and code remain literal. Exactly two delimiters are required; adjacent and nested supported formatting is retained. Ordinary copy provides readable text and semantic `<mark>` HTML. Copy as Markdown retains the source delimiters.

## Comments

Complete HTML `<!--comments-->` and Obsidian `%%comments%%` are editable author content, including inline and multiline comments. They start hidden; hosts can reveal them with `setCommentsVisible(true)`. Markdown snapshots and explicit Markdown copy retain comments. Ordinary text, HTML, clipboard metadata and print omit them even when revealed. Code and TXT remain literal; incomplete comment syntax remains literal. HTML is never executed.

A comment inside emphasis, strong, strikethrough, highlight or a link stays inside it: the text on both sides keeps that formatting, on screen and when saved.

While comments are hidden, editing beside them keeps them:

- Backspace and Delete, including word and line deletion and any other modifier key held with them, remove the visible text next to a hidden comment and keep the comment.
- At the edge of a paragraph, Backspace and Delete join the visible blocks on either side of a hidden block comment and put the comment after the joined block. If no visible block is on that side, or the join would put text inside a hidden comment, nothing changes.
- Arrow keys and other caret movement never place the caret inside a hidden comment, and hiding comments moves a caret that is inside one to the visible text beside it. The exception is a note with no visible text, such as one that holds only a comment: the caret stays in the comment. There, Backspace, Delete and Enter do nothing, and typed, composed, pasted or inserted text goes into a new paragraph after the comment.
- Any other edit from a caret that would remove a hidden comment, such as one the browser makes itself, is refused with a `preservation` error and changes nothing. A composition that the browser ends by removing a comment keeps the comment.
- Deleting, cutting or typing over a selection removes the hidden comments inside the selection along with the text around them, and Undo restores them. A hidden comment at either end of the selection is beside the selected text and is kept. A selection that crosses the break between two paragraphs also removes any hidden block comment between them, even when it holds no other text. To remove a comment on its own, reveal comments first.

Markdown reads a line that starts with an HTML comment as an HTML block, so an edit that would leave an HTML comment at the start of a paragraph, or leave a paragraph that holds only a comment, is refused with a `preservation` error.

The formatted editor refuses an edit that would end a comment early with a `preservation` error, which the facade call that made the edit throws, or the `error` event reports for an edit the person makes. An HTML renderer ends an HTML comment at `-->` or `--!>`, and reads a comment that starts with `>` or `->` as empty, so comment text can't contain those markers or start with them. A `%%` comment ends at the next `%%`, so its text can't contain `%%`, and an inline `%%` comment can't end with `%`. Other dashes, arrows and percent signs are accepted. A comment that already contains such text loads unchanged, and edits outside it are accepted. Undo, redo, `replaceSource` and source mode restore or supply text as written and aren't checked.

Comment delimiters inside footnote identifiers or link destinations are literal identifier or destination text. They are not author comments. Footnote body comments follow the ordinary comment rules.

## Web page clipboard

Pasting HTML from a web page, notes app or word processor imports readable content instead of raw HTML blocks.

Dropping HTML from outside the editor imports it the same way, so a drop and a paste of the same HTML into an empty note save the same Markdown. The dropped content is inserted as whole blocks and never changes the blocks already there: it replaces an empty paragraph at or beside the drop point, and otherwise goes after the top-level block under the pointer, such as a paragraph, code block, table, list, rule or image. Empty headings and code blocks are kept. Text typed into that empty paragraph while dropped images import is kept, and the drop then follows it. The caret moves after the dropped content. `insertImages` with a drop point places images the same way. Images in dropped HTML, and image files dropped with it, go through the host's image adapter. Moving content within the editor, and dropping plain text without HTML, keep ProseMirror's own behavior.

- `style`, `meta`, `link`, `title` and `input` elements and `<!--StartFragment-->` markers produce no content, except that an `input` in a table cell keeps the table as source. Other form controls, such as `button`, `select` and `textarea`, remain literal source.
- `u`, `sub`, `small`, `time`, `abbr`, `cite`, `dfn`, `var`, `ins`, `bdi`, `bdo` and `label` keep their text and nested formatting in the same paragraph. The dialect has no underline, subscript or similar marks, so only the wrapper is lost.
- `figure` and `figcaption` produce their image and caption text. `picture` produces its `img`; its `source` elements are dropped.
- `dl` produces one paragraph per entry. Each `dt` term is bold and each `dd` definition is a plain paragraph, because Markdown has no definition lists.
- A checkbox that leads a list item, directly or inside a paragraph or label, makes a task item with the same checked state.
- Source whitespace collapses as in a browser: runs become one space, and indentation and line breaks at the edges of blocks add nothing. `pre`, `code`, literal elements and any element whose inline `style` sets `white-space` to `pre`, `pre-wrap` or `break-spaces` keep theirs, as does one that sets `white-space-collapse` to `preserve` or `preserve-spaces`. This keeps the indentation of code copied from an editor. Style sheets are not read.
- WebKit, in Safari and in `WKWebView` apps, writes a space beside an inline element as a non-breaking space inside `<span class="Apple-converted-space">`. The text of such a span imports as ordinary spaces, and then follows the whitespace rules above. A non-breaking space anywhere else was authored and is kept.
- Links keep their address only when it is relative, a fragment or a query, or its scheme is `http`, `https`, `mailto` or `tel`, in any letter case. Other addresses, such as `javascript:`, `data:`, `file:` and app-specific schemes, keep the link text and formatting without the link. So does an address with a control character, other than spaces, tabs and line breaks at its ends. An address is read the way a browser reads it, after HTML entities are decoded. The address of a reference definition in HTML follows the same rule. Images in pasted HTML are not saved by address: the host's image adapter stores the pixels and returns the reference, and an image source that uses a script scheme is never kept. Markdown source, whether typed or pasted as Markdown, keeps the addresses as authored. Elements that remain literal source, described below, keep their content as written.
- Tables beside other content import with these elements in their cells. A table with an `input` in a cell, such as a checkbox, stays literal source, because the control and its state cannot be kept in a cell. A table copied on its own follows the spreadsheet paste rules below, which do not accept these elements.

Custom elements, `iframe`, `script`, `svg`, `math`, `object` and other unrecognised elements remain literal source, with their content unchanged apart from HTML comments, including any table inside them, when that source reads back as written. HTML comments are left out everywhere in pasted or dropped HTML, including inside literal source, because a page does not show them. Plain text, Paste as Plain Text and explicit Markdown are not interpreted as HTML.

Plain text and explicit Markdown are read as Markdown. A paragraph at the start or end of the pasted text joins the text at the caret, so a pasted phrase stays in the sentence it's pasted into. Spaces written before or after the text of that paragraph, on the same line, are kept where the line continues on that side of the caret. They're dropped at the start or end of a line, and spaces on a pasted line with no text are dropped too. Any other block, such as a heading, list or code block, is inserted as its own block.

After a paste, the caret is after the pasted content, including when the paste replaced a selection, so typing continues after it instead of replacing it. When the pasted or dropped content ends with a block that shows no text, such as a rule, an image or a comment, the caret goes to the start of the text that follows. The caret never goes into a comment, shown or hidden, or into a callout that opens folded. A web address pasted over selected text links that text and puts the caret after the link. Cells pasted into a table stay selected.

HTML import keeps only structure that reads back the same. Before pasted or dropped HTML is inserted, InkKit writes it as Markdown and reads that Markdown back. A part that would read back as different structure, or whose Markdown would hold a link address that HTML import refuses when read as GitHub Flavored Markdown, as strict CommonMark, or as CommonMark with raw HTML turned off, is imported in a simpler form that reads back the same:

- Literal source, including source copied from InkKit, stays literal when it reads back as one block that ends where it was written and holds no refused address. Otherwise it imports as a code block with the same text.
- A `%%` comment whose text other Markdown apps would read as formatting or links imports as an HTML comment, unless an app with raw HTML turned off would then read a refused address in it. A comment whose text would end it early, as described under comments, imports as plain text.
- A callout title taken from the callout's visible text is saved with its punctuation escaped, so it reads back as the same plain title.
- A reference or footnote label and a reference definition title are saved on one line, with each line break replaced by a space, and a bracket in a label is escaped. A code fence with an unclosed or invalid fence marker imports as an ordinary fence.
- Text that Markdown reads as a link, such as a bare web address, imports as that link.
- Any other part that would read back differently first loses InkKit's metadata, such as a reference label or callout, then its formatting, keeping its text.

Code blocks and literal source are inserted as their own blocks, not joined to the paragraph at the insertion point.

Pasted or dropped HTML adds nothing to a note that it does not show:

- HTML comments, `template`, `noscript` and `noembed` contents, and elements hidden with the `hidden` attribute or an inline `display: none` style are left out.
- An element that InkKit writes for an author comment imports as the text it shows, not as a comment, which would start hidden.
- HTML copied from InkKit also carries the Markdown it was copied from, which keeps reference links, their definitions and footnotes. InkKit pastes that Markdown only when, after the checks above, InkKit's clipboard HTML for it reads as the HTML it came with: the same text, formatting, addresses, images and structure. Markdown that holds comments, comment syntax in a reference or footnote label, or a code fence whose info string says more than the block's language, is not used.
- From that Markdown, InkKit keeps a reference definition only when a pasted link uses it with the same address and title, and keeps only the first definition of each label. A wiki link stays a link only when it shows its own target; one written with other text pastes as that text. A file embed pastes as the image the HTML shows.
- A reference definition, footnote reference or wiki link element keeps its InkKit metadata only when its text is what that metadata shows. A footnote definition keeps its label only when it starts with that label, `[label] `, as InkKit's clipboard HTML writes it. A callout keeps its authored title only when that title shows as its visible title. A code block's language is the first word of its `data-language`, and the block keeps the fence marker that InkKit records with that language as its info string. A diagram figure pastes its Mermaid source only when it holds just the diagram image, whose text alternative is that source. Otherwise each imports as what it shows.
- A pasted or dropped callout starts expanded, so a folded body is not hidden: `-` is imported as `+`.
- When HTML imports as nothing, the plain text that came with it is pasted instead.

Ordinary copy leaves out reference definitions, because the links copied with them show their addresses. Definitions copied on their own are copied as their text, `[label]: address "title"`, and paste back as definitions.

Raw HTML kept in a note, whether pasted or typed, is saved as written and is not checked for unsafe addresses or scripts. An app that renders notes must sanitize raw HTML itself.

## Spreadsheet clipboard

Ordinary paste supports tab-separated rows with LF, CRLF or CR endings and simple HTML tables containing inline text and supported formatting. Tab-separated fields can use paired double quotes and doubled quote escapes. Ragged rows are padded with empty cells; trailing empty cells are retained. One terminal row separator is ignored. The first row becomes a new table's header. Existing table headers keep their role when their cells are overwritten. New HTML tables use the header row’s per-column alignment. Logical `start` and `end` alignment resolves from text direction to GFM left or right; body cells follow their column’s header alignment. Tables are bounded to 100 rows and 100 columns, including growth.

Merged or nested HTML tables, block or multiline cell content, images requiring import, unsupported inline elements, malformed quoted fields and oversized input are outside this spreadsheet path. Malformed or unsupported TSV rejects without mutation. Existing editable tables also reject unsupported tabular HTML and reference-provenance metadata; outside a table, unsupported HTML retains its existing preservation path. Explicit Markdown and Paste as Plain Text do not trigger spreadsheet interpretation. Spreadsheet text is literal cell content: Markdown punctuation is escaped on save.

## Editing tools

Complete Markdown source is editable through the facade alongside formatted editing. Unsupported syntax and unfinished delimiters remain source; TXT stays literal. Mode switches retain history and document identity. Literal find, replacement and replace-all support source/TXT text and editable formatted segments, with safe rejection when a formatted replacement cannot reconstruct the source. Ordered heading data and navigation cover actual Markdown headings, including nested supported content; heading-looking code or unsupported literal source is excluded. See [the host API](api.md) for matching, clipboard, undo and stale-navigation contracts.

## Linked syntax

These features are optional. Enable `wikiLinks` for wiki links and `files` for host-resolved named/path embeds. Disabled features and unsupported forms remain editable source.

- `[[target]]` and `[[target#fragment]]` resolve a target and optional fragment through the host. Unicode and internal spaces are retained.
- `[[target|alias]]` and `[[target#fragment|alias]]` use a plain-text readable alias.
- `[[#Heading]]` passes a local fragment to the host with an empty target.
- `![[name]]`, `![[name#fragment|400]]` and `![[name|400x300]]` resolve a file through the host. Width and optional height are positive integers from 1 to 99999. Only width affects presentation. InkKit does not guess extensions or transclude documents.
- `![alt|400](opaque-path#fragment)` retains the existing path image syntax. A file adapter may resolve another supported kind.

Forms occupy one line, with one optional unescaped fragment separator and one alias/width separator. Backslash escapes support brackets, pipe, hash and backslash. GFM table cells require an extra pipe-escape layer: `[[target\|alias]]` and `![[name\|400]]`. Copying a table cell into ordinary Markdown adjusts that table layer while preserving its meaning. Nested brackets, newlines, empty aliases/fragments, block references such as `#^block`, non-numeric embed aliases and note transclusion are unsupported. Edit targets, aliases and references in source mode; adjacent formatted edits, save/reopen and undo retain untouched authored spelling, including leading-zero widths. Named-embed targets and fragments are trimmed for host resolution; wiki-link references and opaque Markdown image paths keep their existing semantics, and surrounding source whitespace is retained. Dimension values may have surrounding spaces or tabs. Resizing replaces the complete size suffix with the new width; untouched dimensions, whitespace and leading zeros retain their authored spelling.

| Kind                  | Ordinary text                                       | Ordinary HTML                                                          | Copy as Markdown              | Printable output                                          |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| Wiki link             | Authored alias or target/fragment                   | Escaped readable label, without a private link                         | Authored wiki syntax          | Readable label                                            |
| Image                 | Useful alt/name; unavailable description on failure | Portable image bytes with authored width; descriptive failure fallback | Authored path or named syntax | Validated portable image and width; asset failure rejects |
| Audio                 | `[Audio: name]`                                     | Escaped descriptive text                                               | Authored embed and fragment   | Same descriptive fallback; `attachment-fallback` warning  |
| Video                 | `[Video: name]`                                     | Escaped descriptive text                                               | Authored embed and fragment   | Same descriptive fallback; `attachment-fallback` warning  |
| PDF                   | `[PDF: name]`                                       | Escaped descriptive text                                               | Authored embed and fragment   | Same descriptive fallback; `attachment-fallback` warning  |
| File/unsupported kind | `[File: name]`                                      | Escaped descriptive text                                               | Authored embed                | Same descriptive fallback; `attachment-fallback` warning  |
| Missing/error         | Named unavailable/error description                 | Escaped descriptive text                                               | Authored embed                | Description and `attachment-unavailable` warning          |

Descriptive fallbacks retain surrounding content without exporting private URLs, loading file content or embedding active media. HTML paste retains their readable text; explicit Markdown paste retains linked syntax when enabled. Unmanaged source remains literal. TXT retains literal text. Markdown source selections retain their source-form selection rules; whole-document portable export uses the supported representation table.
