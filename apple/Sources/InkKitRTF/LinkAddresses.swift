import Foundation
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Keeps link addresses exactly through RTF.
///
/// The system's RTF writer percent-encodes a link's address in its `HYPERLINK` field, and its
/// reader always gives back a URL, so an address such as `http://[` returns as `http://%5B`.
/// The writer therefore also records each address the system would change, keyed by what the
/// system reads back, in an `{\*\inkkitlinks …}` destination. RTF readers skip a `\*`
/// destination they don't know, so other apps see only the field; this package's reader uses
/// the record to give back the address as written.
enum LinkAddresses {
    private static let destination = "inkkitlinks"

    // MARK: Writing

    /// The address the system's reader gives for a link written with `href`.
    static func readBack(_ href: String) throws(RTFConversionError) -> String {
        let value = linkValue(href)
        let source = NSAttributedString(string: "x", attributes: [.link: value])
        do {
            let data = try source.data(
                from: NSRange(location: 0, length: source.length),
                documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
            let read = try NSAttributedString(
                data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil)
            guard read.length > 0 else { throw RTFConversionError.writeFailed }
            switch read.attribute(.link, at: 0, effectiveRange: nil) {
            case let url as URL: return url.absoluteString
            case let string as String: return string
            default: throw RTFConversionError.writeFailed
            }
        } catch {
            throw .writeFailed
        }
    }

    /// The value the writer gives the `.link` attribute: a URL when one keeps the address exactly,
    /// and otherwise the address as text.
    static func linkValue(_ href: String) -> Any {
        if let url = URL(string: href), url.absoluteString == href { return url }
        return href
    }

    /// `data` with a record of every address in `hrefs` that the system would change. Throws
    /// ``RTFConversionError/invalidDocument(_:)`` when two addresses would read back the same,
    /// since the reader could not tell them apart.
    static func record(_ hrefs: Set<String>, in data: Data) throws(RTFConversionError) -> Data {
        var exact: [String: String] = [:]
        var keys: [String: String] = [:]
        for href in hrefs.sorted() {
            let key = try readBack(href)
            if let other = keys[key], other != href {
                let pair = [other, href].sorted()
                throw .invalidDocument(
                    "the links \(pair[0]) and \(pair[1]) would read back from RTF as the same address")
            }
            keys[key] = href
            if key != href { exact[key] = href }
        }
        guard !exact.isEmpty, let end = data.lastIndex(of: UInt8(ascii: "}")) else { return data }
        var group = "{\\*\\\(destination)\\uc0 "
        for (key, href) in exact.sorted(by: { $0.key < $1.key }) {
            group += "{\\inkkitlink{\\inkkitkey \(escaped(key))}{\\inkkithref \(escaped(href))}}"
        }
        group += "}"
        var output = data
        output.insert(contentsOf: Data(group.utf8), at: end)
        return output
    }

    /// `text` as RTF text: ASCII as itself, with `\`, `{` and `}` escaped, and every other UTF-16
    /// unit as `\uN`.
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

    /// The addresses recorded in RTF `data`, keyed by what the system's reader gives for each.
    /// Empty when the data has no record, as RTF from other apps has none.
    static func table(in data: Data) -> [String: String] {
        let marker = Array("{\\*\\\(destination)".utf8)
        let bytes = [UInt8](data)
        guard let start = firstIndex(of: marker, in: bytes) else { return [:] }
        var parser = Parser(bytes: bytes, index: start + marker.count)
        return parser.entries()
    }

    /// `document` with each link the system changed given back its recorded address.
    static func restore(_ document: RichTextDocument, from table: [String: String]) -> RichTextDocument {
        typealias Doc = RichTextDocument
        func inlines(_ content: [Doc.Inline]) -> [Doc.Inline] {
            content.map { inline in
                guard case .text(let text, let marks) = inline else { return inline }
                return .text(text, marks: marks.map { mark in
                    if case .link(let href) = mark, let exact = table[href] { return .link(href: exact) }
                    return mark
                })
            }
        }
        func restored(_ block: Doc.Block) -> Doc.Block {
            switch block {
            case .paragraph(let paragraph):
                return .paragraph(Doc.Paragraph(inlines(paragraph.content), align: paragraph.align))
            case .list(let list):
                return .list(Doc.List(
                    ordered: list.ordered, start: list.start,
                    items: list.items.map { Doc.ListItem(blocks: $0.blocks.map(restored)) }))
            case .table(let table):
                return .table(Doc.Table(rows: table.rows.map { $0.map { Doc.Cell(inlines($0.content)) } }))
            }
        }
        return Doc(blocks: document.blocks.map(restored))
    }

    private static func firstIndex(of marker: [UInt8], in bytes: [UInt8]) -> Int? {
        guard bytes.count >= marker.count else { return nil }
        for index in 0...(bytes.count - marker.count) where bytes[index] == marker[0] {
            if Array(bytes[index..<(index + marker.count)]) == marker { return index }
        }
        return nil
    }

    /// Reads `{\inkkitlink{\inkkitkey …}{\inkkithref …}}` groups until the destination closes.
    private struct Parser {
        let bytes: [UInt8]
        var index: Int

        mutating func entries() -> [String: String] {
            var table: [String: String] = [:]
            var depth = 1
            var key: String?
            while index < bytes.count, depth > 0 {
                let byte = bytes[index]
                if byte == UInt8(ascii: "{") {
                    index += 1
                    depth += 1
                    switch word() {
                    case "inkkitkey":
                        key = text()
                        depth -= 1
                    case "inkkithref":
                        if let found = key { table[found] = text() }
                        key = nil
                        depth -= 1
                    default:
                        break
                    }
                } else if byte == UInt8(ascii: "}") {
                    depth -= 1
                    index += 1
                } else if byte == UInt8(ascii: "\\") {
                    index += 1
                    _ = word()
                } else {
                    index += 1
                }
            }
            return table
        }

        /// The control word at `index` after its backslash, skipping its parameter and delimiter.
        private mutating func word() -> String {
            if index < bytes.count, bytes[index] == UInt8(ascii: "\\") { index += 1 }
            var name = ""
            while index < bytes.count, (bytes[index] | 0x20) >= UInt8(ascii: "a"), (bytes[index] | 0x20) <= UInt8(ascii: "z") {
                name.unicodeScalars.append(UnicodeScalar(bytes[index]))
                index += 1
            }
            if index < bytes.count, bytes[index] == UInt8(ascii: "-") { index += 1 }
            while index < bytes.count, bytes[index] >= UInt8(ascii: "0"), bytes[index] <= UInt8(ascii: "9") { index += 1 }
            if index < bytes.count, bytes[index] == 0x20 { index += 1 }
            return name
        }

        /// The text of the current group up to its closing brace, which it consumes.
        private mutating func text() -> String {
            var units: [UInt16] = []
            while index < bytes.count {
                let byte = bytes[index]
                if byte == UInt8(ascii: "}") {
                    index += 1
                    break
                }
                guard byte == UInt8(ascii: "\\") else {
                    if byte >= 0x20 { units.append(UInt16(byte)) }
                    index += 1
                    continue
                }
                index += 1
                guard index < bytes.count else { break }
                let next = bytes[index]
                if next == UInt8(ascii: "\\") || next == UInt8(ascii: "{") || next == UInt8(ascii: "}") {
                    units.append(UInt16(next))
                    index += 1
                    continue
                }
                guard next == UInt8(ascii: "u"), index + 1 < bytes.count,
                      bytes[index + 1] == UInt8(ascii: "-") || (bytes[index + 1] >= 0x30 && bytes[index + 1] <= 0x39)
                else {
                    _ = word()
                    continue
                }
                index += 1
                var negative = false
                if bytes[index] == UInt8(ascii: "-") {
                    negative = true
                    index += 1
                }
                var value = 0
                while index < bytes.count, bytes[index] >= 0x30, bytes[index] <= 0x39 {
                    value = value * 10 + Int(bytes[index] - 0x30)
                    index += 1
                }
                if index < bytes.count, bytes[index] == 0x20 { index += 1 }
                units.append(UInt16(truncatingIfNeeded: negative ? -value : value))
            }
            return String(decoding: units, as: UTF16.self)
        }
    }
}
