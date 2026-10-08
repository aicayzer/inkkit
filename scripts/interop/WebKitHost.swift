import AppKit
import WebKit
import Foundation

@MainActor
final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate {
 var web:WKWebView!;var window:NSWindow!
 let args=CommandLine.arguments
 func applicationDidFinishLaunching(_ note:Notification){
  web=WKWebView(frame:NSRect(x:0,y:0,width:720,height:640));web.navigationDelegate=self
  window=NSWindow(contentRect:NSRect(x:20,y:20,width:720,height:640),styleMask:[.titled,.closable],backing:.buffered,defer:false);window.title="InkKit disposable clipboard fixture";window.contentView=web
  let url=URL(fileURLWithPath:args[1]);web.loadFileURL(url,allowingReadAccessTo:url.deletingLastPathComponent())
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){Task{await execute()}}
 func js(_ body:String,_ arguments:[String:Any] = [:]) async throws -> Any {
  try await withCheckedThrowingContinuation { (continuation:CheckedContinuation<Any,Error>) in web.callAsyncJavaScript(body,arguments:arguments,in:nil,in:.page) {result in continuation.resume(with:result)} }
 }
 func execute() async {
  do {
   _=try await js("for(let n=0;n<200&&!window.ready;n++) await new Promise(r=>setTimeout(r,50)); if(!window.ready)throw new Error('InkKit mount timed out'); return true",[:])
   let input=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[3]))) as! [String:Any]
   _=try await js("return window.interop.load(source)",["source":input["source"] as? String ?? ""])
   let result:Any
   if args[2]=="export" || args[2]=="partial" {
    if args[2]=="partial" {_=try await js("window.interop.selectPartial();await new Promise(r=>setTimeout(r,100));return true",[:])}
    result=try await js("return await window.interop.export(all)",["all":args[2]=="export"])
   } else {
    result=try await js("return await window.interop.paste(input)",["input":input["clipboard"] as? [String:Any] ?? [:]])
   }
   try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:args[4]))
   NSApplication.shared.terminate(nil)
  } catch { fputs("\(error)\n",stderr);exit(1) }
 }
}
MainActor.assumeIsolated { let app=NSApplication.shared;app.setActivationPolicy(.accessory);let host=Host();app.delegate=host;app.run() }
