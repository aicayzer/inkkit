import Foundation
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Converts an attributed string read from RTF into a ``RichTextDocument``.
enum RTFReader {
    typealias Doc = RichTextDocument

    /// One paragraph of the attributed string, with the structure its paragraph style gives it.
    private struct Record {
        var paragraph: Doc.Paragraph
        var lists: [NSTextList]
        var cell: CellPosition?
    }

    private struct CellPosition {
        var table: AnyObject
        var row: Int
        var column: Int
        var columns: Int
    }

    static func document(from data: Data) throws(RTFConversionError) -> Doc {
        let findings = try RTFSource.scan(data)
        var unsupported = findings.unsupported
        let attributed: NSAttributedString
        do {
            attributed = try NSAttributedString(
                data: findings.start == 0 ? data : data.dropFirst(findings.start),
                options: [.documentType: NSAttributedString.DocumentType.rtf],
                documentAttributes: nil)
        } catch {
            throw .unreadable
        }
        let records = paragraphs(of: attributed, unsupported: &unsupported)
        guard unsupported.isEmpty else { throw .unsupported(unsupported) }
        let document = Doc(blocks: blocks(from: records))
        // The reader builds canonical content, so this only guards against a reader bug
        // producing a document the editor would refuse.
        return try document.canonicalized()
    }

    // MARK: Paragraphs

    private static func isParagraphSeparator(_ unit: UInt16) -> Bool {
        unit == 0x0A || unit == 0x0D || unit == 0x0C || unit == 0x85 || unit == 0x2029
    }

    private static func paragraphs(
        of attributed: NSAttributedString,
        unsupported: inout Set<RTFConversionError.UnsupportedContent>
    ) -> [Record] {
        let string = attributed.string as NSString
        let length = string.length
        var units = [UInt16](repeating: 0, count: length)
        string.getCharacters(&units, range: NSRange(location: 0, length: length))

        if units.contains(0xFFFC) { unsupported.insert(.attachment) }
        attributed.enumerateAttribute(
            .attachment, in: NSRange(location: 0, length: length), options: .longestEffectiveRangeNotRequired
        ) { value, _, stop in
            if value != nil {
                unsupported.insert(.attachment)
                stop.pointee = true
            }
        }

        var records: [Record] = []
        var start = 0
        while start < length {
            var contentEnd = start
            while contentEnd < length, !isParagraphSeparator(units[contentEnd]) { contentEnd += 1 }
            var next = contentEnd
            if next < length {
                next += (units[next] == 0x0D && next + 1 < length && units[next + 1] == 0x0A) ? 2 : 1
            }
            let style = attributed.attribute(.paragraphStyle, at: start, effectiveRange: nil) as? NSParagraphStyle
            var record = Record(
                paragraph: Doc.Paragraph(
                    inlines(of: attributed, in: NSRange(location: start, length: contentEnd - start), units: units),
                    align: alignment(style?.alignment)),
                lists: style?.textLists ?? [],
                cell: nil)
            #if canImport(AppKit)
            let tableBlocks = (style?.textBlocks ?? []).compactMap { $0 as? NSTextTableBlock }
            if tableBlocks.count > 1 {
                unsupported.insert(.nestedTable)
            } else if let block = tableBlocks.first {
                if block.rowSpan != 1 || block.columnSpan != 1 { unsupported.insert(.mergedTableCells) }
                if !record.lists.isEmpty { unsupported.insert(.listInTableCell) }
                record.cell = CellPosition(
                    table: block.table, row: block.startingRow, column: block.startingColumn,
                    columns: block.table.numberOfColumns)
            }
            #endif
            records.append(record)
            start = next
        }
        return records
    }

    private static func alignment(_ alignment: NSTextAlignment?) -> Doc.Alignment? {
        switch alignment {
        case .center: .center
        case .right: .right
        case .justified: .justify
        default: nil
        }
    }

    private static func inlines(of attributed: NSAttributedString, in range: NSRange, units: [UInt16]) -> [Doc.Inline] {
        var builder = InlineBuilder()
        guard range.length > 0 else { return [] }
        attributed.enumerateAttributes(in: range, options: []) { attributes, runRange, _ in
            let marks = self.marks(from: attributes)
            var segmentStart = runRange.location
            let end = NSMaxRange(runRange)
            func flush(_ upTo: Int) {
                guard upTo > segmentStart else { return }
                builder.append(String(utf16CodeUnits: Array(units[segmentStart..<upTo]), count: upTo - segmentStart), marks: marks)
            }
            for index in runRange.location..<end {
                switch units[index] {
                case 0x2028, 0x0B:
                    flush(index)
                    builder.appendBreak()
                    segmentStart = index + 1
                case 0x0000, 0xFFFC:
                    // U+FFFC is refused as an attachment; U+0000 cannot survive RTF.
                    flush(index)
                    segmentStart = index + 1
                default:
                    break
                }
            }
            flush(end)
        }
        return builder.content
    }

