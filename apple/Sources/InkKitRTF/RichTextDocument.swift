import Foundation

/// A rich text document in the form the Inkkit editor loads.
///
/// The JSON form is the contract with the editor. ``jsonData(prettyPrinted:)`` writes the
/// canonical form, and ``init(json:)`` reads, validates and canonicalizes it.
public struct RichTextDocument: Codable, Equatable, Hashable, Sendable {
    /// The only model version this package reads and writes.
    public static let currentVersion = 1

    public var version: Int
    public var blocks: [Block]

    public init(blocks: [Block] = [], version: Int = RichTextDocument.currentVersion) {
        self.version = version
        self.blocks = blocks
    }

    /// A top-level block, or a block inside a list item.
    public enum Block: Equatable, Hashable, Sendable {
        case paragraph(Paragraph)
        case list(List)
        case table(Table)
    }

    /// Paragraph alignment. Left and natural alignment have no value.
    public enum Alignment: String, Codable, Hashable, Sendable, CaseIterable {
        case center
        case right
        case justify
    }

    public struct Paragraph: Equatable, Hashable, Sendable {
        public var align: Alignment?
        public var content: [Inline]

        public init(_ content: [Inline] = [], align: Alignment? = nil) {
            self.align = align
            self.content = content
        }
    }

    public struct List: Equatable, Hashable, Sendable {
        public var ordered: Bool
        /// The first item number of an ordered list. `nil` means 1.
        public var start: Int?
        public var items: [ListItem]

        public init(ordered: Bool, start: Int? = nil, items: [ListItem]) {
            self.ordered = ordered
            self.start = start
            self.items = items
        }
    }

    /// A list item: a paragraph, followed by any nested lists.
    public struct ListItem: Equatable, Hashable, Sendable {
        public var blocks: [Block]

        public init(blocks: [Block]) {
            self.blocks = blocks
        }

        public init(_ paragraph: Paragraph, nested: [List] = []) {
            self.blocks = [.paragraph(paragraph)] + nested.map(Block.list)
        }
    }

    /// A table. Every row has the same number of cells.
    public struct Table: Equatable, Hashable, Sendable {
        public var rows: [[Cell]]

        public init(rows: [[Cell]]) {
            self.rows = rows
        }
    }

    public struct Cell: Equatable, Hashable, Sendable {
        public var content: [Inline]

        public init(_ content: [Inline] = []) {
            self.content = content
        }
    }

    public enum Inline: Equatable, Hashable, Sendable {
        /// A run of text. It is never empty and holds no line or paragraph separators.
        case text(String, marks: [Mark] = [])
        /// A line break inside a paragraph or cell (U+2028 in RTF).
        case lineBreak
    }

    /// An inline mark. The declaration order is the canonical sort order.
    public enum Mark: Hashable, Sendable, Comparable {
        case bold
        case italic
        case underline
        case strikethrough
        case superscript
        case `subscript`
        case code
        case link(href: String)

        var typeName: String {
            switch self {
            case .bold: "bold"
            case .italic: "italic"
            case .underline: "underline"
            case .strikethrough: "strikethrough"
            case .superscript: "superscript"
            case .subscript: "subscript"
            case .code: "code"
            case .link: "link"
            }
        }

        var rank: Int {
            switch self {
            case .bold: 0
            case .italic: 1
            case .underline: 2
            case .strikethrough: 3
            case .superscript: 4
            case .subscript: 5
            case .code: 6
            case .link: 7
            }
        }

        public static func < (lhs: Mark, rhs: Mark) -> Bool {
            if lhs.rank != rhs.rank { return lhs.rank < rhs.rank }
            if case .link(let a) = lhs, case .link(let b) = rhs { return a < b }
            return false
        }
    }
}

// MARK: - JSON

extension RichTextDocument {
    /// Reads a document from JSON, then validates and canonicalizes it.
    ///
    /// - Throws: ``RTFConversionError/invalidDocument(_:)`` when the JSON does not describe
    ///   a valid version 1 document.
    public init(json: Data) throws(RTFConversionError) {
        let decoded: RichTextDocument
        do {
            decoded = try JSONDecoder().decode(RichTextDocument.self, from: json)
        } catch let error as DecodingError {
            throw .invalidDocument(Self.describe(error))
        } catch {
            throw .invalidDocument("the data is not JSON")
        }
        self = try decoded.canonicalized()
    }

