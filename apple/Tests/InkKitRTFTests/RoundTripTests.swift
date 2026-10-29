import Foundation
import Testing
#if canImport(AppKit)
import AppKit
#endif
@testable import InkKitRTF

/// Documents that must come back unchanged from `document → RTF → document`.
enum RoundTripCases {
    static let simpleMarks: [Doc.Mark] = [
        .bold, .italic, .underline, .strikethrough, .superscript, .subscript, .code, .link(href: "https://example.com/a?b=1"),
    ]

    /// Every combination of the marks that can share a run: each subset of bold, italic,
    /// underline, strikethrough, code and link, with no baseline mark, superscript or subscript.
    static var everyCombination: Doc {
        let free: [Doc.Mark] = [.bold, .italic, .underline, .strikethrough, .code, .link(href: "https://example.com/")]
        var blocks: [Doc.Block] = []
        for mask in 0..<(1 << free.count) {
            let base = free.indices.filter { mask & (1 << $0) != 0 }.map { free[$0] }
            for baseline in [[], [Doc.Mark.superscript], [Doc.Mark.subscript]] {
                let marks = base + baseline
                blocks.append(.paragraph(Doc.Paragraph([
                    .text("plain ", marks: []), .text("marked \(mask)", marks: marks), .text(" plain", marks: []),
                ])))
            }
        }
        return Doc(blocks: blocks)
    }

    static func deepList(levels: Int, ordered: (Int) -> Bool) -> Doc.List {
        var list = Doc.List(ordered: ordered(levels), items: [item(t("level \(levels) item"))])
        for level in stride(from: levels - 1, through: 1, by: -1) {
            list = Doc.List(ordered: ordered(level), items: [item(t("level \(level) item"), nested: [list]), item(t("level \(level) after"))])
        }
        return list
    }

