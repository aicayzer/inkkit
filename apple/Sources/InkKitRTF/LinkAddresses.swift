import Foundation
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Keeps link addresses exactly through RTF.
///
/// The system's RTF writer percent-encodes a link's address in its `HYPERLINK` field, and its
/// reader always gives back a URL, so an address such as `http://[` returns as `http://%5B`. The
/// writer therefore also records the exact address of every link, in document order, in an
/// `{\*\inkkitlinks …}` destination. RTF readers skip a `\*` destination they don't know, so other
/// apps see only the fields.
///
/// The reader trusts the record only when it describes the links it found: the same number of
/// them, each entry giving the address the system read for that link. Otherwise, as after an
/// edit in another app, it ignores the whole record and keeps the system's addresses, so a record
/// can neither fail a read nor point a link somewhere else. A record that is damaged in any way is
/// ignored the same way.
enum LinkAddresses {
    private static let destination = "inkkitlinks"

    /// The most entries, and the most UTF-16 units in one address, a record may hold. Beyond them
    /// the record is ignored rather than read.
    static let maximumEntries = 100_000
    static let maximumAddressLength = 65_536

    // MARK: Writing

    /// The value the writer gives the `.link` attribute: a URL when one keeps the address exactly,
    /// and otherwise the address as text.
    static func linkValue(_ href: String) -> Any {
        if let url = URL(string: href), url.absoluteString == href { return url }
        return href
    }

    /// `data` with a record of `hrefs`, the address of each link in document order.
    static func record(_ hrefs: [String], in data: Data) -> Data {
        guard !hrefs.isEmpty, let end = data.lastIndex(of: UInt8(ascii: "}")) else { return data }
        var group = "{\\*\\\(destination)\\uc0 "
        for href in hrefs { group += "{\\inkkithref \(escaped(href))}" }
        group += "}"
        var output = data
        output.insert(contentsOf: Data(group.utf8), at: end)
        return output
    }

    /// `text` as RTF text: printable ASCII as itself, with `\`, `{` and `}` escaped, and every other
    /// UTF-16 unit as `\uN` with a space ending the number.
    private static func escaped(_ text: String) -> String {
        var out = ""
        for unit in text.utf16 {
            switch unit {
            case 0x5C, 0x7B, 0x7D:
                out += "\\" + String(UnicodeScalar(UInt8(unit)))
            case 0x20..<0x7F:
                out += String(UnicodeScalar(UInt8(unit)))
            default:
                out += "\\u\(Int16(bitPattern: unit)) "
            }
        }
        return out
    }

    // MARK: Reading

    /// The address the system's reader gives for a link written with `href`, or nil when it can't
    /// say.
    static func readBack(_ href: String) -> String? {
        let source = NSAttributedString(string: "x", attributes: [.link: linkValue(href)])
        guard let data = try? source.data(
            from: NSRange(location: 0, length: source.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]),
            let read = try? NSAttributedString(
                data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil),
            read.length > 0
        else { return nil }
        switch read.attribute(.link, at: 0, effectiveRange: nil) {
        case let url as URL: return url.absoluteString
        case let string as String: return string
        default: return nil
        }
    }

    /// The exact addresses for `found`, the addresses the system read for each link in document
    /// order, or nil to keep them, when `data` holds no record or one that doesn't describe them.
    static func addresses(in data: Data, for found: [String]) -> [String]? {
        guard !found.isEmpty, let entries = entries(in: data), entries.count == found.count else { return nil }
        for (entry, read) in zip(entries, found) {
            guard RichTextDocument.linkProblem(entry) == nil, readBack(entry) == read else { return nil }
        }
        return entries
    }

    /// The entries of the first record in `data`, or nil when there is none or it is damaged.
    static func entries(in data: Data) -> [String]? {
        let marker = Array("{\\*\\\(destination)".utf8)
        return data.withUnsafeBytes { raw -> [String]? in
            let bytes = raw.bindMemory(to: UInt8.self)
            guard let start = firstIndex(of: marker, in: bytes) else { return nil }
            var parser = Parser(bytes: bytes, index: start + marker.count)
            return parser.entries()
        }
    }

    private static func firstIndex(of marker: [UInt8], in bytes: UnsafeBufferPointer<UInt8>) -> Int? {
        guard !marker.isEmpty, bytes.count >= marker.count else { return nil }
        var index = 0
        while index <= bytes.count - marker.count {
            var matches = true
            for offset in 0..<marker.count where bytes[index + offset] != marker[offset] {
                matches = false
                break
            }
            if matches { return index }
            index += 1
        }
        return nil
    }

    /// Reads `{\inkkithref …}` groups until the destination closes. Every read is bounds checked, and
    /// anything other than what the writer writes makes the record damaged.
    private struct Parser {
        let bytes: UnsafeBufferPointer<UInt8>
        var index: Int

        private var current: UInt8? { index < bytes.count ? bytes[index] : nil }

