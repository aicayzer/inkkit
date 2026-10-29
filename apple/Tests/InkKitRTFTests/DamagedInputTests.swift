import Foundation
import Testing
@testable import InkKitRTF
#if canImport(AppKit)
import AppKit
#endif

@Suite("Damaged and untidy input")
struct DamagedInputTests {
    @Test("Data that is not RTF is refused", arguments: [
        "", "   \n\t", "hello plain text", "# Markdown\n\n- item\n", "<html><body><b>bold</b></body></html>",
        "{\\rt", "rtf1 without a brace", "{ \\rtf1 space inside}", "\u{FEFF}{\\rtf1 BOM first}",
    ])
    func notRTF(_ text: String) {
        expectError(.notRTF) { () throws(RTFConversionError) in _ = try read(text) }
    }

    @Test("UTF-16 bytes are not RTF")
    func utf16() {
        let source = #"{\rtf1\ansi hello\par}"#
        for encoding: String.Encoding in [.utf16LittleEndian, .utf16BigEndian, .utf16] {
            let data = source.data(using: encoding)!
            expectError(.notRTF) { () throws(RTFConversionError) in _ = try RTFConverter.document(fromRTF: data) }
        }
    }

    @Test("Random binary data is refused without a crash")
    func randomBinary() throws {
        var generator = SeededGenerator(seed: 149)
        for length in [1, 7, 64, 4096, 100_000] {
            let data = Data((0..<length).map { _ in UInt8.random(in: 0...255, using: &generator) })
            expectError(.notRTF) { () throws(RTFConversionError) in _ = try RTFConverter.document(fromRTF: data) }
            var prefixed = Data(#"{\rtf1 "#.utf8)
            prefixed.append(data)
            #expect(throws: RTFConversionError.self) { try RTFConverter.document(fromRTF: prefixed) }
        }
    }

    @Test("RTF cut in half is unreadable", arguments: Fixtures.readable)
    func truncated(name: String) throws {
        let data = try Fixtures.data("\(name).rtf")
        let half = data.prefix(data.count / 2)
        expectError(.unreadable) { () throws(RTFConversionError) in _ = try RTFConverter.document(fromRTF: half) }
        let lastByteMissing = data.prefix(data.count - 2)
        expectError(.unreadable) { () throws(RTFConversionError) in _ = try RTFConverter.document(fromRTF: lastByteMissing) }
    }

    @Test("Unbalanced braces are unreadable, because the reader would drop the text after them")
    func unbalanced() {
        for source in [
            #"{\rtf1\ansi Hello}} world\par}"#,
            #"{\rtf1\ansi Hello} world"#,
            #"{\rtf1\ansi {Hello\par}"#,
            #"{\rtf1\ansi Hello\par"#,
        ] {
            expectError(.unreadable) { () throws(RTFConversionError) in _ = try read(source) }
        }
    }

    @Test("Escaped braces, leading whitespace and trailing padding are tidy enough")
    func untidyButReadable() throws {
        #expect(try read(#"{\rtf1\ansi Braces \{ and \} and \\ backslash\par}"#) == doc(p(t(#"Braces { and } and \ backslash"#))))
        #expect(try read("\r\n  \t{\\rtf1\\ansi Leading space\\par}") == doc(p(t("Leading space"))))
        #expect(try read("{\\rtf1\\ansi Trailing padding\\par}\r\n\u{0}\u{0}") == doc(p(t("Trailing padding"))))
        #expect(try read(#"{\rtf1\ansi Unknown {\*\futurething ignored} destination\par}"#) == doc(p(t("Unknown  destination"))))
        #expect(try read(#"{\rtf1\ansi no final paragraph mark}"#) == doc(p(t("no final paragraph mark"))))
        #expect(try read(#"{\rtf1}"#) == doc())
        #expect(try read("{\\rtf1\\ansi CR\\par\nLF\\par\r\nCRLF\\par}") == doc(p(t("CR")), p(t("LF")), p(t("CRLF"))))
    }

    @Test("Line breaks, page breaks and vertical tabs keep their text")
    func breaks() throws {
        #expect(try read(#"{\rtf1\ansi A\line B\page C\par}"#) == doc(p(t("A"), .lineBreak, t("B")), p(t("C"))))
        #expect(try read("{\\rtf1\\ansi A\u{0B}B\\par}") == doc(p(t("A"), .lineBreak, t("B"))))
    }

    @Test("Old-style \\pntext bullets read as plain paragraphs that keep their text")
    func pntextBullets() throws {
        let source = #"{\rtf1\ansi{\fonttbl\f0 Helvetica;\f3 Symbol;}\pard{\pntext\f3\'B7\tab}{\*\pn\pnlvlblt\pnf3\pnindent360{\pntxtb\'B7}}\fi-360\li720\f0 One\par{\pntext\f3\'B7\tab}Two\par\pard After\par}"#
        #expect(try read(source) == doc(p(t("One")), p(t("Two")), p(t("After"))))
    }

    @Test("A huge document reads and writes in reasonable time")
    func huge() throws {
        let paragraph: [Doc.Inline] = [
            t("A fairly ordinary sentence with "), t("bold", .bold), t(", "), t("italic", .italic),
            t(" and a "), t("link", .link(href: "https://example.com/")), t(" in it, repeated to make a large file."),
        ]
        let document = Doc(blocks: (0..<25_000).map { _ in .paragraph(Doc.Paragraph(paragraph)) })
        let clock = ContinuousClock()
        var rtf = Data()
        let writeTime = try clock.measure { rtf = try RTFConverter.rtfData(from: document) }
        #expect(rtf.count > 4_500_000, "the RTF is \(rtf.count) bytes")
        var back = Doc()
        let readTime = try clock.measure { back = try RTFConverter.document(fromRTF: rtf) }
        #expect(back == document)
        #expect(writeTime < .seconds(30), "writing took \(writeTime)")
        #expect(readTime < .seconds(30), "reading took \(readTime)")
        print("huge document: \(rtf.count) bytes, write \(writeTime), read \(readTime)")

        let plain = String(repeating: #"Plain text \b bold\b0  "#, count: 230_000)
        let plainSource = Data((#"{\rtf1\ansi "# + plain + #"\par}"#).utf8)
        #expect(plainSource.count > 5_000_000)
        let plainTime = try clock.measure { _ = try RTFConverter.document(fromRTF: plainSource) }
        #expect(plainTime < .seconds(30), "reading one huge paragraph took \(plainTime)")
        print("huge paragraph: \(plainSource.count) bytes, read \(plainTime)")
    }

    // MARK: Refusals

    @Test("Embedded pictures, objects, binary data, shapes, text boxes and U+FFFC are refused", arguments: [
        #"{\rtf1\ansi A {\pict\pngblip\picw1\pich1 89504e470d0a1a0a} B\par}"#,
        #"{\rtf1\ansi A {\*\shppict{\pict\pngblip 89504e47}}{\nonshppict{\pict\wmetafile8 0100}} B\par}"#,
        #"{\rtf1\ansi A {\object\objemb{\*\objdata 0102}{\result R}} B\par}"#,
        #"{\rtf1\ansi A {{\NeXTGraphic blue.png \width800 \height800}"# + "\u{AC}" + #"} B\par}"#,
        #"{\rtf1\ansi A {\shp{\*\shpinst{\shptxt Text box}}} B\par}"#,
        #"{\rtf1\ansi A \uc0\u-4 B\par}"#,
        #"{\rtf1\ansi A{\*\blob\bin4 }}{{}B\par}"#,
    ])
    func attachments(_ source: String) {
        expectError(.unsupportedContent([.attachment])) { () throws(RTFConversionError) in _ = try read(source) }
    }

    @Test("Headers, footers, footnotes and comments are refused, because the reader drops them")
    func droppedDestinations() {
        expectError(.unsupportedContent([.headerOrFooter])) { () throws(RTFConversionError) in
            _ = try read(#"{\rtf1\ansi {\header Head\par}{\footerr Foot\par}Body\par}"#)
        }
        expectError(.unsupportedContent([.footnote])) { () throws(RTFConversionError) in
            _ = try read(#"{\rtf1\ansi Body{\super\chftn}{\footnote\pard\plain{\super\chftn} Note}\par}"#)
        }
        expectError(.unsupportedContent([.comment])) { () throws(RTFConversionError) in
            _ = try read(#"{\rtf1\ansi Body{\*\atnid AC}{\*\annotation Comment} more\par}"#)
        }
        expectError(.unsupportedContent([.attachment, .footnote, .comment])) { () throws(RTFConversionError) in
            _ = try read(#"{\rtf1\ansi {\*\annotation C}{\footnote N}{\pict 00} Body\par}"#)
        }
    }

    @Test("Merged and nested table cells in RTF source are refused")
    func tableSource() {
        let merged = #"{\rtf1\ansi \trowd\clmgf\cellx2000\clmrg\cellx4000\pard\intbl Wide\cell\cell\row\pard After\par}"#
        expectError(.unsupportedContent([.mergedTableCells])) { () throws(RTFConversionError) in _ = try read(merged) }
        let vertical = #"{\rtf1\ansi \trowd\clvmgf\cellx2000\cellx4000\pard\intbl A\cell B\cell\row\trowd\clvmrg\cellx2000\cellx4000\pard\intbl\cell D\cell\row\pard After\par}"#
        expectError(.unsupportedContent([.mergedTableCells])) { () throws(RTFConversionError) in _ = try read(vertical) }
        let nested = #"{\rtf1\ansi \trowd\cellx4000\pard\intbl\itap2 Inner\nestcell{\*\nesttableprops\trowd\cellx2000\nestrow}\cell\row\pard After\par}"#
        expectError(.unsupportedContent([.nestedTable])) { () throws(RTFConversionError) in _ = try read(nested) }
    }

    #if canImport(AppKit)
    private func rtf(_ text: NSAttributedString) throws -> Data {
        try text.data(from: NSRange(location: 0, length: text.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
    }

    private func cellParagraph(_ text: String, blocks: [NSTextBlock], lists: [NSTextList] = []) -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.textBlocks = blocks
        style.textLists = lists
        return NSAttributedString(string: text + "\n", attributes: [.paragraphStyle: style])
    }

    @Test("A cell that spans columns, written by AppKit, is refused")
    func spanningCell() throws {
        let table = NSTextTable()
        table.numberOfColumns = 2
        let text = NSMutableAttributedString()
        text.append(cellParagraph("wide", blocks: [NSTextTableBlock(table: table, startingRow: 0, rowSpan: 1, startingColumn: 0, columnSpan: 2)]))
        text.append(cellParagraph("a", blocks: [NSTextTableBlock(table: table, startingRow: 1, rowSpan: 1, startingColumn: 0, columnSpan: 1)]))
        text.append(cellParagraph("b", blocks: [NSTextTableBlock(table: table, startingRow: 1, rowSpan: 1, startingColumn: 1, columnSpan: 1)]))
        let data = try rtf(text)
        expectError(.unsupportedContent([.mergedTableCells])) { () throws(RTFConversionError) in
            _ = try RTFConverter.document(fromRTF: data)
        }
    }

    @Test("A table inside a table, written by AppKit, is refused")
    func nestedTable() throws {
        let outer = NSTextTable()
        outer.numberOfColumns = 1
        let inner = NSTextTable()
        inner.numberOfColumns = 1
        let text = NSMutableAttributedString()
        text.append(cellParagraph("inner", blocks: [
            NSTextTableBlock(table: outer, startingRow: 0, rowSpan: 1, startingColumn: 0, columnSpan: 1),
            NSTextTableBlock(table: inner, startingRow: 0, rowSpan: 1, startingColumn: 0, columnSpan: 1),
        ]))
        let data = try rtf(text)
        expectError(.unsupportedContent([.nestedTable])) { () throws(RTFConversionError) in
            _ = try RTFConverter.document(fromRTF: data)
        }
    }

    @Test("A list inside a table cell, written by AppKit, is refused")
    func listInCell() throws {
        let table = NSTextTable()
        table.numberOfColumns = 1
        let text = NSMutableAttributedString()
        text.append(cellParagraph(
            "\t•\titem", blocks: [NSTextTableBlock(table: table, startingRow: 0, rowSpan: 1, startingColumn: 0, columnSpan: 1)],
            lists: [NSTextList(markerFormat: .disc, options: 0)]))
        let data = try rtf(text)
        expectError(.unsupportedContent([.listInTableCell])) { () throws(RTFConversionError) in
            _ = try RTFConverter.document(fromRTF: data)
        }
    }

    @Test("Several paragraphs in one Word table cell join with line breaks")
    func multiParagraphCell() throws {
        let source = #"{\rtf1\ansi \trowd\cellx2000\cellx4000\pard\intbl First\par Second\cell Other\cell\row\pard After\par}"#
        #expect(try read(source) == doc(
            .table(Doc.Table(rows: [[Doc.Cell([t("First"), .lineBreak, t("Second")]), Doc.Cell([t("Other")])]])),
            p(t("After"))
        ))
    }

    @Test("A nested list with no item before it gets an empty item")
    func nestedListWithoutParent() throws {
        let outer = NSTextList(markerFormat: .disc, options: 0)
        let inner = NSTextList(markerFormat: .disc, options: 0)
        let style = NSMutableParagraphStyle()
        style.textLists = [outer, inner]
        let text = NSAttributedString(string: "\t•\tdeep\n", attributes: [.paragraphStyle: style])
        #expect(try RTFConverter.document(fromRTF: rtf(text)) == doc(.list(bullets(Doc.ListItem(Doc.Paragraph(), nested: [bullets(item(t("deep")))])))))
    }
    #else
    @Test("A table is refused on iOS")
    func tableOnIOS() throws {
        let data = try Fixtures.data("textedit-table.rtf")
        expectError(.unsupportedContent([.table])) { () throws(RTFConversionError) in
            _ = try RTFConverter.document(fromRTF: data)
        }
    }
    #endif

    @Test("Errors have stable codes and readable descriptions")
    func errorDescriptions() {
        let errors: [RTFConversionError] = [
            .notRTF, .unreadable, .unsupportedContent([.attachment]), .unsupportedContent([.table, .footnote, .comment]),
            .invalidDocument("blocks[0]: problem"), .writeFailed,
        ]
        #expect(errors.map(\.code) == ["notRTF", "unreadable", "unsupportedContent", "unsupportedContent", "invalidDocument", "writeFailed"])
        #expect(RTFConversionError.unsupportedContent([.attachment]).description == "The RTF document contains images, files or embedded objects, which would be lost.")
        #expect(RTFConversionError.unsupportedContent([.table, .footnote, .comment]).description
            == "The RTF document contains tables, footnotes and comments, which would be lost.")
        for error in errors {
            #expect(error.localizedDescription == error.description)
            #expect(error.description.hasSuffix("."))
        }
        #expect(RTFConversionError.UnsupportedContent.allCases.map(\.rawValue) == [
            "attachment", "table", "mergedTableCells", "nestedTable", "listInTableCell", "headerOrFooter", "footnote", "comment",
            "equation", "largeTable",
        ])
    }
}

/// A small deterministic generator (SplitMix64), so random input is the same on every run.
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

@Suite("Content the system reader drops")
struct DroppedContentTests {
    @Test("A Word equation is refused, not dropped", arguments: [
        #"{\rtf1\ansi before {\mmath{\*\moMathPara{\*\moMath{\mr x}{\mr =1}}}} after\par}"#,
        #"{\rtf1\ansi before {\*\moMath{\mr x=1}} after\par}"#,
        #"{\rtf1\ansi before {\mmath{\*\moMath{\mr x=1}}{\mmathPict fallback}} after\par}"#,
    ])
    func equation(_ rtf: String) {
        #expect(throws: RTFConversionError.unsupportedContent([.equation])) {
            try RTFConverter.document(fromRTF: Data(rtf.utf8))
        }
    }

    @Test("Word's equation settings alone are not an equation")
    func equationSettings() throws {
        let document = try RTFConverter.document(fromRTF: Data(#"{\rtf1\ansi{\*\mmathPr\mdispDef1}text\par}"#.utf8))
        #expect(document == doc(p(t("text"))))
    }

    #if canImport(AppKit)
    @Test("C1 control characters other than U+0085 survive writing and reading")
    func c1Controls() throws {
        var text = "a"
        for value in 0x80...0x9F where value != 0x85 { text.unicodeScalars.append(UnicodeScalar(value)!) }
        try expectRoundTrip(doc(p(t(text))))
    }
    #endif
}

#if canImport(AppKit)
@Suite("Table size")
struct TableSizeTests {
    /// A first row of `columns` cells and then `rows` rows of one cell in the same table.
    private func wideTable(columns: Int, rows: Int) -> Data {
        var rtf = #"{\rtf1\ansi \trowd "#
        rtf += (1...columns).map { #"\cellx\#($0 * 10)"# }.joined() + " "
        rtf += String(repeating: #"\intbl a\cell "#, count: columns) + #"\row "#
        rtf += String(repeating: #"\trowd \cellx10 \intbl b\cell\row "#, count: rows)
        return Data((rtf + "}").utf8)
    }

    @Test("A short file that declares millions of cells is refused before they are built")
    func refusedTable() {
        #expect(throws: RTFConversionError.unsupportedContent([.largeTable])) {
            try RTFConverter.document(fromRTF: wideTable(columns: 2_000, rows: 2_000))
        }
        #expect(throws: RTFConversionError.unsupportedContent([.largeTable])) {
            try RTFConverter.document(fromRTF: wideTable(columns: 500, rows: 500))
        }
    }

    @Test("A table within the limits reads as before")
    func keptTable() throws {
        let document = try RTFConverter.document(fromRTF: wideTable(columns: 50, rows: 50))
        guard case .table(let table)? = document.blocks.first else {
            Issue.record("expected a table")
            return
        }
        #expect(table.rows.count == 51 && table.rows.allSatisfy { $0.count == 50 })
    }
}
#endif