    static let all: [NamedDocument] = [
        NamedDocument("empty document", doc()),
        NamedDocument("each mark alone", Doc(blocks: simpleMarks.map { p(t("before "), .text("marked", marks: [$0]), t(" after")) })),
        NamedDocument("every mark combination", everyCombination),
        NamedDocument("adjacent runs with different marks", doc(p(t("b", .bold), t("i", .italic), t("u", .underline), t("s", .strikethrough), t("x", .superscript), t("y", .subscript), t("c", .code)))),
        NamedDocument("links with marks", doc(
            p(t("see "), t("bold link", .bold, .link(href: "https://example.com/1")), t(" and "), t("code link", .code, .link(href: "mailto:a@example.com"))),
            p(t("one", .link(href: "https://a.example/")), t("two", .link(href: "https://b.example/"))),
            p(t("half bold", .link(href: "https://c.example/")), t(" half plain", .bold, .link(href: "https://c.example/"))),
            p(t("underlined", .underline), t("underlined link", .underline, .link(href: "https://d.example/")), t("underlined", .underline)),
            p(t("fragment", .link(href: "#section")), t(" relative", .link(href: "docs/page.html")))
        )),
        NamedDocument("nested lists three deep", doc(
            .list(bullets(
                item(t("one"), nested: [numbers(item(t("one.a"), nested: [bullets(item(t("one.a.i")), item(t("one.a.ii")))]), item(t("one.b")))]),
                item(t("two"))
            ))
        )),
        NamedDocument("lists nested to the maximum depth", doc(.list(deepList(levels: Doc.maximumListDepth, ordered: { $0 % 2 == 0 })))),
        NamedDocument("ordered lists with a start", doc(
            .list(numbers(start: 5, item(t("five")), item(t("six")))),
            p(t("between")),
            .list(numbers(start: 1000, item(t("thousand")), item(t("next"), nested: [numbers(start: 3, item(t("three")))])))
        )),
        NamedDocument("adjacent lists stay separate", doc(
            .list(bullets(item(t("first list")))), .list(bullets(item(t("second list")))), .list(numbers(item(t("third list"))))
        )),
        NamedDocument("list items with marks, breaks, alignment and empty text", doc(
            .list(Doc.List(ordered: false, items: [
                Doc.ListItem(Doc.Paragraph([t("bold", .bold), .lineBreak, t("second line")])),
                Doc.ListItem(Doc.Paragraph([t("centred")], align: .center)),
                Doc.ListItem(Doc.Paragraph()),
                Doc.ListItem(Doc.Paragraph([t("\t•\tliteral marker text")])),
                Doc.ListItem(Doc.Paragraph([t("\tleading tab")])),
            ]))
        )),
        NamedDocument("tables", doc(
            table([t("only")]),
            p(t("between")),
            .table(Doc.Table(rows: [
                [Doc.Cell([t("Head", .bold)]), Doc.Cell([t("with "), t("link", .link(href: "https://example.com/"))]), Doc.Cell()],
                [Doc.Cell([t("line one"), .lineBreak, t("line two")]), Doc.Cell(), Doc.Cell([t("x"), t("2", .superscript)])],
                [Doc.Cell([t("tab\tinside")]), Doc.Cell([t("Ünïcødé 😀")]), Doc.Cell([.lineBreak])],
            ])),
            table([t("adjacent")], [t("table")]),
            table([t("second"), t("table")])
        )),
        NamedDocument("table first and last", doc(table([t("a"), t("b")]), p(t("middle")), table([t("c")]))),
        NamedDocument("alignment", doc(p(t("left")), p(t("centre"), align: .center), p(t("right"), align: .right), p(t("justified"), align: .justify), p(align: .center))),
        NamedDocument("breaks", doc(
            p(t("one"), .lineBreak, t("two")), p(.lineBreak, t("leading")), p(t("trailing"), .lineBreak),
            p(.lineBreak), p(.lineBreak, .lineBreak), p(t("a", .bold), .lineBreak, t("b", .bold))
        )),
        NamedDocument("empty paragraphs", doc(p(), p(t("text")), p(), p(), p(t("more")), p())),
        NamedDocument("one empty paragraph", doc(p())),
        NamedDocument("Unicode", doc(
            p(t("Café – naïve – “quotes” – ‘single’ – €100 – ½ – ß – Æ – Œ")),
            p(t("日本語のテキスト、中文、한국어, Ελληνικά, Русский, ქართული, हिन्दी")),
            p(t("emoji 😀 👩‍👩‍👧‍👦 🏳️‍🌈 👍🏽 🇬🇧 ❤️")),
            p(t("decomposed e\u{301} a\u{30A} n\u{303} \u{1100}\u{1161}, precomposed é å ñ, and combining marks with no precomposed form Z\u{335}\u{321}\u{35C}a\u{337} q\u{301}")),
            p(t("astral 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 𝟙𝟚𝟛 and private use \u{E000}")),
            p(t("zero width\u{200B}space, joiner\u{200D}, no-break\u{00A0}space, BOM\u{FEFF}inside")),
            p(t("controls \u{01}\u{1F}\u{7F} survive"))
        )),
        NamedDocument("right-to-left text", doc(
            p(t("שלום עולם")), p(t("مرحبا بالعالم", .bold)), p(t("mixed English עברית English")),
            p(t("עברית", .italic), t(" and "), t("العربية", .underline)), p(t("ימין"), align: .right)
        )),
        NamedDocument("tabs", doc(p(t("\tleading")), p(t("a\tb\t\tc")), p(t("trailing\t")), p(t("\t")))),
        NamedDocument("RTF syntax in text", doc(p(t(#"{\rtf1 braces} and \par backslashes \\ and \'e9"#)), p(t("}{")))),
        NamedDocument("spaces", doc(p(t(" leading and trailing ")), p(t("   ")), p(t("double  space")))),
        NamedDocument("very long text", doc(
            p(t(String(repeating: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ", count: 4000))),
            p(t(String(repeating: "x", count: 100_000), .bold))
        )),
        NamedDocument("many paragraphs", Doc(blocks: (0..<5000).map { index in
            p(t("Paragraph \(index) "), t("bold", .bold), t(" end"))
        })),
    ]
}

@Suite("Round trips")
struct RoundTripTests {
    @Test("Hand-built documents survive JSON")
    func jsonRoundTrip() throws {
        for named in RoundTripCases.all {
            let canonical = try named.document.canonicalized()
            #expect(try Doc(json: named.document.jsonData()) == canonical, "\(named.name)")
            #expect(try Doc(json: named.document.jsonData(prettyPrinted: true)) == canonical, "\(named.name)")
        }
    }

    #if canImport(AppKit)
    @Test("A document survives RTF unchanged", arguments: RoundTripCases.all)
    func roundTrip(_ named: NamedDocument) throws {
        try expectRoundTrip(named.document)
    }

    @Test("Written RTF shows list markers in TextEdit and names TextEdit's fonts")
    func writtenRTFText() throws {
        let rtf = rtfText(try RTFConverter.rtfData(from: doc(
            .list(bullets(item(t("bullet"), nested: [numbers(start: 3, item(t("third")))]))),
            p(t("bold", .bold), t(" code", .code), t(" link", .link(href: "https://example.com/")), t(" u", .underline), t(" s", .strikethrough), t("up", .superscript), t("down", .subscript), t("centred"), align: .center),
            table([t("cell")])
        )))
        #expect(rtf.hasPrefix(#"{\rtf1"#))
        #expect(rtf.contains("Helvetica;"))
        #expect(rtf.contains("Helvetica-Bold;"))
        #expect(rtf.contains("Menlo-Regular;"))
        #expect(rtf.contains(#"{\*\levelmarker \{disc\}}"#))
        #expect(rtf.contains(#"{\*\levelmarker \{decimal\}.}"#))
        // \listtext is what TextEdit and Word draw as the marker.
        #expect(rtf.contains("{\\listtext\t\\uc0\\u8226 \t}bullet"))
        #expect(rtf.contains("{\\listtext\t3.\t}third"))
        #expect(rtf.contains(#"\levelstartat3"#))
        #expect(rtf.contains(#"HYPERLINK "https://example.com/""#))
        #expect(rtf.contains(#"\ul "#) && rtf.contains(#"\strike"#))
        #expect(rtf.contains(#"\super"#) && rtf.contains(#"\sub"#))
        #expect(rtf.contains(#"\qc"#))
        #expect(rtf.contains(#"\trowd"#) && rtf.contains(#"\cell"#))
        #expect(!rtf.contains("NeXTGraphic"))
        #expect(!rtf.contains("\\info") && !rtf.contains("\\author"))
    }

    @Test("A literal marker at the start of a list item is kept")
    func literalMarker() throws {
        let rtf = rtfText(try expectRoundTrip(doc(.list(bullets(item(t("\t•\tliteral")))))))
        #expect(rtf.contains("{\\listtext\t\\uc0\\u8226 \t}\t\\'95\tliteral"))
    }

    @Test("Decomposed text is NFC in canonical form, so RTF returns identical JSON")
    func decomposedCharacters() throws {
        let decomposed = "e\u{301} a\u{30A} n\u{303} \u{1100}\u{1161} Z\u{35C}\u{321}"
        let document = doc(p(t(decomposed)), .table(Doc.Table(rows: [[Doc.Cell([t("e"), t("\u{301}")])]])))
        let expected = doc(p(t("\u{E9} \u{E5} \u{F1} \u{AC00} Z\u{321}\u{35C}")), table([t("\u{E9}")]))
        let canonical = try document.canonicalized()
        #expect(try canonical.jsonData() == expected.jsonData())
        let back = try RTFConverter.document(fromRTF: RTFConverter.rtfData(from: document))
        #expect(try back.jsonData() == canonical.jsonData())
        let json = Data(#"{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"e\u0301"}]}]}"#.utf8)
        #expect(String(decoding: try Doc(json: json).jsonData(), as: UTF8.self)
            == #"{"blocks":[{"content":[{"text":"\#u{E9}","type":"text"}],"type":"paragraph"}],"version":1}"#)
    }

    @Test("A link run never reads or writes an underline, but underline around it stays")
    func linkUnderline() throws {
        let read = try RTFConverter.document(fromRTF: Data(#"{\rtf1\ansi \ul before {\field{\*\fldinst{HYPERLINK "https://example.com/"}}{\fldrslt link}} after\ulnone\par}"#.utf8))
        #expect(read == doc(p(t("before ", .underline), t("link", .link(href: "https://example.com/")), t(" after", .underline))))
        let rtf = rtfText(try RTFConverter.rtfData(from: doc(p(t("link", .underline, .link(href: "https://example.com/"))))))
        #expect(rtf.contains(#"HYPERLINK "https://example.com/""#))
        #expect(!rtf.contains(#"\ul"#))
        #expect(try doc(p(t("a", .underline, .link(href: "https://x/")))).canonicalized() == doc(p(t("a", .link(href: "https://x/")))))
    }

    @Test("Any allowed link address comes back as given, whether or not it is a URL", arguments: [
        "http://[", "https://example.com/a b/ü", "https://例え.jp/パス", "http://[::1]:80/", "https://x/%zz",
        "relative/path", "#fragment", "mailto:a@cyzr.me", "javascript:alert(1)", #"a"b\c{d}"#,
    ])
    func linkAddresses(_ href: String) throws {
        try expectRoundTrip(doc(p(t("before "), t("x", .link(href: href)), t(" after"))))
    }

    @Test("Two link addresses that RTF would write the same are refused, not merged")
    func linkAddressCollision() {
        #expect(throws: RTFConversionError.self) {
            try RTFConverter.rtfData(from: doc(p(t("a", .link(href: "http://[")), t(" b", .link(href: "http://%5B")))))
        }
    }

    @Test("Another RTF reader skips the address record and sees the link as the system writes it")
    func linkRecordIsIgnorable() throws {
        let data = try RTFConverter.rtfData(from: doc(p(t("before "), t("x", .link(href: "http://[")), t(" after"))))
        #expect(rtfText(data).contains(#"{\*\inkkitlinks"#))
        let read = try NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil)
        #expect(read.string == "before x after\n")
        #expect((read.attribute(.link, at: 7, effectiveRange: nil) as? URL)?.absoluteString == "http://%5B")
    }

    @Test("The largest list start comes back, and the writer keeps it")
    func largestListStart() throws {
        try expectRoundTrip(doc(.list(numbers(start: Doc.maximumListStart, item(t("last")), item(t("next"))))))
    }

    #endif

    #if !canImport(AppKit)
    @Test("A table cannot be written on iOS")
    func tableOnIOS() {
        expectError(.unsupportedContent([.table])) { () throws(RTFConversionError) in
            _ = try RTFConverter.rtfData(from: doc(table([t("cell")])))
        }
    }
    #endif
}
