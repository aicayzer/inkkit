#if canImport(AppKit)
import AppKit
import Foundation
import Testing
@testable import InkKitRTF

/// The record of exact link addresses: it keeps addresses the system would change, and a record
/// that doesn't describe the file, damaged or hostile, is ignored without failing the read.
@Suite("Link address record")
struct LinkRecordTests {
    private let odd = "https://e.example/a b"
    private let encoded = "https://e.example/a%20b"

    private var twoLinks: Doc {
        doc(p(t("one", .link(href: odd)), t(" and "), t("two", .link(href: encoded)), t(" end")))
    }

    /// The document as the system alone reads it: every address as it percent-encodes it.
    private var systemAddresses: Doc {
        doc(p(t("one", .link(href: encoded)), t(" and "), t("two", .link(href: encoded)), t(" end")))
    }

    /// `data` with its record replaced by `record`, raw RTF text.
    private func replacingRecord(_ data: Data, with record: String) throws -> Data {
        let text = rtfText(data)
        let start = try #require(text.range(of: #"{\*\inkkitlinks"#))
        let end = try #require(text.range(of: "}}", range: start.upperBound..<text.endIndex))
        return Data((text[..<start.lowerBound] + record + text[end.upperBound...]).utf8)
    }

    /// Reads `data`, which may be damaged; reading must never trap, and gives the document, its
    /// system addresses or a conversion error.
    private func read(_ data: Data) -> Doc? {
        try? RTFConverter.document(fromRTF: data)
    }

    @Test("Two addresses the system writes the same both come back exactly")
    func encodedTwins() throws {
        let back = try RTFConverter.document(fromRTF: RTFConverter.rtfData(from: twoLinks))
        #expect(back == twoLinks)
        let adjacent = doc(p(t("one", .link(href: odd)), t("two", .link(href: encoded))))
        // Side by side, the system reads one link, so the record doesn't match and is ignored.
        let side = try RTFConverter.document(fromRTF: RTFConverter.rtfData(from: adjacent))
        #expect(side == adjacent || side == doc(p(t("onetwo", .link(href: encoded)))))
    }

    @Test("A record that no longer describes the links is ignored")
    func staleRecord() throws {
        let data = try RTFConverter.rtfData(from: twoLinks)
        let cases = [
            // Reordered, as if the links moved in another app. Two addresses that the system writes
            // the same can't be told apart, so each entry is checked against its field.
            #"{\*\inkkitlinks\uc0 {\inkkithref https://e.example/a%20b}{\inkkithref http://[}}"#,
            #"{\*\inkkitlinks\uc0 {\inkkithref http://[}{\inkkithref https://e.example/a b}}"#,
            // Pointing a link at another address.
            #"{\*\inkkitlinks\uc0 {\inkkithref https://evil.example/}{\inkkithref https://e.example/a%20b}}"#,
            // Missing an entry, or with one too many.
            #"{\*\inkkitlinks\uc0 {\inkkithref https://e.example/a b}}"#,
            #"{\*\inkkitlinks\uc0 {\inkkithref https://e.example/a b}{\inkkithref https://e.example/a%20b}{\inkkithref x}}"#,
            // An empty address, or one with a control character.
            #"{\*\inkkitlinks\uc0 {\inkkithref }{\inkkithref https://e.example/a%20b}}"#,
            #"{\*\inkkitlinks\uc0 {\inkkithref https://e.example/a\u1 b}{\inkkithref https://e.example/a%20b}}"#,
        ]
        for record in cases {
            let back = try RTFConverter.document(fromRTF: replacingRecord(data, with: record))
            #expect(back == systemAddresses, "\(record)")
        }
    }

    @Test("A damaged or hostile record is ignored without trapping", arguments: [
        #"{\*\inkkitlinks\uc0 {\inkkithref 香9999999999999999999 }{\inkkithref y}}"#,
        #"{\*\inkkitlinks\uc0 {\inkkithref \u-99999999999999999999999 x}}"#,
        #"{\*\inkkitlinks즙99999999999999999 {\inkkithref x}}"#,
        #"{\*\inkkitlinks\uc0 {\inkkithref {\*\inkkitlinks\uc0 {\inkkithref x}}}}"#,
        #"{\*\inkkitlinks\uc0 {\inkkithref x}{\inkkithref y}"#,
        #"{\*\inkkitlinks\uc0 {\inkkithref x\"#,
        #"{\*\inkkitlinks\uc0 {\inkkithref x\u"#,
        #"{\*\inkkitlinks\uc0 {\inkkithref x\u12"#,
        #"{\*\inkkitlinks"#,
        #"{\*\inkkitlinks\uc0 {\inkkithrefinkkithrefinkkithrefinkkithrefinkkithref x}}"#,
    ])
    func hostileRecord(_ record: String) throws {
        let data = try RTFConverter.rtfData(from: twoLinks)
        let back = read(try replacingRecord(data, with: record))
        #expect(back == nil || back == systemAddresses)
    }

    @Test("A record far larger than the document is ignored")
    func hugeRecord() throws {
        let data = try RTFConverter.rtfData(from: twoLinks)
        let entries = String(repeating: #"{\inkkithref https://e.example/a b}"#, count: 50_000)
        let back = try RTFConverter.document(fromRTF: replacingRecord(data, with: #"{\*\inkkitlinks\uc0 "# + entries + "}"))
        #expect(back == systemAddresses)
        let long = #"{\*\inkkitlinks\uc0 {\inkkithref "# + String(repeating: "a", count: 200_000) + "}}"
        #expect(read(try replacingRecord(data, with: long)) == systemAddresses)
    }

    @Test("Random changes to a record never trap and never re-point a link")
    func fuzz() throws {
        let data = try RTFConverter.rtfData(from: twoLinks)
        let text = rtfText(data)
        let start = try #require(text.range(of: #"{\*\inkkitlinks"#)).lowerBound.utf16Offset(in: text)
        let bytes = [UInt8](data)
        var state: UInt64 = 415
        func next(_ bound: Int) -> Int {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((state >> 33) % UInt64(bound))
        }
        let alphabet = Array(#"{}ģ456789-* abcxyz%"#.utf8) + [0x00, 0xFF, 0x80]
        for _ in 0..<3_000 {
            var mutated = bytes
            for _ in 0..<(1 + next(4)) {
                let at = start + next(bytes.count - start - 1)
                switch next(3) {
                case 0: mutated[min(at, mutated.count - 1)] = alphabet[next(alphabet.count)]
                case 1: mutated.remove(at: min(at, mutated.count - 1))
                default: mutated.insert(alphabet[next(alphabet.count)], at: min(at, mutated.count))
                }
            }
            let back = read(Data(mutated))
            // Damage may make the RTF unreadable, but a link keeps an address the system reads as
            // its field, never another one.
            for href in back.map(LinkAddresses.hrefs(of:)) ?? [] {
                #expect(LinkAddresses.readBack(href) == encoded, "\(href)")
            }
        }
    }
}
#endif
