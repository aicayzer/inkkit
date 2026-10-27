import AppKit
import WebKit

// A visible native host: no accessibility permission or screen capture is used.
@MainActor
final class SelectionHost: NSObject, NSApplicationDelegate {
    let arguments = CommandLine.arguments
    var window: NSWindow!
    var other: NSWindow!
    var web: WKWebView!
    let field = NSTextField(string: "Native focus target")
    var records: [[String: Any]] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            do { try await run(); NSApp.terminate(nil) }
            catch { fputs("Selection verifier failed: \(error)\n", stderr); exit(1) }
        }
    }
    func pause() async { try? await Task.sleep(for: .milliseconds(250)) }
    func js(_ expression: String) async throws -> Any {
        try await web.evaluateJavaScript(expression) ?? NSNull()
    }
    func fail(_ message: String) -> NSError { NSError(domain: "SelectionHost", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func focusState() -> [String: Any] {
        let responder = window.firstResponder
        let webFocus = (responder as? NSView).map { $0 === web || $0.isDescendant(of: web) } ?? false
        return ["keyWindow": window.isKeyWindow, "otherKeyWindow": other.isKeyWindow,
                "webFirstResponder": webFocus, "nativeFieldFirstResponder": field.currentEditor() === responder,
                "firstResponderClass": responder.map { String(describing: type(of: $0)) } ?? "nil"]
    }
    // WebKit collapses a textarea's selection when a native field takes focus, with or without Inkkit,
    // so that one case records the state without requiring a selection.
    func capture(_ name: String, expected: String, selectedIndex: Int, requireSelection: Bool = true) async throws {
        await pause()
        let focus = focusState()
        guard (focus["keyWindow"] as? Bool == (expected != "other")),
              (focus["webFirstResponder"] as? Bool == (expected != "field")),
              (expected != "field" || focus["nativeFieldFirstResponder"] as? Bool == true),
              (expected != "other" || other.isKeyWindow) else { throw fail("Wrong native focus: \(name): \(focus)") }
        let active = window.isKeyWindow && focus["webFirstResponder"] as? Bool == true
        _ = try await web.callAsyncJavaScript("selectionFixture.setHostActive(active)", arguments: ["active": active], in: nil, contentWorld: .page)
        guard let state = try await web.callAsyncJavaScript("return await selectionFixture.capture()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any] else { throw fail("Missing state") }
        let debugData = try JSONSerialization.data(withJSONObject: ["native": focus, "fixture": state], options: [.prettyPrinted, .sortedKeys])
        try debugData.write(to: URL(fileURLWithPath: arguments[2]).appendingPathComponent(name + ".json"))
        guard let selections = state["selections"] as? [[String: Any]],
              let selected = selections[selectedIndex]["selected"] as? String, !requireSelection || !selected.isEmpty,
              let geometry = selections[selectedIndex]["geometry"] as? [String: Any],
              let width = geometry["width"] as? Double, width > 0,
              let height = geometry["height"] as? Double, height > 0 else { throw fail("Empty selection or geometry: \(name)") }
        let image = try await web.takeSnapshot(configuration: nil)
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]), !png.isEmpty else { throw fail("Missing snapshot: \(name)") }
        let path = URL(fileURLWithPath: arguments[2]).appendingPathComponent(name + ".png")
        try png.write(to: path)
        var red = 0, blue = 0
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: 2) {
            for x in stride(from: 0, to: bitmap.pixelsWide, by: 2) {
                guard let colour = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                if colour.redComponent > 0.8 && colour.greenComponent < 0.2 && colour.blueComponent < 0.2 { red += 1 }
                if colour.blueComponent > 0.8 && colour.greenComponent < 0.2 && colour.redComponent < 0.2 { blue += 1 }
            }
        }
        records.append(["name": name, "native": focus, "fixture": state, "snapshot": path.path,
                        "pixels": ["red": red, "blue": blue]])
        let progress = try JSONSerialization.data(withJSONObject: records, options: [.prettyPrinted, .sortedKeys])
        try progress.write(to: URL(fileURLWithPath: arguments[2]).appendingPathComponent("native.json"))
    }
    func run() async throws {
        defer { other?.close(); window?.close() }
        guard arguments.count >= 3 else { throw fail("Usage: SelectionHost BUNDLE OUTPUT") }
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 1000, height: 650))
        window = NSWindow(contentRect: content.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "InkKit selection evidence"
        window.contentView = content
        web = WKWebView(frame: NSRect(x: 0, y: 60, width: 1000, height: 590))
        field.frame = NSRect(x: 20, y: 16, width: 400, height: 28)
        content.addSubview(web); content.addSubview(field)
        other = NSWindow(contentRect: NSRect(x: 1050, y: 80, width: 240, height: 150), styleMask: [.titled], backing: .buffered, defer: false)
        other.title = "Inactive editor window target"
        window.setFrameOrigin(NSPoint(x: 20, y: 80))
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        let url = URL(fileURLWithPath: arguments[1])
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        var ready = false
        for _ in 0..<80 {
            await pause()
            if (try? await js("window.selectionReady === true")) as? Bool == true { ready = true; break }
        }
        guard ready else { throw fail("Fixture did not become ready") }
        for mode in (arguments.count > 3 ? arguments[3].split(separator: ",").map(String.init) : ["formatted", "source", "txt"]) {
            window.makeKeyAndOrderFront(nil); window.makeFirstResponder(web)
            _ = try await web.callAsyncJavaScript("await selectionFixture.prepare(mode)", arguments: ["mode": mode], in: nil, contentWorld: .page)
            // Use a native responder action as the source/TXT selection control.
            // A retained range and snapshot pixels are separate evidence.
            if mode != "formatted" {
                guard let responder = window.firstResponder,
                      responder.tryToPerform(#selector(NSText.selectAll(_:)), with: nil) else { throw fail("Native selectAll refused") }
            }
            try await capture(mode + "-active", expected: "web", selectedIndex: 0)
            window.makeFirstResponder(field)
            try await capture(mode + "-native-field", expected: "field", selectedIndex: 0, requireSelection: mode == "formatted")
            // Isolate window deactivation from the native text-field blur above.
            window.makeFirstResponder(web)
            _ = try await js("selectionFixture.select(0)")
            await pause()
            other.makeKeyAndOrderFront(nil)
            try await capture(mode + "-other-window", expected: "other", selectedIndex: 0)
            window.makeKeyAndOrderFront(nil); window.makeFirstResponder(web)
            _ = try await js("selectionFixture.select(0)")
            try await capture(mode + "-returned", expected: "web", selectedIndex: 0)
            // A host blurs the editor when its window resigns: the engine drops its own selection, the state keeps it.
            _ = try await js("selectionFixture.blur(0)")
            try await capture(mode + "-host-blur", expected: "web", selectedIndex: 0)
            window.makeFirstResponder(web)
            _ = try await js("selectionFixture.select(1)")
            try await capture(mode + "-second-editor", expected: "web", selectedIndex: 1)
        }
        let data = try JSONSerialization.data(withJSONObject: records, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: arguments[2]).appendingPathComponent("native.json"))

    }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = SelectionHost()
app.delegate = delegate
app.run()
