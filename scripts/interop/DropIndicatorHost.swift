import AppKit
import WebKit

// Reads only the drag session's pasteboard; never the general clipboard.
final class IndicatorReceiver: NSView {
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

  // The outside destination refuses the drop; the final drop targets the editor.
  override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { false }
}

final class DropIndicatorHost: NSObject, NSApplicationDelegate, WKNavigationDelegate,
  WKScriptMessageHandler
{
  var window: NSWindow!
  var web: WKWebView!
  var receiver: IndicatorReceiver!
  var before: [String: Any] = [:]
  var events: [[String: Any]] = []
  var samples: [[String: Any]] = []
  var pendingSamples = 0
  var completionRequested = false
  var fidelity: [String: Any] = [:]
  var finished = false
  let arguments = CommandLine.arguments

  func applicationDidFinishLaunching(_ notification: Notification) {
    let configuration = WKWebViewConfiguration()
    configuration.userContentController.add(self, name: "dragTrace")
    web = WKWebView(
      frame: NSRect(x: 0, y: 0, width: 600, height: 600), configuration: configuration)
    web.navigationDelegate = self
    let root = NSView(frame: NSRect(x: 0, y: 0, width: 1000, height: 600))
    receiver = IndicatorReceiver(frame: NSRect(x: 600, y: 0, width: 400, height: 600))
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
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
        self.sample("ended", completion: { self.verifyEdits() })
      }
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
      let source = "First target paragraph.\n\nSecond target paragraph.\n"
      let literal = String(
        data: try! JSONSerialization.data(withJSONObject: [source]), encoding: .utf8)!
      self.evaluate(
        """
        (() => {
          window.interop.load(\(literal)[0]);
          const source = document.createElement('div');
          source.id = 'native-drop-source'; source.draggable = true; source.textContent = 'Native insertion';
          source.style.cssText = 'position:fixed;right:0;top:0;width:120px;height:28px;background:white;z-index:9999';
          source.addEventListener('dragstart', event => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', 'Native insertion'); event.dataTransfer.setData('text/html', '<p>Native insertion</p>'); });
          document.body.append(source);
          document.querySelector('.ProseMirror').focus();
          for (const type of ['dragstart', 'dragover', 'drop', 'dragend', 'keydown']) {
            document.addEventListener(type, event => queueMicrotask(() => window.webkit.messageHandlers.dragTrace.postMessage({type, trusted: event.isTrusted, x: event.clientX ?? null, y: event.clientY ?? null, key: event.key ?? null, meta: event.metaKey, shift: event.shiftKey, prevented: event.defaultPrevented, dropEffect: event.dataTransfer?.dropEffect ?? null, target: event.target?.outerHTML?.slice(0, 160) ?? null})), false);
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
        const image = document.querySelector('#native-drop-source');
        if (!image) throw Error('Native drag source is unavailable');
        const rect = image.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) throw Error('Rendered image is empty');
        const paragraphs = document.querySelectorAll('.ProseMirror > p'); const target = paragraphs[paragraphs.length - 1].getBoundingClientRect(); return {targetX: target.x + 1, targetY: target.bottom - 1, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, snapshot: window.interop.get().snapshot};
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
      guard let targetX = image["targetX"] as? Double, let targetY = image["targetY"] as? Double
      else {
        self.finish(error: "Missing drop target geometry")
        return
      }
      func nativePoint(_ x: Double, _ y: Double) -> NSPoint {
        self.web.convert(
          NSPoint(x: x, y: self.web.isFlipped ? y : self.web.bounds.height - y), to: nil)
      }
      let start = nativePoint(x, y)
      let target = nativePoint(targetX, targetY)
      let outside = self.receiver.convert(NSPoint(x: 100, y: 300), to: nil)
      self.post(.leftMouseDown, at: start, number: 0, pressure: 1)
      let legs: [(NSPoint, NSPoint, Double)] = [
        (start, target, 0), (target, outside, 1.8), (outside, target, 3.6),
      ]
      for (from, to, delay) in legs {
        for index in 1...20 {
          DispatchQueue.main.asyncAfter(deadline: .now() + delay + Double(index) * 0.06) {
            let fraction = Double(index) / 20
            self.post(
              .leftMouseDragged,
              at: NSPoint(
                x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction),
              number: index, pressure: 1)
          }
        }
      }
      for (phase, delay) in [("inside", 1.5), ("outside", 3.3), ("reentry", 5.1)] {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.sample(phase) }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 5.5) {
        self.post(.leftMouseUp, at: target, number: 80, pressure: 0)
      }
    }
  }

  // Samples the rendered WKWebView during the native session, without screen recording.
  func sample(_ phase: String, completion: @escaping () -> Void = {}) {
    pendingSamples += 1
    web.takeSnapshot(with: nil) { image, error in
      guard let image, let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
      else {
        self.finish(error: error?.localizedDescription ?? "Could not snapshot native web view")
        return
      }
      do {
        let output = URL(fileURLWithPath: self.arguments[2]).deletingPathExtension()
          .appendingPathExtension("\(phase).png")
        try png.write(to: output)
        self.evaluateSample(phase) {
          self.pendingSamples -= 1
          completion()
          if self.completionRequested && self.pendingSamples == 0 { self.finish() }
        }
      } catch { self.finish(error: error.localizedDescription) }
    }
  }

  func evaluateSample(_ phase: String, completion: @escaping () -> Void) {
    evaluate(
      """
      (() => {
        const root = document.querySelector('.ProseMirror');
        const rect = root.getBoundingClientRect();
        const cursors = [...document.querySelectorAll('.milkdown-drop-indicator')].map(node => {
          const box = node.getBoundingClientRect(), style = getComputedStyle(node);
          return {x: box.x, y: box.y, width: box.width, height: box.height, color: style.backgroundColor, opacity: style.opacity, display: style.display, inRoot: root.closest('.inkkit-root').contains(node)};
        });
        return {phase: "\(phase)", cursors, root: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, snapshot: window.interop.get().snapshot};
      })()
      """
    ) { value in
      if var value = value as? [String: Any] {
        value["keyWindow"] = self.window.isKeyWindow
        self.samples.append(value)
      }
      completion()
    }
  }

  func post(_ type: NSEvent.EventType, at point: NSPoint, number: Int, pressure: Float) {
    let screenPoint = window.convertPoint(toScreen: point)
    let eventType: CGEventType =
      type == .leftMouseDown
      ? .leftMouseDown : type == .leftMouseUp ? .leftMouseUp : .leftMouseDragged
    guard
      let event = CGEvent(
        mouseEventSource: nil, mouseType: eventType,
        mouseCursorPosition: CGPoint(
          x: screenPoint.x, y: NSScreen.screens[0].frame.maxY - screenPoint.y), mouseButton: .left)
    else {
      finish(error: "Could not create native mouse event")
      return
    }
    event.post(tap: .cghidEventTap)
  }

  func verifyEdits() {
    evaluate("window.interop.get().snapshot") { inserted in
      self.fidelity["inserted"] = inserted
      self.web.window?.makeFirstResponder(self.web)
      self.evaluate("(() => { document.querySelector('.ProseMirror').focus(); return true; })()") {
        _ in self.keyUndo(redo: false)
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
        self.evaluate("window.interop.get().snapshot") { undone in
          self.fidelity["undone"] = undone
          self.keyUndo(redo: true)
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            self.evaluate("window.interop.get().snapshot") { redone in
              self.fidelity["redone"] = redone
              self.evaluate(
                "(() => { const saved = window.interop.get().snapshot; window.interop.load(saved.text); return window.interop.get().snapshot; })()"
              ) { reopened in
                self.fidelity["reopened"] = reopened
                self.finish()
              }
            }
          }
        }
      }
    }
  }

  func keyUndo(redo: Bool) {
    let flags: NSEvent.ModifierFlags = redo ? [.command, .shift] : [.command]
    for type in [NSEvent.EventType.keyDown, .keyUp] {
      guard
        let event = NSEvent.keyEvent(
          with: type, location: .zero,
          modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: window.windowNumber, context: nil,
          characters: redo ? "Z" : "z", charactersIgnoringModifiers: "z",
          isARepeat: false, keyCode: 6)
      else {
        finish(error: "Could not create native undo event")
        return
      }
      NSApp.postEvent(event, atStart: false)
    }
  }

  func finish(error: String? = nil) {
    guard !finished else { return }
    if error == nil && pendingSamples > 0 {
      completionRequested = true
      return
    }
    finished = true
    web.evaluateJavaScript("window.interop.get()") { after, snapshotError in
      var result: [String: Any] = [
        "before": self.before, "after": after ?? NSNull(),
        "events": self.events, "destination": self.receiver.captures,
        "samples": self.samples, "attemptedDrop": true, "fidelity": self.fidelity,
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

guard CommandLine.arguments.count == 3
else {
  fputs("Usage: DropIndicatorHost BUNDLE RESULT\n", stderr)
  exit(1)
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = DropIndicatorHost()
app.delegate = delegate
app.run()
