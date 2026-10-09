# Supported Markdown

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
