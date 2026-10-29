import Foundation
import Testing
@testable import InkKitRTF

@Suite("Plain text")
struct PlainTextTests {
    @Test("CRLF, CR and LF each end a line, and a final line ending adds no paragraph")
    func lines() {
        #expect(Doc(plainText: "") == doc())
        #expect(Doc(plainText: "one") == doc(p(t("one"))))
        #expect(Doc(plainText: "one\n") == doc(p(t("one"))))
        #expect(Doc(plainText: "\n") == doc(p()))
        #expect(Doc(plainText: "\n\n") == doc(p(), p()))
        #expect(Doc(plainText: "a\r\nb\rc\nd") == doc(p(t("a")), p(t("b")), p(t("c")), p(t("d"))))
        #expect(Doc(plainText: "a\r\n\r\nb\r\n") == doc(p(t("a")), p(), p(t("b"))))
        #expect(Doc(plainText: "a\r") == doc(p(t("a"))))
        #expect(Doc(plainText: "a\r\r") == doc(p(t("a")), p()))
        #expect(Doc(plainText: "a\n\r\nb") == doc(p(t("a")), p(), p(t("b"))))
    }

    @Test("Other separators and characters RTF cannot hold are kept visibly")
    func otherCharacters() throws {
        #expect(Doc(plainText: "a\u{2028}b\u{0B}c") == doc(p(t("a"), .lineBreak, t("b"), .lineBreak, t("c"))))
        #expect(Doc(plainText: "a\u{2029}b\u{85}c\u{0C}d") == doc(p(t("a")), p(t("b")), p(t("c")), p(t("d"))))
        #expect(Doc(plainText: "a\u{0}b\u{FFFC}c") == doc(p(t("a\u{FFFD}b\u{FFFD}c"))))
        #expect(Doc(plainText: "\ttabs\tand 😀 e\u{301}") == doc(p(t("\ttabs\tand 😀 e\u{301}"))))
        try Doc(plainText: "x\u{0}\r\n\u{2028}\u{FFFC}\u{85}").validate()
    }

    @Test("Plain text joins paragraphs, marks list items and separates cells with tabs")
    func plainTextOutput() {
        let document = doc(
            p(t("Title", .bold)),
            p(t("line"), .lineBreak, t("break")),
            p(),
            .list(bullets(item(t("bullet"), nested: [numbers(start: 4, item(t("four")), item(t("five"), nested: [bullets(item(t("deep")))]))]), item(t("second")))),
            .table(Doc.Table(rows: [[Doc.Cell([t("a")]), Doc.Cell([t("b")])], [Doc.Cell(), Doc.Cell([t("d")])]])),
            p(t("end"))
        )
        #expect(document.plainText == "Title\nline\nbreak\n\n• bullet\n  4. four\n  5. five\n    • deep\n• second\na\tb\n\td\nend")
        #expect(doc().plainText == "")
        #expect(doc(p()).plainText == "")
    }

    @Test("Plain paragraphs survive text and back")
    func plainRoundTrip() {
        let document = doc(p(t("one")), p(), p(t("\tthree")))
        #expect(Doc(plainText: document.plainText) == document)
        let text = "first\n\nthird\twith tab\nlast"
        #expect(Doc(plainText: text).plainText == text)
    }
}
