import Foundation
import Testing
@testable import InkKitRTF

@Suite("Validation")
struct ValidationTests {
    private func expectInvalid(_ json: String, containing fragment: String, sourceLocation: SourceLocation = #_sourceLocation) {
        do {
            _ = try Doc(json: Data(json.utf8))
            Issue.record("expected the JSON to be refused", sourceLocation: sourceLocation)
        } catch {
            guard case .invalidDocument(let reason) = error else {
                Issue.record("expected invalidDocument, got \(error)", sourceLocation: sourceLocation)
                return
            }
            #expect(reason.contains(fragment), "reason: \(reason)", sourceLocation: sourceLocation)
        }
    }

    private func paragraphJSON(_ inline: String) -> String {
        #"{"version":1,"blocks":[{"type":"paragraph","content":[\#(inline)]}]}"#
    }

    @Test("Malformed JSON is refused with a reason")
    func malformedJSON() {
        expectInvalid("", containing: "not valid JSON")
        expectInvalid("[1,2", containing: "not valid JSON")
        expectInvalid("[]", containing: "document")
        expectInvalid(#"{"blocks":[]}"#, containing: "version")
        expectInvalid(#"{"version":1}"#, containing: "blocks")
        expectInvalid(#"{"version":"1","blocks":[]}"#, containing: "version")
        expectInvalid(#"{"version":1,"blocks":[{"type":"heading","content":[]}]}"#, containing: #"blocks[0].type: unknown block type "heading""#)
        expectInvalid(#"{"version":1,"blocks":[{"type":"paragraph"}]}"#, containing: "blocks[0].content")
        expectInvalid(paragraphJSON(#"{"type":"image"}"#), containing: #"unknown inline type "image""#)
        expectInvalid(paragraphJSON(#"{"type":"text","text":"a","marks":[{"type":"highlight"}]}"#), containing: #"unknown mark type "highlight""#)
        expectInvalid(paragraphJSON(#"{"type":"text","text":"a","marks":[{"type":"link"}]}"#), containing: "href")
        expectInvalid(#"{"version":1,"blocks":[{"type":"paragraph","align":"left","content":[]}]}"#, containing: "align")
    }

    @Test("Only version 1 is accepted")
    func version() {
        expectInvalid(#"{"version":2,"blocks":[]}"#, containing: "version 2")
        expectInvalid(#"{"version":0,"blocks":[]}"#, containing: "version 0")
    }

    @Test("Text runs cannot be empty or hold separators", arguments: [
        "\\n", "\\r", "\\u000b", "\\u000c", "\\u0085", "\\u2028", "\\u2029", "\\ufffc", "\\u0000",
    ])
    func forbiddenText(_ escape: String) {
        expectInvalid(paragraphJSON(#"{"type":"text","text":"a\#(escape)b"}"#), containing: "blocks[0].content[0].text: text cannot hold U+")
    }

    @Test("An empty text run is refused")
    func emptyText() {
        expectInvalid(paragraphJSON(#"{"type":"text","text":""}"#), containing: "blocks[0].content[0].text: a text run cannot be empty")
    }

    @Test("Illegal mark combinations are refused")
    func marks() {
        expectInvalid(paragraphJSON(#"{"type":"text","text":"a","marks":[{"type":"bold"},{"type":"bold"}]}"#), containing: "bold mark appears more than once")
        expectInvalid(paragraphJSON(#"{"type":"text","text":"a","marks":[{"type":"link","href":"https://a/"},{"type":"link","href":"https://b/"}]}"#), containing: "link mark appears more than once")
        expectInvalid(paragraphJSON(#"{"type":"text","text":"a","marks":[{"type":"subscript"},{"type":"superscript"}]}"#), containing: "both superscript and subscript")
        expectInvalid(paragraphJSON(#"{"type":"text","text":"a","marks":[{"type":"link","href":""}]}"#), containing: "a link needs an address")
    }

    @Test("Lists must be well formed")
    func lists() {
        func list(_ body: String) -> String { #"{"version":1,"blocks":[{"type":"list",\#(body)}]}"# }
        let item = #"{"blocks":[{"type":"paragraph","content":[]}]}"#
        expectInvalid(list(#""ordered":false,"start":3,"items":[\#(item)]"#), containing: "only an ordered list has a start")
        expectInvalid(list(#""ordered":true,"start":-1,"items":[\#(item)]"#), containing: "the start must be at least 1")
        expectInvalid(list(#""ordered":true,"start":0,"items":[\#(item)]"#), containing: "the start must be at least 1")
        expectInvalid(list(#""ordered":true,"items":[]"#), containing: "blocks[0].items: a list needs at least one item")
        expectInvalid(list(#""ordered":true,"items":[{"blocks":[]}]"#), containing: "must start with a paragraph")
        expectInvalid(list(#""ordered":true,"items":[{"blocks":[{"type":"list","ordered":false,"items":[\#(item)]}]}]"#), containing: "must start with a paragraph")
        expectInvalid(list(#""ordered":true,"items":[{"blocks":[{"type":"paragraph","content":[]},{"type":"paragraph","content":[]}]}]"#), containing: "blocks[0].items[0].blocks[1]: after its paragraph, a list item can hold only lists")
        expectInvalid(list(#""ordered":true,"items":[{"blocks":[{"type":"paragraph","content":[]},{"type":"table","rows":[[{"content":[]}]]}]}]"#), containing: "can hold only lists")
    }

    @Test("Lists cannot nest deeper than RTF allows")
    func listDepth() throws {
        let allowed = Doc(blocks: [.list(RoundTripCases.deepList(levels: Doc.maximumListDepth, ordered: { _ in false }))])
        try allowed.validate()
        let tooDeep = Doc(blocks: [.list(RoundTripCases.deepList(levels: Doc.maximumListDepth + 1, ordered: { _ in false }))])
        expectError(.invalidDocument("blocks[0].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1]: lists nest deeper than 9 levels")) { () throws(RTFConversionError) in
            try tooDeep.validate()
        }
        expectError(.invalidDocument("blocks[0].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1].items[0].blocks[1]: lists nest deeper than 9 levels")) { () throws(RTFConversionError) in
            _ = try RTFConverter.rtfData(from: tooDeep)
        }
    }

    @Test("Tables must be rectangular and not empty")
    func tables() {
        func table(_ rows: String) -> String { #"{"version":1,"blocks":[{"type":"table","rows":\#(rows)}]}"# }
        expectInvalid(table("[]"), containing: "a table needs at least one row")
        expectInvalid(table("[[]]"), containing: "a table row needs at least one cell")
        expectInvalid(table(#"[[{"content":[]},{"content":[]}],[{"content":[]}]]"#), containing: "blocks[0].rows[1]: the row has 1 cells, but the first row has 2")
        expectInvalid(table(#"[[{"content":[{"type":"text","text":"a\nb"}]}]]"#), containing: "blocks[0].rows[0][0].content[0].text")
    }

    @Test("Writing refuses an invalid document")
    func writingValidates() {
        expectError(.invalidDocument("blocks[0].content[0].text: a text run cannot be empty")) { () throws(RTFConversionError) in
            _ = try RTFConverter.rtfData(from: doc(p(t(""))))
        }
        expectError(.invalidDocument("version 3 is not supported; the version must be 1")) { () throws(RTFConversionError) in
            _ = try RTFConverter.rtfData(from: Doc(blocks: [], version: 3))
        }
        expectError(.invalidDocument("blocks[0].content[0].text: a text run cannot be empty")) { () throws(RTFConversionError) in
            _ = try doc(p(t(""))).jsonData()
        }
    }

    @Test("Canonical form sorts marks, merges runs and omits defaults")
    func canonicalForm() throws {
        let messy = doc(
            p(t("a", .link(href: "https://x/"), .code, .bold), t("b", .bold, .code, .link(href: "https://x/")), t("c")),
            .list(numbers(start: 1, item(t("one"))))
        )
        let canonical = try messy.canonicalized()
        #expect(canonical == doc(
            p(t("ab", .bold, .code, .link(href: "https://x/")), t("c")),
            .list(numbers(item(t("one"))))
        ))
        let json = String(decoding: try messy.jsonData(), as: UTF8.self)
        #expect(json == #"{"blocks":[{"content":[{"marks":[{"type":"bold"},{"type":"code"},{"href":"https://x/","type":"link"}],"text":"ab","type":"text"},{"text":"c","type":"text"}],"type":"paragraph"},{"items":[{"blocks":[{"content":[{"text":"one","type":"text"}],"type":"paragraph"}]}],"ordered":true,"type":"list"}],"version":1}"#)
        #expect(try Doc(json: Data(json.utf8)) == canonical)
    }

    @Test("Every mark sorts in canonical order")
    func markOrder() {
        let shuffled: [Doc.Mark] = [.link(href: "https://b/"), .code, .subscript, .superscript, .strikethrough, .underline, .italic, .bold]
        #expect(shuffled.sorted() == [.bold, .italic, .underline, .strikethrough, .superscript, .subscript, .code, .link(href: "https://b/")])
    }

    @Test("JSON from the editor with empty marks and start 1 loads in canonical form")
    func editorJSON() throws {
        let json = #"{"version":1,"blocks":[{"type":"list","ordered":true,"start":1,"items":[{"blocks":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[]},{"type":"break"},{"type":"text","text":"y"},{"type":"text","text":"z"}]}]}]},{"type":"table","rows":[[{"content":[]}]]},{"type":"paragraph","align":"justify","content":[]}]}"#
        let document = try Doc(json: Data(json.utf8))
        #expect(document == doc(
            .list(numbers(item(t("x"), .lineBreak, t("yz")))),
            .table(Doc.Table(rows: [[Doc.Cell()]])),
            p(align: .justify)
        ))
        #expect(String(decoding: try document.jsonData(), as: UTF8.self) == #"{"blocks":[{"items":[{"blocks":[{"content":[{"text":"x","type":"text"},{"type":"break"},{"text":"yz","type":"text"}],"type":"paragraph"}]}],"ordered":true,"type":"list"},{"rows":[[{"content":[]}]],"type":"table"},{"align":"justify","content":[],"type":"paragraph"}],"version":1}"#)
    }
}
