import AppKit
import CoreGraphics
import Foundation
import PDFKit
import WebKit

final class PDFImages {
    var records: [[String: Any]] = []

    func collect(_ resources: CGPDFDictionaryRef?, page: Int, depth: Int = 0) {
        guard let resources, depth < 16 else { return }
        var objects: CGPDFDictionaryRef?
        guard CGPDFDictionaryGetDictionary(resources, "XObject", &objects), let objects else { return }
        CGPDFDictionaryApplyBlock(objects, { key, object, _ in
            var stream: CGPDFStreamRef?
            guard CGPDFObjectGetValue(object, .stream, &stream), let stream,
                  let dictionary = CGPDFStreamGetDictionary(stream) else { return true }
            var subtype: UnsafePointer<CChar>?
            guard CGPDFDictionaryGetName(dictionary, "Subtype", &subtype), let subtype else { return true }
            if String(cString: subtype) == "Image" {
                var width: CGPDFInteger = 0
                var height: CGPDFInteger = 0
                var mask: CGPDFBoolean = 0
                _ = CGPDFDictionaryGetBoolean(dictionary, "ImageMask", &mask)
                guard mask == 0,
                      CGPDFDictionaryGetInteger(dictionary, "Width", &width),
                      CGPDFDictionaryGetInteger(dictionary, "Height", &height) else { return true }
                var format = CGPDFDataFormat.raw
                let data = CGPDFStreamCopyData(stream, &format)
                self.records.append(["page": page, "name": String(cString: key), "width": width, "height": height, "streamBytes": data.map(CFDataGetLength) ?? 0])
            } else if String(cString: subtype) == "Form" {
                var nested: CGPDFDictionaryRef?
                if CGPDFDictionaryGetDictionary(dictionary, "Resources", &nested) {
                    self.collect(nested, page: page, depth: depth + 1)
                }
            }
            return true
        }, nil)
    }
}

final class PDFImagePlacement {
    var records: [[String: Any]] = []
    var transform = CGAffineTransform.identity
    var saved: [CGAffineTransform] = []
    let page: Int
    let bounds: CGRect
    let depth: Int

    init(page: Int, bounds: CGRect, transform: CGAffineTransform = .identity, depth: Int = 0) {
        self.page = page
        self.bounds = bounds
        self.transform = transform
        self.depth = depth
    }

    func scan(_ content: CGPDFContentStreamRef) {
        guard depth < 16, let table = CGPDFOperatorTableCreate() else { return }
        CGPDFOperatorTableSetCallback(table, "q", { _, info in
            guard let info else { return }
            let state = Unmanaged<PDFImagePlacement>.fromOpaque(info).takeUnretainedValue()
            state.saved.append(state.transform)
        })
        CGPDFOperatorTableSetCallback(table, "Q", { _, info in
            guard let info else { return }
            let state = Unmanaged<PDFImagePlacement>.fromOpaque(info).takeUnretainedValue()
            if let previous = state.saved.popLast() { state.transform = previous }
        })
        CGPDFOperatorTableSetCallback(table, "cm", { scanner, info in
            guard let info else { return }
            let state = Unmanaged<PDFImagePlacement>.fromOpaque(info).takeUnretainedValue()
            var numbers = [CGPDFReal](repeating: 0, count: 6)
            for index in (0..<6).reversed() {
                guard CGPDFScannerPopNumber(scanner, &numbers[index]) else { return }
            }
            let next = CGAffineTransform(a: numbers[0], b: numbers[1], c: numbers[2], d: numbers[3], tx: numbers[4], ty: numbers[5])
            state.transform = next.concatenating(state.transform)
        })
        CGPDFOperatorTableSetCallback(table, "Do", { scanner, info in
            guard let info else { return }
            Unmanaged<PDFImagePlacement>.fromOpaque(info).takeUnretainedValue().draw(scanner)
        })
        let scanner = CGPDFScannerCreate(content, table, Unmanaged.passUnretained(self).toOpaque())
        _ = CGPDFScannerScan(scanner)
    }

