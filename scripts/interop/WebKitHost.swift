import AppKit
import Foundation
import PDFKit
import WebKit

@MainActor
final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var window: NSWindow!
    let args = CommandLine.arguments
    var printContinuation: CheckedContinuation<Bool, Never>?

    func applicationDidFinishLaunching(_ note: Notification) {
        guard args.count == 5 else {
            fputs("Usage: webkit-host BUNDLE export|partial|paste|scenario|print INPUT OUTPUT\n", stderr)
            exit(1)
        }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "diagnostic")
        configuration.userContentController.addUserScript(WKUserScript(source: """
            addEventListener('error', event => window.webkit.messageHandlers.diagnostic.postMessage(String(event.message)));
            addEventListener('unhandledrejection', event => window.webkit.messageHandlers.diagnostic.postMessage(String(event.reason)));
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 720, height: 640), configuration: configuration)
        web.navigationDelegate = self
        window = NSWindow(
            contentRect: NSRect(x: 20, y: 20, width: 720, height: 640),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "InkKit disposable clipboard fixture"
        window.contentView = web
        window.orderFront(nil)
        let url = URL(fileURLWithPath: args[1])
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        fputs("WKWebView: \(message.body)\n", stderr)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("WKWebView navigation: \(error)\n", stderr)
        exit(1)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { await execute() }
    }

    func js(_ body: String, _ arguments: [String: Any] = [:]) async throws -> Any {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Any, Error>) in
            web.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page) {
                result in continuation.resume(with: result)
            }
        }
    }

    @objc nonisolated func printDidRun(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            let continuation = self.printContinuation
            self.printContinuation = nil
            continuation?.resume(returning: success)
        }
    }

    func execute() async {
        do {
            _ = try await js("""
                for(let n=0;n<200&&!window.ready;n++)
                    await new Promise(r=>setTimeout(r,50));
                if(!window.ready)throw new Error('InkKit mount timed out');
                return true
                """)
            let input = try JSONSerialization.jsonObject(
                with: Data(contentsOf: URL(fileURLWithPath: args[3]))) as! [String: Any]
            let result: Any
            if args[2] == "scenario" || args[2] == "print" {
                let scenario = try await js("return await window.interop.run(input)", ["input": input])
                if args[2] == "print" {
                    window.makeKeyAndOrderFront(nil)
                    web.layoutSubtreeIfNeeded()
                    _ = try await js("await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true")
                    let screenGeometry = try await js("return { viewportHeight: innerHeight, documentScrollHeight: document.documentElement.scrollHeight, editorScrollHeight: document.querySelector('.ProseMirror')?.scrollHeight ?? null, foldedCallouts: document.querySelectorAll('[data-inkkit-folded=\"true\"]').length, commentsVisible: document.querySelector('.ProseMirror')?.getAttribute('data-inkkit-comments-visible') ?? null }")
                    let pdfURL = URL(fileURLWithPath: args[4]).appendingPathExtension("pdf")
                    let info = NSPrintInfo()
                    // Fixed page geometry makes verification independent of printer defaults.
                    info.paperSize = NSSize(width: 595.28, height: 841.89)
                    info.topMargin = 36
                    info.bottomMargin = 36
                    info.leftMargin = 36
                    info.rightMargin = 36
                    info.horizontalPagination = .fit
                    info.verticalPagination = .automatic
                    info.dictionary()[NSPrintInfo.AttributeKey.jobDisposition] = NSPrintInfo.JobDisposition.save.rawValue
                    info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = pdfURL as NSURL
                    let operation = web.printOperation(with: info)
                    operation.showsPrintPanel = false
                    operation.showsProgressPanel = false
                    // WebKit pagination needs the main run loop free to receive page rectangles.
                    operation.canSpawnSeparateThread = true
                    let printed = await withCheckedContinuation { continuation in
                        printContinuation = continuation
                        operation.runModal(for: window, delegate: self, didRun: #selector(printDidRun(_:success:contextInfo:)), contextInfo: nil)
                    }
                    guard printed, let pdf = PDFDocument(url: pdfURL) else {
                        throw NSError(domain: "Interop", code: 2, userInfo: [NSLocalizedDescriptionKey: "WKWebView print did not produce a PDF"])
                    }
                    var output = scenario as? [String: Any] ?? [:]
                    output["print"] = [
                        "pdf": pdfURL.path, "pages": pdf.pageCount, "text": pdf.string ?? "",
                        "paperWidth": Double(info.paperSize.width), "paperHeight": Double(info.paperSize.height),
                        "printableWidth": Double(info.imageablePageBounds.width), "printableHeight": Double(info.imageablePageBounds.height),
                        "screenGeometry": screenGeometry,
                    ]
                    result = output
                } else {
                    result = scenario
                }
            } else {
                _ = try await js("return window.interop.load(source, format)", [
                    "source": input["source"] as? String ?? "",
                    "format": input["format"] as? String ?? "md",
                ])
                switch args[2] {
                case "export", "partial":
                    if args[2] == "partial" {
                        if let selection = input["selection"] as? [String: Any] {
                            _ = try await js("return await window.interop.select(selection)", ["selection": selection])
                        } else {
                            _ = try await js("""
                                window.interop.selectPartial();
                                await new Promise(r=>setTimeout(r,100));
                                return true
                                """)
                        }
                    }
                    result = try await js("return await window.interop.export(all)", ["all": args[2] == "export"])
                case "paste":
                    result = try await js("return await window.interop.paste(input)", ["input": input["clipboard"] as? [String: Any] ?? [:]])
                default:
                    throw NSError(domain: "Interop", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown mode: \(args[2])"])
                }
            }
            try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
                .write(to: URL(fileURLWithPath: args[4]))
            if let scenario = result as? [String: Any], scenario["passed"] as? Bool == false {
                fputs("Native scenario failed; see \(args[4])\n", stderr)
                exit(2)
            }
            NSApplication.shared.terminate(nil)
        } catch {
            fputs("\(error)\n", stderr)
            exit(1)
        }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let host = Host()
    app.delegate = host
    app.run()
}
