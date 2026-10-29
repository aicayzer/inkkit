import Foundation

extension RichTextDocument {
    /// Makes a document of plain paragraphs from text, for a host's switch from TXT to RTF.
    ///
    /// CRLF, CR and LF each end a line, and each line becomes a paragraph. A final line ending
    /// does not add an empty paragraph, so `"a\n"` and `"a"` give the same document, and empty
    /// text gives a document with no blocks. U+2029, U+0085 and form feed also end a paragraph.
    /// U+2028 and vertical tab become line breaks. U+0000 and U+FFFC, which RTF cannot hold as
    /// text, become U+FFFD so that no character disappears.
    public init(plainText: String) {
        var blocks: [Block] = []
        var builder = InlineBuilder()
        var current = ""
        var pendingCR = false
        var lineOpen = false

        func flushText() {
            builder.append(current, marks: [])
            current = ""
        }
        func endParagraph() {
            flushText()
            blocks.append(.paragraph(Paragraph(builder.content)))
            builder = InlineBuilder()
            lineOpen = false
        }

        for scalar in plainText.unicodeScalars {
            if pendingCR {
                pendingCR = false
                if scalar == "\n" { continue }
            }
            switch scalar {
            case "\r":
                endParagraph()
                pendingCR = true
            case "\n", "\u{0C}", "\u{85}", "\u{2029}":
                endParagraph()
            case "\u{2028}", "\u{0B}":
                flushText()
                builder.appendBreak()
                lineOpen = true
            case "\u{0}", "\u{FFFC}":
                current.unicodeScalars.append("\u{FFFD}")
                lineOpen = true
            default:
                current.unicodeScalars.append(scalar)
                lineOpen = true
            }
        }
        if lineOpen { endParagraph() }
        self.init(blocks: blocks)
    }

    /// The document as plain text, for a host's switch from RTF to TXT.
    ///
    /// Paragraphs and table rows end with `\n` between them (no final newline). A line break is
    /// `\n`. List items start with `• ` or their number and `. `, indented by two spaces for
    /// each level of nesting, and table cells are joined by tabs. Marks and alignment are dropped.
    public var plainText: String {
        var lines: [String] = []
        for block in blocks {
            Self.appendPlainText(of: block, depth: 0, to: &lines)
        }
        return lines.joined(separator: "\n")
    }

    private static func text(of content: [Inline]) -> String {
        content.map { inline in
            switch inline {
            case .text(let text, _): text
            case .lineBreak: "\n"
            }
        }.joined()
    }

    private static func appendPlainText(of block: Block, depth: Int, to lines: inout [String]) {
        switch block {
        case .paragraph(let paragraph):
            lines.append(text(of: paragraph.content))
        case .table(let table):
            for row in table.rows {
                lines.append(row.map { text(of: $0.content) }.joined(separator: "\t"))
            }
        case .list(let list):
            let indent = String(repeating: "  ", count: depth)
            let start = list.start ?? 1
            for (index, item) in list.items.enumerated() {
                let marker = list.ordered ? "\(start + index). " : "• "
                for (blockIndex, itemBlock) in item.blocks.enumerated() {
                    if blockIndex == 0, case .paragraph(let paragraph) = itemBlock {
                        lines.append(indent + marker + text(of: paragraph.content))
                    } else {
                        appendPlainText(of: itemBlock, depth: depth + 1, to: &lines)
                    }
                }
            }
        }
    }
}