    private static func marks(from attributes: [NSAttributedString.Key: Any]) -> [Doc.Mark] {
        var marks: [Doc.Mark] = []
        if let font = attributes[.font] as? PlatformFont {
            let traits = font.inkkitTraits
            if traits.bold { marks.append(.bold) }
            if traits.italic { marks.append(.italic) }
            if traits.monospace { marks.append(.code) }
        }
        if let underline = (attributes[.underlineStyle] as? NSNumber)?.intValue, underline != 0 {
            marks.append(.underline)
        }
        if let strike = (attributes[.strikethroughStyle] as? NSNumber)?.intValue, strike != 0 {
            marks.append(.strikethrough)
        }
        let superscript = (attributes[.inkkitSuperscript] as? NSNumber)?.intValue ?? 0
        let baseline = (attributes[.baselineOffset] as? NSNumber)?.doubleValue ?? 0
        if superscript > 0 || (superscript == 0 && baseline > 0) {
            marks.append(.superscript)
        } else if superscript < 0 || (superscript == 0 && baseline < 0) {
            marks.append(.subscript)
        }
        switch attributes[.link] {
        case let url as URL where !url.absoluteString.isEmpty:
            marks.append(.link(href: url.absoluteString))
        case let href as String where !href.isEmpty:
            marks.append(.link(href: href))
        default:
            break
        }
        return marks.sorted()
    }

    // MARK: Blocks

    private static func blocks(from records: [Record]) -> [Doc.Block] {
        var blocks: [Doc.Block] = []
        var itemsSeen: [ObjectIdentifier: Int] = [:]
        var index = 0
        while index < records.count {
            let record = records[index]
            if let cell = record.cell {
                var end = index + 1
                while end < records.count, let next = records[end].cell, next.table === cell.table { end += 1 }
                blocks.append(.table(table(from: records[index..<end])))
                index = end
            } else if let outer = record.lists.first {
                var end = index + 1
                while end < records.count, records[end].cell == nil, records[end].lists.first === outer { end += 1 }
                blocks.append(.list(list(from: records[index..<end], depth: 0, itemsSeen: &itemsSeen)))
                index = end
            } else {
                blocks.append(.paragraph(record.paragraph))
                index += 1
            }
        }
        return blocks
    }

    /// Builds the list at `depth` from paragraphs that all share `lists[depth]`.
    ///
    /// Paragraphs at this depth become items; deeper paragraphs become nested lists in the
    /// preceding item. A nested list with no preceding item gets an item with an empty paragraph.
    private static func list(
        from records: ArraySlice<Record>, depth: Int, itemsSeen: inout [ObjectIdentifier: Int]
    ) -> Doc.List {
        let textList = records.first!.lists[depth]
        let key = ObjectIdentifier(textList)
        var items: [Doc.ListItem] = []
        var index = records.startIndex
        while index < records.endIndex {
            let record = records[index]
            if record.lists.count == depth + 1 {
                items.append(Doc.ListItem(blocks: [.paragraph(record.paragraph)]))
                index += 1
                continue
            }
            if items.isEmpty { items.append(Doc.ListItem(blocks: [.paragraph(Doc.Paragraph())])) }
            let child = record.lists[depth + 1]
            var end = index + 1
            while end < records.endIndex, records[end].lists.count > depth + 1, records[end].lists[depth + 1] === child {
                end += 1
            }
            items[items.count - 1].blocks.append(.list(list(from: records[index..<end], depth: depth + 1, itemsSeen: &itemsSeen)))
            index = end
        }
        let seen = itemsSeen[key, default: 0]
        itemsSeen[key] = seen + items.count
        guard textList.isOrdered else { return Doc.List(ordered: false, items: items) }
        // A list that resumes after other paragraphs keeps counting from where it stopped.
        let start = textList.startingItemNumber + seen
        return Doc.List(ordered: true, start: start == 1 ? nil : start, items: items)
    }

    private static func table(from records: ArraySlice<Record>) -> Doc.Table {
        var cells: [Int: [Int: [[Doc.Inline]]]] = [:]
        var rowCount = 0
        var columnCount = 1
        for record in records {
            guard let cell = record.cell else { continue }
            cells[cell.row, default: [:]][cell.column, default: []].append(record.paragraph.content)
            rowCount = max(rowCount, cell.row + 1)
            columnCount = max(columnCount, cell.columns, cell.column + 1)
        }
        var rows: [[Doc.Cell]] = []
        for row in 0..<rowCount {
            var rowCells: [Doc.Cell] = []
            for column in 0..<columnCount {
                // Several paragraphs in one cell join with line breaks.
                let paragraphs = cells[row]?[column] ?? []
                var content: [Doc.Inline] = []
                for (index, paragraph) in paragraphs.enumerated() {
                    if index > 0 { content.append(.lineBreak) }
                    content.append(contentsOf: paragraph)
                }
                rowCells.append(Doc.Cell(content))
            }
            rows.append(rowCells)
        }
        return Doc.Table(rows: rows)
    }
}
