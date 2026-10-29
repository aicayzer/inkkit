import Foundation

/// Checks RTF source before the system reads it.
///
/// The system RTF reader drops several kinds of content without reporting it: pictures and
/// embedded objects (`\pict`, `\object`, `\NeXTGraphic`, `\bin`), shapes and text boxes, headers,
/// footers, footnotes and comments. It also stops at the first closing brace that ends the
/// document, so text after an unbalanced `}` disappears. The scan finds these in the source,
/// so the conversion can refuse them.
enum RTFSource {
    struct Findings {
        /// Where `{\rtf` starts, after any leading whitespace, which the system reader refuses.
        var start = 0
        var unsupported: Set<RTFConversionError.UnsupportedContent> = []
    }

    private static let attachmentWords: Set<String> = [
        "pict", "object", "objdata", "NeXTGraphic", "shp", "shpgrp", "shppict", "do",
    ]
    private static let headerFooterWords: Set<String> = [
        "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf",
    ]
    private static let mergedCellWords: Set<String> = ["clmgf", "clmrg", "clvmgf", "clvmrg"]
    private static let nestedTableWords: Set<String> = ["nestcell", "nestrow", "nesttableprops"]
    private static let tableWords: Set<String> = ["trowd", "intbl", "cell", "row", "itap"]

    /// Throws ``RTFConversionError/notRTF`` or ``RTFConversionError/unreadable``, and reports
    /// the unsupported content it finds.
    static func scan(_ data: Data) throws(RTFConversionError) -> Findings {
        let result: Result<Findings, RTFConversionError> = data.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self)
            return scan(bytes)
        }
        return try result.get()
    }

    private static func isSpace(_ byte: UInt8) -> Bool {
        byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D || byte == 0x0C
    }

    private static func isLetter(_ byte: UInt8) -> Bool {
        (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A)
    }

    private static func isDigit(_ byte: UInt8) -> Bool {
        byte >= 0x30 && byte <= 0x39
    }

    private static func scan(_ bytes: UnsafeBufferPointer<UInt8>) -> Result<Findings, RTFConversionError> {
        var index = 0
        let count = bytes.count
        while index < count, isSpace(bytes[index]) { index += 1 }
        let signature: [UInt8] = Array("{\\rtf".utf8)
        guard count - index >= signature.count,
              signature.indices.allSatisfy({ bytes[index + $0] == signature[$0] })
        else { return .failure(.notRTF) }

        var findings = Findings(start: index)
        var depth = 0
        var closed = false
        while index < count {
            let byte = bytes[index]
            switch byte {
            case UInt8(ascii: "{"):
                depth += 1
                index += 1
            case UInt8(ascii: "}"):
                depth -= 1
                index += 1
                if depth == 0 {
                    closed = true
                }
            case UInt8(ascii: "\\"):
                index += 1
                guard index < count else { break }
                guard isLetter(bytes[index]) else {
                    // A control symbol such as \\, \{, \} or \'hh: skip the symbol character.
                    index += 1
                    continue
                }
                let wordStart = index
                while index < count, isLetter(bytes[index]) { index += 1 }
                let word = String(decoding: UnsafeBufferPointer(rebasing: bytes[wordStart..<index]), as: UTF8.self)
                var negative = false
                if index < count, bytes[index] == UInt8(ascii: "-") {
                    negative = true
                    index += 1
                }
                var parameter: Int?
                while index < count, isDigit(bytes[index]) {
                    let digit = Int(bytes[index] - 0x30)
                    parameter = min((parameter ?? 0) * 10 + digit, Int(Int32.max))
                    index += 1
                }
                if negative, let value = parameter { parameter = -value }
                if index < count, bytes[index] == 0x20 { index += 1 }
                if word == "bin", let length = parameter, length > 0 {
                    // Binary data only carries pictures and objects. The system reader does not
                    // skip it inside an ignored group, so braces in it would cut the text short.
                    findings.unsupported.insert(.attachment)
                    index = min(count, index + length)
                    continue
                }
                record(word, parameter: parameter, in: &findings)
            default:
                index += 1
            }
            if closed { break }
            if depth < 0 { return .failure(.unreadable) }
        }
        guard closed else { return .failure(.unreadable) }
        // The reader ignores everything after the closing brace of the document, so anything
        // other than whitespace or padding there would be lost.
        while index < count {
            let byte = bytes[index]
            guard isSpace(byte) || byte == 0 else { return .failure(.unreadable) }
            index += 1
        }
        return .success(findings)
    }

    private static func record(_ word: String, parameter: Int?, in findings: inout Findings) {
        if attachmentWords.contains(word) {
            findings.unsupported.insert(.attachment)
        } else if headerFooterWords.contains(word) {
            findings.unsupported.insert(.headerOrFooter)
        } else if word == "footnote" {
            findings.unsupported.insert(.footnote)
        } else if word == "annotation" {
            findings.unsupported.insert(.comment)
        } else if mergedCellWords.contains(word) {
            findings.unsupported.insert(.mergedTableCells)
        } else if nestedTableWords.contains(word) || (word == "itap" && (parameter ?? 1) > 1) {
            findings.unsupported.insert(.nestedTable)
        }
        #if !canImport(AppKit)
        if tableWords.contains(word), word != "itap" || (parameter ?? 1) > 0 {
            findings.unsupported.insert(.table)
        }
        #endif
    }
}
