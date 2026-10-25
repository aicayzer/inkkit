import AppKit
import WebKit

// Reads only the drag session's pasteboard; never the general clipboard.
final class DragReceiver: NSView {
  var captures: [[String: Any]] = []

  override init(frame: NSRect) {
    super.init(frame: frame)
    registerForDraggedTypes([.html, .string])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unsupported") }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    let board = sender.draggingPasteboard
    captures.append([
      "phase": "draggingEntered",
      "types": board.types?.map { $0.rawValue } ?? [],
      "html": board.string(forType: .html) ?? "",
      "text": board.string(forType: .string) ?? "",
    ])
    return .copy
  }

  override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }

  // The test observes destination-visible data without accepting a drop or move.
  override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { false }
}

final class DragHost: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler
{
  var window: NSWindow!
  var web: WKWebView!
  var receiver: DragReceiver!
  var before: [String: Any] = [:]
  var events: [[String: Any]] = []
  var finished = false
  let arguments = CommandLine.arguments

  func applicationDidFinishLaunching(_ notification: Notification) {
    let configuration = WKWebViewConfiguration()
    configuration.userContentController.add(self, name: "dragTrace")
    web = WKWebView(
      frame: NSRect(x: 0, y: 0, width: 600, height: 600), configuration: configuration)
    web.navigationDelegate = self
    let root = NSView(frame: NSRect(x: 0, y: 0, width: 1000, height: 600))
    receiver = DragReceiver(frame: NSRect(x: 600, y: 0, width: 400, height: 600))
    root.addSubview(web)
    root.addSubview(receiver)
    window = NSWindow(
      contentRect: root.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.contentView = root
    window.setFrameOrigin(NSPoint(x: 60, y: 60))
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    let url = URL(fileURLWithPath: arguments[1])
    web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      self.finish(error: "Native drag timed out")
    }
  }

  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard let event = message.body as? [String: Any] else { return }
    events.append(event)
    if event["type"] as? String == "dragend" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { self.finish() }
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { prepare(attempt: 0) }

  func evaluate(_ script: String, completion: @escaping (Any) -> Void) {
    web.evaluateJavaScript(script) { value, error in
      if let error {
        self.finish(error: error.localizedDescription)
      } else if let value {
        completion(value)
      } else {
        self.finish(error: "JavaScript returned no result")
      }
    }
  }

  func prepare(attempt: Int) {
    evaluate("Boolean(window.ready && window.interop)") { ready in
      guard ready as? Bool == true else {
        if attempt >= 50 {
          self.finish(error: "Consumer did not become ready")
          return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.prepare(attempt: attempt + 1) }
        return
      }
      let source =
        self.arguments[3] == "inline"
        ? "Before ![Drag label](private-authored-image.png) after.\n"
        : "![Drag label](private-authored-image.png)\n"
      let literal = String(
        data: try! JSONSerialization.data(withJSONObject: [source]), encoding: .utf8)!
      self.evaluate(
        """
        (() => {
          window.interop.load(\(literal)[0]);
          for (const type of ['dragstart', 'dragend']) {
            document.addEventListener(type, event => window.webkit.messageHandlers.dragTrace.postMessage({type, trusted: event.isTrusted}), true);
          }
          return true;
        })()
        """
      ) { _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.locate() }
      }
    }
  }

  func locate() {
    evaluate(
      """
      (() => {
        const image = document.querySelector('.ProseMirror img');
        if (!image || !image.complete || !image.naturalWidth) throw Error('Rendered image is unavailable');
        const rect = image.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) throw Error('Rendered image is empty');
        return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, displayURL: image.src, snapshot: window.interop.get().snapshot};
      })()
      """
    ) { value in
      guard let image = value as? [String: Any], let x = image["x"] as? Double,
        let y = image["y"] as? Double
      else {
        self.finish(error: "Missing image geometry")
        return
      }
      self.before = image
      let point = NSPoint(x: x, y: self.web.isFlipped ? y : self.web.bounds.height - y)
      let start = self.web.convert(point, to: nil)
      let end = self.receiver.convert(NSPoint(x: 150, y: 300), to: nil)
      self.post(.leftMouseDown, at: start, number: 0, pressure: 1)
      for index in 1...35 {
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.06) {
          let fraction = Double(index) / 35
          self.post(
            .leftMouseDragged,
            at: NSPoint(
              x: start.x + (end.x - start.x) * fraction,
              y: start.y + (end.y - start.y) * fraction), number: index, pressure: 1)
        }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.3) {
        self.post(.leftMouseUp, at: end, number: 36, pressure: 0)
      }
    }
  }

  func post(_ type: NSEvent.EventType, at point: NSPoint, number: Int, pressure: Float) {
    guard
      let event = NSEvent.mouseEvent(
        with: type, location: point, modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
        context: nil, eventNumber: number, clickCount: 1, pressure: pressure)
    else {
      finish(error: "Could not create native mouse event")
      return
    }
    NSApp.postEvent(event, atStart: false)
  }

  func finish(error: String? = nil) {
    guard !finished else { return }
    finished = true
    web.evaluateJavaScript("window.interop.get()") { after, snapshotError in
      var result: [String: Any] = [
        "before": self.before, "after": after ?? NSNull(),
        "events": self.events, "destination": self.receiver.captures,
        "acceptedDrop": false,
      ]
      if let failure = error ?? snapshotError?.localizedDescription { result["error"] = failure }
      do {
        let data = try JSONSerialization.data(
          withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: self.arguments[2]), options: .atomic)
      } catch {
        fputs("\(error)\n", stderr)
        exit(1)
      }
      NSApp.terminate(nil)
    }
  }
}

guard CommandLine.arguments.count == 4, ["block", "inline"].contains(CommandLine.arguments[3])
else {
  fputs("Usage: DragHost BUNDLE RESULT block|inline\n", stderr)
  exit(1)
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = DragHost()
app.delegate = delegate
app.run()
