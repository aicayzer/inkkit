import Foundation

/// Why a conversion was refused. A conversion never drops content silently: it throws instead.
///
/// The cases and their ``code`` values are stable, so a host can pass them to the editor.
public enum RTFConversionError: Error, Equatable, Hashable, Sendable {
    /// The data is not RTF. It does not start with `{\rtf` after optional whitespace, or it is
    /// RTFD (a directory, a package or flattened RTFD data).
    case notRTF
    /// The data starts like RTF, but it is damaged: the system cannot read it, the groups are
    /// unbalanced, or text follows the end of the document.
    case unreadable
    /// The RTF holds content the document model cannot represent. The kinds are sorted and unique.
    case unsupportedContent([UnsupportedContent])
    /// A document is not a valid version 1 document. The reason names the first problem found.
    case invalidDocument(String)
    /// The system failed to write the RTF.
    case writeFailed

    /// Content that the document model cannot represent, so a conversion refuses it.
    public enum UnsupportedContent: String, Hashable, Sendable, CaseIterable, Comparable {
        /// An image, file, embedded object, shape or text box, including U+FFFC in the text.
        case attachment
        /// A table, on a platform without `NSTextTable` (iOS).
        case table
        /// A table cell that spans rows or columns.
        case mergedTableCells
        /// A table inside a table cell.
        case nestedTable
        /// A list inside a table cell, or a table inside a list.
        case listInTableCell
        /// A page header or footer.
        case headerOrFooter
        /// A footnote or endnote.
        case footnote
        /// A comment (an RTF annotation).
        case comment

        public static func < (lhs: Self, rhs: Self) -> Bool {
            allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
        }

        var phrase: String {
            switch self {
            case .attachment: "images, files or embedded objects"
            case .table: "tables"
            case .mergedTableCells: "merged table cells"
            case .nestedTable: "tables inside tables"
            case .listInTableCell: "lists inside tables"
            case .headerOrFooter: "headers or footers"
            case .footnote: "footnotes"
            case .comment: "comments"
            }
        }
    }

    /// A stable identifier for the case: `notRTF`, `unreadable`, `unsupportedContent`,
    /// `invalidDocument` or `writeFailed`.
    public var code: String {
        switch self {
        case .notRTF: "notRTF"
        case .unreadable: "unreadable"
        case .unsupportedContent: "unsupportedContent"
        case .invalidDocument: "invalidDocument"
        case .writeFailed: "writeFailed"
        }
    }

    static func unsupported(_ kinds: Set<UnsupportedContent>) -> RTFConversionError {
        .unsupportedContent(kinds.sorted())
    }
}

extension RTFConversionError: CustomStringConvertible, LocalizedError {
    public var description: String {
        switch self {
        case .notRTF:
            return "The file is not an RTF document."
        case .unreadable:
            return "The RTF document is damaged and cannot be read."
        case .unsupportedContent(let kinds):
            let list = kinds.map(\.phrase)
            let joined = switch list.count {
            case 0: "content that cannot be converted"
            case 1: list[0]
            default: list.dropLast().joined(separator: ", ") + " and " + list.last!
            }
            return "The RTF document contains \(joined), which would be lost."
        case .invalidDocument(let reason):
            return "The document is not valid: \(reason)."
        case .writeFailed:
            return "The RTF document could not be written."
        }
    }

    public var errorDescription: String? { description }
}