    func draw(_ scanner: CGPDFScannerRef) {
        var name: UnsafePointer<CChar>?
        guard CGPDFScannerPopName(scanner, &name), let name else { return }
        let content = CGPDFScannerGetContentStream(scanner)
        guard let object = CGPDFContentStreamGetResource(content, "XObject", name) else { return }
        var stream: CGPDFStreamRef?
        guard CGPDFObjectGetValue(object, .stream, &stream), let stream,
              let dictionary = CGPDFStreamGetDictionary(stream) else { return }
        var subtype: UnsafePointer<CChar>?
        guard CGPDFDictionaryGetName(dictionary, "Subtype", &subtype), let subtype else { return }
        if String(cString: subtype) == "Image" {
            var width: CGPDFInteger = 0
            var height: CGPDFInteger = 0
            guard CGPDFDictionaryGetInteger(dictionary, "Width", &width),
                  CGPDFDictionaryGetInteger(dictionary, "Height", &height) else { return }
            let drawn = CGRect(x: 0, y: 0, width: 1, height: 1).applying(transform).standardized
            let visible = drawn.intersection(bounds)
            let area = drawn.width * drawn.height
            records.append(["page": page, "name": String(cString: name), "width": width, "height": height,
                            "x": drawn.minX, "y": drawn.minY, "drawnWidth": drawn.width, "drawnHeight": drawn.height,
                            "pageVisibleFraction": area > 0 && !visible.isNull ? visible.width * visible.height / area : 0])
        } else if String(cString: subtype) == "Form" {
            var resources: CGPDFDictionaryRef?
            guard CGPDFDictionaryGetDictionary(dictionary, "Resources", &resources), let resources else { return }
            var matrix: CGPDFArrayRef?
            var next = transform
            if CGPDFDictionaryGetArray(dictionary, "Matrix", &matrix), let matrix, CGPDFArrayGetCount(matrix) == 6 {
                var values = [CGPDFReal](repeating: 0, count: 6)
                for index in 0..<6 { _ = CGPDFArrayGetNumber(matrix, index, &values[index]) }
                next = CGAffineTransform(a: values[0], b: values[1], c: values[2], d: values[3], tx: values[4], ty: values[5]).concatenating(transform)
            }
            let nested = PDFImagePlacement(page: page, bounds: bounds, transform: next, depth: depth + 1)
            nested.scan(CGPDFContentStreamCreateWithStream(stream, resources, content))
            records.append(contentsOf: nested.records)
        }
    }
}

