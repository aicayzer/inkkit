import Foundation
#if canImport(AppKit)
import AppKit
typealias PlatformFont = NSFont
#elseif canImport(UIKit)
import UIKit
typealias PlatformFont = UIFont
#endif

extension NSAttributedString.Key {
    /// `NSSuperScript`. AppKit names it `.superscript`; UIKit reads and writes the same key
    /// but has no constant for it.
    static let inkkitSuperscript = NSAttributedString.Key("NSSuperScript")
}

struct FontTraits: Hashable {
    var bold = false
    var italic = false
    var monospace = false
}

extension PlatformFont {
    var inkkitTraits: FontTraits {
        #if canImport(AppKit)
        let traits = fontDescriptor.symbolicTraits
        return FontTraits(
            bold: traits.contains(.bold),
            italic: traits.contains(.italic),
            monospace: traits.contains(.monoSpace) || isFixedPitch)
        #else
        let traits = fontDescriptor.symbolicTraits
        return FontTraits(
            bold: traits.contains(.traitBold),
            italic: traits.contains(.traitItalic),
            monospace: traits.contains(.traitMonoSpace))
        #endif
    }
}

/// The fonts of TextEdit's default document: Helvetica 12, with code in Menlo 12.
struct WriterFonts {
    private var cache: [FontTraits: PlatformFont] = [:]
    private let size: CGFloat = 12

    mutating func font(bold: Bool, italic: Bool, code: Bool) -> PlatformFont {
        let key = FontTraits(bold: bold, italic: italic, monospace: code)
        if let font = cache[key] { return font }
        let font = make(key)
        cache[key] = font
        return font
    }

    private func make(_ key: FontTraits) -> PlatformFont {
        #if canImport(AppKit)
        var font = key.monospace
            ? NSFont(name: "Menlo-Regular", size: size) ?? .monospacedSystemFont(ofSize: size, weight: .regular)
            : NSFont(name: "Helvetica", size: size) ?? .systemFont(ofSize: size)
        let manager = NSFontManager.shared
        if key.bold { font = manager.convert(font, toHaveTrait: .boldFontMask) }
        if key.italic { font = manager.convert(font, toHaveTrait: .italicFontMask) }
        return font
        #else
        let base = key.monospace
            ? UIFont(name: "Menlo-Regular", size: size) ?? .monospacedSystemFont(ofSize: size, weight: .regular)
            : UIFont(name: "Helvetica", size: size) ?? .systemFont(ofSize: size)
        var traits: UIFontDescriptor.SymbolicTraits = []
        if key.bold { traits.insert(.traitBold) }
        if key.italic { traits.insert(.traitItalic) }
        guard !traits.isEmpty, let descriptor = base.fontDescriptor.withSymbolicTraits(traits) else { return base }
        return UIFont(descriptor: descriptor, size: size)
        #endif
    }
}
