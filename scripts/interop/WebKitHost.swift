import AppKit
import Foundation
import PDFKit
import WebKit

@MainActor
final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var web: WKWebView!
    var window: NSWindow!
    let args = CommandLine.arguments

    func applicationDidFinishLaunching(_ note: Notification) {
        guard args.count == 5 else {
            fputs("Usage: webkit-host BUNDLE export|partial|paste|scenario|print INPUT OUTPUT\n", stderr)
            exit(1)
        }
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 720, height: 640))
        web.navigationDelegate = self
        window = NSWindow(
            contentRect: NSRect(x: 20, y: 20, width: 720, height: 640),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "InkKit disposable clipboard fixture"
        window.contentView = web
        let url = URL(fileURLWithPath: args[1])
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
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
                    let pdfURL = URL(fileURLWithPath: args[4]).appendingPathExtension("pdf")
                    let info = NSPrintInfo()
                    info.dictionary()[NSPrintInfo.AttributeKey.jobDisposition] = NSPrintInfo.JobDisposition.save
                    info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = pdfURL
                    let operation = web.printOperation(with: info)
                    operation.showsPrintPanel = false
                    operation.showsProgressPanel = false
                    guard operation.run(), let pdf = PDFDocument(url: pdfURL) else {
                        throw NSError(domain: "Interop", code: 2, userInfo: [NSLocalizedDescriptionKey: "WKWebView print did not produce a PDF"])
                    }
                    var output = scenario as? [String: Any] ?? [:]
                    output["print"] = ["pdf": pdfURL.path, "pages": pdf.pageCount, "text": pdf.string ?? ""]
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
