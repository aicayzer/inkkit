import Foundation

extension RichTextDocument {
    /// The deepest list nesting RTF can hold (`\ilvl` 0 to 8).
    public static let maximumListDepth = 9

    /// Characters that text runs never hold, because they would change the structure
    /// (`\n`, `\r`, U+000B, U+000C, U+0085, U+2028, U+2029), stand for an attachment (U+FFFC)
    /// or end the text when RTF is written (U+0000).
    static let forbiddenScalars: Set<Unicode.Scalar> = [
        "\u{0}", "\n", "\r", "\u{0B}", "\u{0C}", "\u{85}", "\u{2028}", "\u{2029}", "\u{FFFC}",
    ]

    /// Checks the document, then returns its canonical form.
    ///
    /// The canonical form sorts marks, merges adjacent text runs with equal marks and omits an
    /// ordered list's `start` of 1. A document is invalid when its version is not 1, a text run
    /// is empty or holds a forbidden character, a mark repeats, a run has two links, both
    /// superscript and subscript, or a link without an address, an unordered list has a start or an ordered list starts below 1,
    /// a list or list item is empty, a list item does not start with a paragraph or holds a
    /// table, lists nest deeper than ``maximumListDepth``, or a table has no rows or rows of
    /// different lengths.
    ///
    /// - Throws: ``RTFConversionError/invalidDocument(_:)`` naming the first problem.
    public func canonicalized() throws(RTFConversionError) -> RichTextDocument {
        guard version == Self.currentVersion else {
            throw .invalidDocument("version \(version) is not supported; the version must be 1")
        }
        var canonical = RichTextDocument(blocks: [])
        canonical.blocks = try blocks.enumerated().map { index, block throws(RTFConversionError) in
            try Self.canonical(block, at: "blocks[\(index)]", listDepth: 0)
        }
        return canonical
    }

    /// Checks the document without changing it.
    ///
    /// - Throws: ``RTFConversionError/invalidDocument(_:)`` naming the first problem.
    public func validate() throws(RTFConversionError) {
        _ = try canonicalized()
    }

    private static func canonical(
        _ block: Block, at path: String, listDepth: Int
    ) throws(RTFConversionError) -> Block {
        switch block {
        case .paragraph(let paragraph):
            return .paragraph(.init(try canonical(paragraph.content, at: "\(path).content"), align: paragraph.align))
        case .list(let list):
            return .list(try canonical(list, at: path, depth: listDepth + 1))
        case .table(let table):
            guard listDepth == 0 else {
                throw .invalidDocument("\(path): a table cannot be inside a list item")
            }
            guard let width = table.rows.first?.count else {
                throw .invalidDocument("\(path).rows: a table needs at least one row")
            }
            guard width > 0 else {
                throw .invalidDocument("\(path).rows[0]: a table row needs at least one cell")
            }
            var rows: [[Cell]] = []
            for (rowIndex, row) in table.rows.enumerated() {
                guard row.count == width else {
                    throw .invalidDocument(
                        "\(path).rows[\(rowIndex)]: the row has \(row.count) cells, but the first row has \(width)")
                }
                var cells: [Cell] = []
                for (cellIndex, cell) in row.enumerated() {
                    cells.append(Cell(try canonical(cell.content, at: "\(path).rows[\(rowIndex)][\(cellIndex)].content")))
                }
                rows.append(cells)
            }
            return .table(.init(rows: rows))
        }
    }

    private static func canonical(_ list: List, at path: String, depth: Int) throws(RTFConversionError) -> List {
        guard depth <= maximumListDepth else {
            throw .invalidDocument("\(path): lists nest deeper than \(maximumListDepth) levels")
        }
        var start = list.start
        if let value = start {
            guard list.ordered else {
                throw .invalidDocument("\(path).start: only an ordered list has a start")
            }
            // RTF's \levelstartat cannot hold 0 or a negative number: the writer stores 1.
            guard value >= 1 else {
                throw .invalidDocument("\(path).start: the start must be at least 1")
            }
            if value == 1 { start = nil }
        }
        guard !list.items.isEmpty else {
            throw .invalidDocument("\(path).items: a list needs at least one item")
        }
        var items: [ListItem] = []
        for (itemIndex, item) in list.items.enumerated() {
            let itemPath = "\(path).items[\(itemIndex)].blocks"
            guard case .paragraph? = item.blocks.first else {
                throw .invalidDocument("\(itemPath)[0]: a list item must start with a paragraph")
            }
            var blocks: [Block] = []
            for (blockIndex, block) in item.blocks.enumerated() {
                if blockIndex > 0 {
                    guard case .list = block else {
                        throw .invalidDocument(
                            "\(itemPath)[\(blockIndex)]: after its paragraph, a list item can hold only lists")
                    }
                }
                blocks.append(try canonical(block, at: "\(itemPath)[\(blockIndex)]", listDepth: depth))
            }
            items.append(ListItem(blocks: blocks))
        }
        return List(ordered: list.ordered, start: start, items: items)
    }

    static func canonical(_ content: [Inline], at path: String) throws(RTFConversionError) -> [Inline] {
        var builder = InlineBuilder()
        for (index, inline) in content.enumerated() {
            switch inline {
            case .lineBreak:
                builder.appendBreak()
            case .text(let text, let marks):
                let runPath = "\(path)[\(index)]"
                guard !text.isEmpty else {
                    throw .invalidDocument("\(runPath).text: a text run cannot be empty")
                }
                if let bad = text.unicodeScalars.first(where: forbiddenScalars.contains) {
                    let code = String(bad.value, radix: 16, uppercase: true)
                    throw .invalidDocument(
                        "\(runPath).text: text cannot hold U+\(String(repeating: "0", count: max(0, 4 - code.count)) + code)")
                }
                builder.append(text, marks: try canonical(marks, at: "\(runPath).marks"))
            }
        }
        return builder.content
    }

    private static func canonical(_ marks: [Mark], at path: String) throws(RTFConversionError) -> [Mark] {
        let sorted = marks.sorted()
        var types = Set<String>()
        for mark in sorted {
            guard types.insert(mark.typeName).inserted else {
                throw .invalidDocument("\(path): the \(mark.typeName) mark appears more than once")
            }
            if case .link(let href) = mark {
                guard !href.isEmpty, URL(string: href) != nil else {
                    throw .invalidDocument("\(path): a link needs an address")
                }
            }
        }
        if types.contains("superscript") && types.contains("subscript") {
            throw .invalidDocument("\(path): a run cannot be both superscript and subscript")
        }
        return sorted
    }
}

/// Collects inline content in canonical form: adjacent text runs with equal marks merge.
struct InlineBuilder {
    private(set) var content: [RichTextDocument.Inline] = []

    mutating func append(_ text: String, marks: [RichTextDocument.Mark]) {
        guard !text.isEmpty else { return }
        if case .text(let previous, let previousMarks)? = content.last, previousMarks == marks {
            content[content.count - 1] = .text(previous + text, marks: marks)
        } else {
            content.append(.text(text, marks: marks))
        }
    }

    mutating func appendBreak() {
        content.append(.lineBreak)
    }
}