        mutating func entries() -> [String]? {
            // The writer's `\uc0`, then the entries, then the closing brace.
            skipSpaces()
            guard word() == "uc", parameter() == 0 else { return nil }
            var entries: [String] = []
            while true {
                skipSpaces()
                switch current {
                case UInt8(ascii: "}"):
                    index += 1
                    return entries
                case UInt8(ascii: "{"):
                    index += 1
                    guard entries.count < LinkAddresses.maximumEntries,
                          word() == "inkkithref",
                          let text = text()
                    else { return nil }
                    entries.append(text)
                default:
                    // A stray byte, a nested destination or the end of the data.
                    return nil
                }
            }
        }

        private mutating func skipSpaces() {
            while let byte = current, byte == 0x20 || byte == 0x0A || byte == 0x0D || byte == 0x09 { index += 1 }
        }

        /// The control word at `index`, with its backslash, or nil when there is none.
        private mutating func word() -> String? {
            guard current == UInt8(ascii: "\\") else { return nil }
            index += 1
            var name = ""
            while let byte = current, (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) {
                guard name.utf8.count < 32 else { return nil }
                name.unicodeScalars.append(UnicodeScalar(byte))
                index += 1
            }
            return name.isEmpty ? nil : name
        }

        /// The signed number after a control word, ending at a space that it consumes, or nil when
        /// it is missing or outside `Int16`.
        private mutating func parameter() -> Int? {
            var negative = false
            if current == UInt8(ascii: "-") {
                negative = true
                index += 1
            }
            var value = 0
            var digits = 0
            while let byte = current, byte >= 0x30, byte <= 0x39 {
                digits += 1
                // Five digits hold any UTF-16 unit; more is damage, refused before it can overflow.
                guard digits <= 5 else { return nil }
                value = value * 10 + Int(byte - 0x30)
                index += 1
            }
            guard digits > 0 else { return nil }
            if current == 0x20 { index += 1 }
            let signed = negative ? -value : value
            return signed >= Int(Int16.min) && signed <= Int(UInt16.max) ? signed : nil
        }

        /// The text of the current entry up to its closing brace, which it consumes, or nil when the
        /// entry is damaged.
        private mutating func text() -> String? {
            if current == 0x20 { index += 1 }
            var units: [UInt16] = []
            while let byte = current {
                guard units.count <= LinkAddresses.maximumAddressLength else { return nil }
                switch byte {
                case UInt8(ascii: "}"):
                    index += 1
                    return String(decoding: units, as: UTF16.self)
                case UInt8(ascii: "{"):
                    return nil
                case UInt8(ascii: "\\"):
                    guard index + 1 < bytes.count else { return nil }
                    let next = bytes[index + 1]
                    if next == UInt8(ascii: "\\") || next == UInt8(ascii: "{") || next == UInt8(ascii: "}") {
                        units.append(UInt16(next))
                        index += 2
                        continue
                    }
                    guard word() == "u", let value = parameter() else { return nil }
                    units.append(UInt16(truncatingIfNeeded: value))
                case 0x20..<0x7F:
                    units.append(UInt16(byte))
                    index += 1
                default:
                    return nil
                }
            }
            // The data ended inside the entry.
            return nil
        }
    }

    /// The address of each link in `document`, in document order. A link is a sequence of runs in
    /// one paragraph or cell with the same address; the writer, the reader and `restore` all count
    /// links this way.
    static func hrefs(of document: RichTextDocument) -> [String] {
        var found: [String] = []
        _ = mapLinks(document) { href in
            found.append(href)
            return href
        }
        return found
    }

    /// `document` with the address of each link, in document order, replaced by `addresses`.
    static func restore(_ document: RichTextDocument, addresses: [String]) -> RichTextDocument {
        var next = addresses.makeIterator()
        return mapLinks(document) { href in next.next() ?? href }
    }

    /// `document` with each link's address replaced by `transform`, called once per link in order.
    private static func mapLinks(
        _ document: RichTextDocument, _ transform: (String) -> String
    ) -> RichTextDocument {
        typealias Doc = RichTextDocument
        func inlines(_ content: [Doc.Inline]) -> [Doc.Inline] {
            var previous: String?
            var replacement = ""
            return content.map { inline in
                guard case .text(let text, let marks) = inline,
                      let href = marks.lazy.compactMap({ mark -> String? in
                          if case .link(let href) = mark { return href }
                          return nil
                      }).first
                else {
                    previous = nil
                    return inline
                }
                if href != previous {
                    previous = href
                    replacement = transform(href)
                }
                return .text(text, marks: marks.map { mark in
                    if case .link = mark { return .link(href: replacement) }
                    return mark
                })
            }
        }
        func block(_ item: Doc.Block) -> Doc.Block {
            switch item {
            case .paragraph(let paragraph):
                return .paragraph(Doc.Paragraph(inlines(paragraph.content), align: paragraph.align))
            case .list(let list):
                return .list(Doc.List(
                    ordered: list.ordered, start: list.start,
                    items: list.items.map { Doc.ListItem(blocks: $0.blocks.map(block)) }))
            case .table(let table):
                return .table(Doc.Table(rows: table.rows.map { $0.map { Doc.Cell(inlines($0.content)) } }))
            }
        }
        return Doc(blocks: document.blocks.map(block))
    }
}