@MainActor
final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var window: NSWindow!
    let args = CommandLine.arguments
    var printWeb: WKWebView?
    var printNavigation: CheckedContinuation<Void, Error>?
    var printContinuation: CheckedContinuation<Bool, Never>?

    func applicationDidFinishLaunching(_ note: Notification) {
        guard args.count == 5 else {
            fputs("Usage: webkit-host BUNDLE export|partial|paste|scenario|print|printable INPUT OUTPUT\n", stderr)
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
        if webView === printWeb {
            printNavigation?.resume(throwing: error)
            printNavigation = nil
        } else {
            fputs("WKWebView navigation: \(error)\n", stderr)
            exit(1)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === printWeb {
            printNavigation?.resume()
            printNavigation = nil
        } else {
            Task { await execute() }
        }
    }

    func js(_ body: String, _ arguments: [String: Any] = [:], in target: WKWebView? = nil) async throws -> Any {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Any, Error>) in
            (target ?? web).callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page) {
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

    func frozenPrintView(_ html: String) async throws -> (WKWebView, NSWindow, Any) {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let frozen = WKWebView(frame: NSRect(x: 0, y: 0, width: 720, height: 640), configuration: configuration)
        printWeb = frozen
        frozen.navigationDelegate = self
        let panel = NSWindow(contentRect: frozen.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "InkKit disposable printable fixture"
        panel.contentView = frozen
        panel.orderFront(nil)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            printNavigation = continuation
            frozen.loadHTMLString(html, baseURL: nil)
        }
        let geometry = try await js("""
            const images = [...document.images];
            const timeout = new Promise((_, reject) => setTimeout(() => reject(Error('Printable image decoding timed out')), 15000));
            await Promise.race([Promise.all(images.map(async image => {
              if (!image.src.startsWith('data:image/')) throw Error('Printable image is not portable');
              await image.decode();
              if (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) throw Error('Printable image failed to decode');
            })), timeout]);
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return {
              viewportHeight: innerHeight,
              documentScrollHeight: document.documentElement.scrollHeight,
              editorComponents: document.querySelectorAll('.ProseMirror,textarea,button,input,select,[contenteditable],.inkkit-mermaid-preview').length,
              activeElements: document.querySelectorAll('script,iframe,object,embed').length,
              externalResources: performance.getEntriesByType('resource').filter(entry => /^https?:/i.test(entry.name)).map(entry => entry.name),
              images: images.map(image => ({width:image.naturalWidth,height:image.naturalHeight,complete:image.complete,renderedWidth:image.getBoundingClientRect().width,renderedHeight:image.getBoundingClientRect().height})),
            };
            """, in: frozen)
        return (frozen, panel, geometry)
    }

    func nativePrint(_ target: WKWebView, panel: NSWindow, geometry: Any, frozen: Bool) async throws -> [String: Any] {
        panel.makeKeyAndOrderFront(nil)
        target.layoutSubtreeIfNeeded()
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
        let operation = target.printOperation(with: info)
        operation.showsPrintPanel = false
        operation.showsProgressPanel = false
        // WebKit pagination needs the main run loop free to receive page rectangles.
        operation.canSpawnSeparateThread = true
        let printed = await withCheckedContinuation { continuation in
            printContinuation = continuation
            operation.runModal(for: panel, delegate: self, didRun: #selector(printDidRun(_:success:contextInfo:)), contextInfo: nil)
        }
        guard printed, let pdf = PDFDocument(url: pdfURL) else {
            throw NSError(domain: "Interop", code: 2, userInfo: [NSLocalizedDescriptionKey: "WKWebView print did not produce a PDF"])
        }
        let images = PDFImages()
        var pages: [[String: Any]] = []
        var placements: [[String: Any]] = []
        for index in 0..<pdf.pageCount {
            guard let page = pdf.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            pages.append(["page": index + 1, "width": bounds.width, "height": bounds.height])
            if let reference = page.pageRef {
                let placement = PDFImagePlacement(page: index + 1, bounds: bounds)
                placement.scan(CGPDFContentStreamCreateWithPage(reference))
                placements.append(contentsOf: placement.records)
            }
            var resources: CGPDFDictionaryRef?
            if let dictionary = page.pageRef?.dictionary,
               CGPDFDictionaryGetDictionary(dictionary, "Resources", &resources) {
                images.collect(resources, page: index + 1)
            }
        }
        return [
            "pdf": pdfURL.path, "pages": pdf.pageCount, "text": pdf.string ?? "",
            "paperWidth": Double(info.paperSize.width), "paperHeight": Double(info.paperSize.height),
            "printableWidth": Double(info.imageablePageBounds.width), "printableHeight": Double(info.imageablePageBounds.height),
            "screenGeometry": geometry, "frozenDocument": frozen,
            "imageXObjects": images.records, "imagePlacements": placements, "pageGeometry": pages,
        ]
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
            if ["scenario", "print", "printable"].contains(args[2]) {
                let scenario = try await js("return await window.interop.run(input)", ["input": input])
                var output = scenario as? [String: Any] ?? [:]
                if output["passed"] as? Bool != false && args[2] == "printable" {
                    let name = input["printableName"] as? String ?? "printable"
                    guard let results = output["results"] as? [String: Any],
                          let captured = results[name] as? [String: Any],
                          let html = captured["html"] as? String else {
                        throw NSError(domain: "Interop", code: 3, userInfo: [NSLocalizedDescriptionKey: "Printable mode requires a named public printableSnapshot result"])
                    }
                    let (frozen, panel, geometry) = try await frozenPrintView(html)
                    output["print"] = try await nativePrint(frozen, panel: panel, geometry: geometry, frozen: true)
                } else if args[2] == "print" {
                    _ = try await js("await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true")
                    let geometry = try await js("return { viewportHeight: innerHeight, documentScrollHeight: document.documentElement.scrollHeight, editorScrollHeight: document.querySelector('.ProseMirror')?.scrollHeight ?? null, foldedCallouts: document.querySelectorAll('[data-inkkit-folded=\"true\"]').length, commentsVisible: document.querySelector('.ProseMirror')?.getAttribute('data-inkkit-comments-visible') ?? null }")
                    output["print"] = try await nativePrint(web, panel: window, geometry: geometry, frozen: false)
                }
                result = output
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
