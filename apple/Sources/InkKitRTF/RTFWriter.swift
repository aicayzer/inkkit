import Foundation
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Builds an attributed string like TextEdit's default document and writes it as RTF.
enum RTFWriter {
    typealias Doc = RichTextDocument

    /// The indent of each list level, in points, as TextEdit uses.
    private static let listIndent: CGFloat = 36
    private static let orderedFormat = NSTextList.MarkerFormat("{decimal}.")

    static func rtfData(from document: Doc) throws(RTFConversionError) -> Data {
        let canonical = try document.canonicalized()
        var writer = Builder()
        for block in canonical.blocks {
            try writer.append(block)
        }
        let output = writer.output
        do {
            return try output.data(
                from: NSRange(location: 0, length: output.length),
                documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
        } catch {
            throw .writeFailed
        }
    }

    private struct Builder {
        let output = NSMutableAttributedString()
        var fonts = WriterFonts()

        mutating func append(_ block: Doc.Block) throws(RTFConversionError) {
            switch block {
            case .paragraph(let paragraph):
                append(paragraph.content, style: style(align: paragraph.align))
            case .list(let list):
                append(list, parents: [])
            case .table(let table):
                try append(table)
            }
        }

        private func style(align: Doc.Alignment?) -> NSMutableParagraphStyle {
            let style = NSMutableParagraphStyle()
            style.setParagraphStyle(.default)
            switch align {
            case .center: style.alignment = .center
            case .right: style.alignment = .right
            case .justify: style.alignment = .justified
            case nil: style.alignment = .natural
            }
            return style
        }

        /// Appends one paragraph, ending it with `\n`. Every character in it carries `style`.
        private mutating func append(_ content: [Doc.Inline], style: NSParagraphStyle, prefix: String = "") {
            let plain: [NSAttributedString.Key: Any] = [
                .font: fonts.font(bold: false, italic: false, code: false),
                .paragraphStyle: style,
            ]
            if !prefix.isEmpty {
                output.append(NSAttributedString(string: prefix, attributes: plain))
            }
            for inline in content {
                switch inline {
                case .lineBreak:
                    output.append(NSAttributedString(string: "\u{2028}", attributes: plain))
                case .text(let text, let marks):
                    output.append(NSAttributedString(string: text, attributes: attributes(for: marks, style: style)))
                }
            }
            output.append(NSAttributedString(string: "\n", attributes: plain))
        }

        private mutating func attributes(for marks: [Doc.Mark], style: NSParagraphStyle) -> [NSAttributedString.Key: Any] {
            let set = Set(marks)
            var attributes: [NSAttributedString.Key: Any] = [
                .font: fonts.font(bold: set.contains(.bold), italic: set.contains(.italic), code: set.contains(.code)),
                .paragraphStyle: style,
            ]
            for mark in marks {
                switch mark {
                case .bold, .italic, .code:
                    break
                case .underline:
                    // Canonical form removes underline from link runs, so links get none.
                    attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
                case .strikethrough:
                    attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
                case .superscript:
                    attributes[.inkkitSuperscript] = 1
                case .subscript:
                    attributes[.inkkitSuperscript] = -1
                case .link(let href):
                    // Validation guarantees the address parses.
                    if let url = URL(string: href) { attributes[.link] = url }
                }
            }
            return attributes
        }

        private mutating func append(_ list: Doc.List, parents: [NSTextList]) {
            let start = list.ordered ? (list.start ?? 1) : 1
            let textList = NSTextList(
                markerFormat: list.ordered ? RTFWriter.orderedFormat : .disc, options: [], startingItemNumber: start)
            let chain = parents + [textList]
            let depth = CGFloat(chain.count)
            for (index, item) in list.items.enumerated() {
                for block in item.blocks {
                    switch block {
                    case .paragraph(let paragraph):
                        let style = style(align: paragraph.align)
                        style.textLists = chain
                        style.firstLineHeadIndent = RTFWriter.listIndent * (depth - 1)
                        style.headIndent = RTFWriter.listIndent * depth
                        style.tabStops = [
                            NSTextTab(textAlignment: .left, location: RTFWriter.listIndent * (depth - 1) + RTFWriter.listIndent / 2),
                            NSTextTab(textAlignment: .left, location: RTFWriter.listIndent * depth),
                        ]
                        // The RTF writer turns a leading "\t<marker>\t" into the paragraph's
                        // \listtext. Without it, the writer would take the same text from the
                        // item itself, and an item that starts with it would lose it.
                        let marker = "\t" + textList.marker(forItemNumber: start + index) + "\t"
                        append(paragraph.content, style: style, prefix: marker)
                    case .list(let nested):
                        append(nested, parents: chain)
                    case .table:
                        // Validation refuses a table inside a list item.
                        break
                    }
                }
            }
        }

        private mutating func append(_ table: Doc.Table) throws(RTFConversionError) {
            #if canImport(AppKit)
            let textTable = NSTextTable()
            let columns = table.rows.first?.count ?? 1
            textTable.numberOfColumns = columns
            textTable.layoutAlgorithm = .automatic
            textTable.collapsesBorders = true
            for (rowIndex, row) in table.rows.enumerated() {
                for (columnIndex, cell) in row.enumerated() {
                    let block = NSTextTableBlock(
                        table: textTable, startingRow: rowIndex, rowSpan: 1, startingColumn: columnIndex, columnSpan: 1)
                    block.setBorderColor(.gray)
                    block.setWidth(1, type: .absoluteValueType, for: .border)
                    block.setWidth(4, type: .absoluteValueType, for: .padding)
                    block.setValue(100 / CGFloat(columns), type: .percentageValueType, for: .width)
                    let style = style(align: nil)
                    style.textBlocks = [block]
                    append(cell.content, style: style)
                }
            }
            #else
            throw .unsupportedContent([.table])
            #endif
        }
    }
}
