import Foundation
import Testing
@testable import InkKitRTF
#if canImport(AppKit)
import AppKit
#endif

@Suite("Fixtures")
struct FixtureTests {
    #if canImport(AppKit)
    @Test("A fixture reads to its golden JSON", arguments: Fixtures.readable)
    func readsToGolden(name: String) throws {
        let document = try RTFConverter.document(fromRTF: Fixtures.data("\(name).rtf"))
        let actual = try goldenJSON(document)
        let goldenURL = Fixtures.url("\(name).json")
        if Fixtures.updatingGolden {
            try actual.write(to: goldenURL)
        }
        let golden = try Data(contentsOf: goldenURL)
        #expect(String(decoding: actual, as: UTF8.self) == String(decoding: golden, as: UTF8.self))
    }

    @Test("A golden document loads from JSON and survives RTF", arguments: Fixtures.readable)
    func goldenRoundTrips(name: String) throws {
        let golden = try Doc(json: Fixtures.data("\(name).json"))
        #expect(try goldenJSON(golden) == Fixtures.data("\(name).json"))
        try expectRoundTrip(golden)
    }

    @Test("TextEdit marks map to every mark and drop styling")
    func texteditMarks() throws {
        let document = try RTFConverter.document(fromRTF: Fixtures.data("textedit-marks.rtf"))
        guard case .paragraph(let paragraph) = document.blocks.first else {
            Issue.record("expected a paragraph")
            return
        }
        let marked = paragraph.content.compactMap { inline -> String? in
            guard case .text(let text, let marks) = inline, !marks.isEmpty else { return nil }
            return "\(text)=\(marks.map(\.typeName).joined(separator: "+"))"
        }
        #expect(marked == [
            "bold=bold", "italic=italic", "bold italic=bold+italic", "underline=underline",
            "double underline=underline", "thick underline=underline", "strike=strikethrough",
            "2=superscript", "2=subscript", "baselineUp=superscript", "baselineDown=subscript",
            "mono=code", "link=link",
        ])
    }

    @Test("Lists group by list object and nest by depth")
    func texteditLists() throws {
        let document = try RTFConverter.document(fromRTF: Fixtures.data("textedit-lists.rtf"))
        #expect(document == doc(
            p(t("Bullets")),
            .list(bullets(item(t("one")), item(t("two"), nested: [bullets(item(t("nested a")), item(t("nested b")))]), item(t("three")))),
            p(t("Numbered")),
            .list(numbers(item(t("first")), item(t("second"), nested: [numbers(item(t("sub a")), item(t("sub b")))]), item(t("third")))),
            p(t("After."))
        ))
    }

    @Test("A table reads as rows of cells")
    func texteditTable() throws {
        let document = try RTFConverter.document(fromRTF: Fixtures.data("textedit-table.rtf"))
        #expect(document == doc(
            p(t("Before table")),
            table([t("H1", .bold), t("H2", .bold)], [t("a"), t("b")], [t("c"), t("d")]),
            p(t("After table"))
        ))
    }

    @Test("The image fixture written as RTF holds no image, because the RTF writer already dropped it")
    func imageWrittenAsRTF() throws {
        let document = try RTFConverter.document(fromRTF: Fixtures.data("tm-image-rtf.rtf"))
        #expect(document == doc(p(t("Before image  after image"))))
    }
    #endif

    @Test("An RTFD package is not RTF")
    func rtfdPackage() {
        expectError(.notRTF) { () throws(RTFConversionError) in
            _ = try RTFConverter.document(contentsOf: Fixtures.url("tm-image.rtfd"))
        }
    }

    @Test("The text of an RTFD package refers to its image, so it is refused")
    func rtfdText() throws {
        let data = try Fixtures.data("tm-image-rtfd-text.rtf")
        expectError(.unsupportedContent([.attachment])) { () throws(RTFConversionError) in
            _ = try RTFConverter.document(fromRTF: data)
        }
        let inPackage = try Fixtures.data("tm-image.rtfd/TXT.rtf")
        #expect(inPackage == data)
    }

    #if canImport(AppKit)
    @Test("Flattened RTFD data is not RTF")
    func flattenedRTFD() throws {
        let attachment = NSTextAttachment(
            fileWrapper: FileWrapper(regularFileWithContents: try Fixtures.data("tm-image.rtfd/blue.png")))
        attachment.fileWrapper?.preferredFilename = "blue.png"
        let text = NSMutableAttributedString(string: "Before ")
        text.append(NSAttributedString(attachment: attachment))
        let flattened = try #require(text.rtfd(from: NSRange(location: 0, length: text.length), documentAttributes: [:]))
        expectError(.notRTF) { () throws(RTFConversionError) in
            _ = try RTFConverter.document(fromRTF: flattened)
        }
    }
    #endif

    @Test("Fixtures hold no personal details")
    func noPersonalDetails() throws {
        let names = try FileManager.default.subpathsOfDirectory(atPath: Fixtures.directory.path)
            .filter { $0.hasSuffix(".rtf") }
        #expect(names.count >= 10)
        for name in names {
            let text = String(decoding: try Fixtures.data(name), as: UTF8.self)
            for word in ["\\info", "\\author", "\\operator", "\\company", "/Users/", "\\*\\userprops"] {
                #expect(!text.contains(word), "\(name) contains \(word)")
            }
        }
    }
}
