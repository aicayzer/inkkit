import Foundation
import Testing
@testable import InkKitRTF

typealias Doc = RichTextDocument

/// The fixtures shared with the TypeScript tests, in `test/formats/rtf/fixtures/`.
enum Fixtures {
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // InkKitRTFTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // apple
        .deletingLastPathComponent() // repository root
        .appending(path: "test/formats/rtf/fixtures")

    /// Fixtures that read to a golden `<name>.json`.
    static let readable = [
        "textedit-marks", "textedit-lists", "textedit-table", "textedit-layout",
        "textutil-html", "web-copy", "word-style", "tm-image-rtf",
    ]

    static func url(_ name: String) -> URL {
        directory.appending(path: name)
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: url(name))
    }

    /// Golden files are rewritten only when `INKKIT_RTF_UPDATE_GOLDEN=1` is set.
    static var updatingGolden: Bool {
        ProcessInfo.processInfo.environment["INKKIT_RTF_UPDATE_GOLDEN"] == "1"
    }
}

/// The pretty, sorted JSON used for golden files, with a final newline.
func goldenJSON(_ document: Doc) throws -> Data {
    var data = try document.jsonData(prettyPrinted: true)
    data.append(0x0A)
    return data
}

/// Writes the document as RTF, reads it back and expects the canonical document, compared both
/// as values and as JSON bytes (Swift string equality ignores Unicode normalization).
@discardableResult
func expectRoundTrip(_ document: Doc, sourceLocation: SourceLocation = #_sourceLocation) throws -> Data {
    let canonical = try document.canonicalized()
    let rtf = try RTFConverter.rtfData(from: document)
    let back = try RTFConverter.document(fromRTF: rtf)
    #expect(back == canonical, sourceLocation: sourceLocation)
    #expect(try back.jsonData() == canonical.jsonData(), sourceLocation: sourceLocation)
    return rtf
}

func rtfText(_ data: Data) -> String {
    String(decoding: data, as: UTF8.self)
}

/// Reads RTF source given as a string.
func read(_ rtf: String) throws(RTFConversionError) -> Doc {
    try RTFConverter.document(fromRTF: Data(rtf.utf8))
}

func expectError(
    _ expected: RTFConversionError, sourceLocation: SourceLocation = #_sourceLocation,
    _ body: () throws(RTFConversionError) -> Void
) {
    do {
        try body()
        Issue.record("expected \(expected), but nothing was thrown", sourceLocation: sourceLocation)
    } catch {
        #expect(error == expected, sourceLocation: sourceLocation)
    }
}

// MARK: Builders

func t(_ text: String, _ marks: Doc.Mark...) -> Doc.Inline {
    .text(text, marks: marks)
}

func p(_ content: Doc.Inline..., align: Doc.Alignment? = nil) -> Doc.Block {
    .paragraph(Doc.Paragraph(content, align: align))
}

func item(_ content: Doc.Inline..., nested: [Doc.List] = []) -> Doc.ListItem {
    Doc.ListItem(Doc.Paragraph(content), nested: nested)
}

func bullets(_ items: Doc.ListItem...) -> Doc.List {
    Doc.List(ordered: false, items: items)
}

func numbers(start: Int? = nil, _ items: Doc.ListItem...) -> Doc.List {
    Doc.List(ordered: true, start: start, items: items)
}

func table(_ rows: [Doc.Inline]...) -> Doc.Block {
    .table(Doc.Table(rows: rows.map { row in row.map { inline in Doc.Cell([inline]) } }))
}

func doc(_ blocks: Doc.Block...) -> Doc {
    Doc(blocks: blocks)
}

/// A named document, so parameterized tests show which case failed.
struct NamedDocument: Sendable, CustomTestStringConvertible {
    var name: String
    var document: Doc
    var testDescription: String { name }

    init(_ name: String, _ document: Doc) {
        self.name = name
        self.document = document
    }
}
