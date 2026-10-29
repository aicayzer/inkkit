import Foundation

/// Converts RTF to and from ``RichTextDocument`` with the system's RTF reader and writer.
///
/// Reading keeps structure (paragraphs, alignment, lists, tables, line breaks) and the inline
/// marks of ``RichTextDocument/Mark``. It drops fonts, sizes, colors, highlighting, kerning,
/// indents, spacing and tab stops, which Inkkit's own style replaces. It never drops content:
/// anything the model cannot hold makes the conversion throw ``RTFConversionError``.
///
/// A link run never reads as underlined, because Word and HTML underline every hyperlink as
/// link styling, and links are written without an underline attribute.
///
/// The functions do not need the main thread.
public enum RTFConverter {
    /// Reads an RTF document.
    ///
    /// Old-style `\pntext` list markers (from RTF writers before Word 97) read as plain
    /// paragraphs, because the system reader discards them; their text is kept.
    ///
    /// - Throws: ``RTFConversionError/notRTF`` when the data is not RTF,
    ///   ``RTFConversionError/unreadable`` when it is damaged, and
    ///   ``RTFConversionError/unsupportedContent(_:)`` when it holds content the model cannot represent.
    public static func document(fromRTF data: Data) throws(RTFConversionError) -> RichTextDocument {
        try RTFReader.document(from: data)
    }

    /// Reads an RTF file. A directory, such as an RTFD package, is ``RTFConversionError/notRTF``.
    ///
    /// - Throws: As ``document(fromRTF:)``, and ``RTFConversionError/unreadable`` when the file
    ///   cannot be read.
    public static func document(contentsOf url: URL) throws(RTFConversionError) -> RichTextDocument {
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
            throw .notRTF
        }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw .unreadable
        }
        return try document(fromRTF: data)
    }

    /// Writes a document as RTF (never RTFD), in the style of TextEdit's default document.
    ///
    /// - Throws: ``RTFConversionError/invalidDocument(_:)`` when the document is not valid,
    ///   ``RTFConversionError/unsupportedContent(_:)`` with `.table` on iOS when it holds a table,
    ///   and ``RTFConversionError/writeFailed`` when the system cannot write it.
    public static func rtfData(from document: RichTextDocument) throws(RTFConversionError) -> Data {
        try RTFWriter.rtfData(from: document)
    }
}