    /// Writes the canonical form as JSON with sorted keys.
    ///
    /// - Throws: ``RTFConversionError/invalidDocument(_:)`` when the document is not valid.
    public func jsonData(prettyPrinted: Bool = false) throws(RTFConversionError) -> Data {
        let canonical = try canonicalized()
        let encoder = JSONEncoder()
        encoder.outputFormatting = prettyPrinted
            ? [.sortedKeys, .withoutEscapingSlashes, .prettyPrinted]
            : [.sortedKeys, .withoutEscapingSlashes]
        do {
            return try encoder.encode(canonical)
        } catch {
            throw .invalidDocument("the document cannot be encoded as JSON")
        }
    }

    private static func describe(_ error: DecodingError) -> String {
        func path(_ codingPath: [any CodingKey]) -> String {
            var out = ""
            for key in codingPath {
                if let index = key.intValue {
                    out += "[\(index)]"
                } else {
                    out += out.isEmpty ? key.stringValue : ".\(key.stringValue)"
                }
            }
            return out.isEmpty ? "document" : out
        }
        switch error {
        case .typeMismatch(_, let context), .valueNotFound(_, let context):
            return "\(path(context.codingPath)): \(context.debugDescription)"
        case .keyNotFound(let key, let context):
            return "\(path(context.codingPath + [key])): required value is missing"
        case .dataCorrupted(let context):
            return context.codingPath.isEmpty
                ? "the data is not valid JSON"
                : "\(path(context.codingPath)): \(context.debugDescription)"
        @unknown default:
            return "the JSON does not describe a document"
        }
    }
}

// MARK: - Codable

extension RichTextDocument.Block: Codable {
    private enum Keys: String, CodingKey {
        case type, align, content, ordered, start, items, rows
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "paragraph":
            self = .paragraph(.init(
                try container.decode([RichTextDocument.Inline].self, forKey: .content),
                align: try container.decodeIfPresent(RichTextDocument.Alignment.self, forKey: .align)
            ))
        case "list":
            self = .list(.init(
                ordered: try container.decode(Bool.self, forKey: .ordered),
                start: try container.decodeIfPresent(Int.self, forKey: .start),
                items: try container.decode([RichTextDocument.ListItem].self, forKey: .items)
            ))
        case "table":
            self = .table(.init(rows: try container.decode([[RichTextDocument.Cell]].self, forKey: .rows)))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "unknown block type \"\(type)\"")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case .paragraph(let paragraph):
            try container.encode("paragraph", forKey: .type)
            try container.encodeIfPresent(paragraph.align, forKey: .align)
            try container.encode(paragraph.content, forKey: .content)
        case .list(let list):
            try container.encode("list", forKey: .type)
            try container.encode(list.ordered, forKey: .ordered)
            if list.ordered, let start = list.start, start != 1 {
                try container.encode(start, forKey: .start)
            }
            try container.encode(list.items, forKey: .items)
        case .table(let table):
            try container.encode("table", forKey: .type)
            try container.encode(table.rows, forKey: .rows)
        }
    }
}

extension RichTextDocument.ListItem: Codable {
    private enum Keys: String, CodingKey { case blocks }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        self.init(blocks: try container.decode([RichTextDocument.Block].self, forKey: .blocks))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(blocks, forKey: .blocks)
    }
}

extension RichTextDocument.Cell: Codable {
    private enum Keys: String, CodingKey { case content }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        self.init(try container.decode([RichTextDocument.Inline].self, forKey: .content))
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(content, forKey: .content)
    }
}

extension RichTextDocument.Inline: Codable {
    private enum Keys: String, CodingKey { case type, text, marks }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "text":
            self = .text(
                try container.decode(String.self, forKey: .text),
                marks: try container.decodeIfPresent([RichTextDocument.Mark].self, forKey: .marks) ?? [])
        case "break":
            self = .lineBreak
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "unknown inline type \"\(type)\"")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case .text(let text, let marks):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)
            if !marks.isEmpty {
                try container.encode(marks, forKey: .marks)
            }
        case .lineBreak:
            try container.encode("break", forKey: .type)
        }
    }
}

extension RichTextDocument.Mark: Codable {
    private enum Keys: String, CodingKey { case type, href }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "bold": self = .bold
        case "italic": self = .italic
        case "underline": self = .underline
        case "strikethrough": self = .strikethrough
        case "superscript": self = .superscript
        case "subscript": self = .subscript
        case "code": self = .code
        case "link": self = .link(href: try container.decode(String.self, forKey: .href))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "unknown mark type \"\(type)\"")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(typeName, forKey: .type)
        if case .link(let href) = self {
            try container.encode(href, forKey: .href)
        }
    }
}
