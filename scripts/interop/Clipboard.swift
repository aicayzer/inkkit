import AppKit
import Foundation

@MainActor
func output(_ value: Any, _ path: String) throws { try JSONSerialization.data(withJSONObject:value,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:path)) }
@MainActor
func richItem(_ value:[String:Any]) throws -> NSPasteboardItem {
 let html=value["html"] as? String ?? ""
 let images=(value["images"] as? [[String:Any]] ?? []).compactMap{$0["image"] as? [String:Any]}
 let pattern=try NSRegularExpression(pattern:"<img\\b[^>]*>",options:[.caseInsensitive]);let original=html as NSString
 let matches=pattern.matches(in:html,range:NSRange(location:0,length:original.length))
 var marked=html;let nonce=UUID().uuidString
 for (index,match) in matches.enumerated().reversed(){marked=(marked as NSString).replacingCharacters(in:match.range,with:"INKKITIMAGE\(nonce)SLOT\(index)")}
 let rich=try NSMutableAttributedString(data:Data(marked.utf8),options:[.documentType:NSAttributedString.DocumentType.html],documentAttributes:nil)
 for (index,image) in images.enumerated(){
  let data=Data(base64Encoded:image["bytesBase64"] as! String)!
  let range=(rich.string as NSString).range(of:"INKKITIMAGE\(nonce)SLOT\(index)")
  guard range.location != NSNotFound else { throw NSError(domain:"Interop",code:1,userInfo:[NSLocalizedDescriptionKey:"Image token missing"]) }
  let file=FileWrapper(regularFileWithContents:data);file.preferredFilename="image-\(index).png"
  rich.replaceCharacters(in:range,with:NSAttributedString(attachment:NSTextAttachment(fileWrapper:file)))
 }
 let item=NSPasteboardItem();item.setString(value["text"] as? String ?? "",forType:.string);item.setString(html,forType:.html)
 item.setData(try rich.data(from:NSRange(location:0,length:rich.length),documentAttributes:[.documentType:NSAttributedString.DocumentType.rtf]),forType:.rtf)
 if !images.isEmpty { item.setData(try rich.data(from:NSRange(location:0,length:rich.length),documentAttributes:[.documentType:NSAttributedString.DocumentType.rtfd]),forType:.rtfd) }
 return item
}
@MainActor
func main() throws {
 let command=CommandLine.arguments[1],path=CommandLine.arguments[2],pasteboard=NSPasteboard.general
 switch command {
 case "save":
  let items=(pasteboard.pasteboardItems ?? []).map { item in Dictionary(uniqueKeysWithValues:item.types.compactMap{type in item.data(forType:type).map{(type.rawValue,$0.base64EncodedString())}}) }
  try output(items,path)
 case "restore":
  let values=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:path))) as! [[String:String]]
  let items=values.map { value -> NSPasteboardItem in let item=NSPasteboardItem();for(type,data)in value { item.setData(Data(base64Encoded:data)!,forType:NSPasteboard.PasteboardType(type)) };return item }
  pasteboard.clearContents();pasteboard.writeObjects(items)
 case "write":
  let value=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:path))) as! [String:Any]
  let item=try richItem(value);pasteboard.clearContents();pasteboard.writeObjects([item])
 case "read":
  var value:[String:Any]=["types":pasteboard.types?.map{$0.rawValue} ?? [],"text":pasteboard.string(forType:.string) ?? "","html":pasteboard.string(forType:.html) ?? ""]
  var attachments:[[String:Any]]=[]
  if let data=pasteboard.data(forType:.rtfd) ?? pasteboard.data(forType:.rtf) {
   let type:NSAttributedString.DocumentType=pasteboard.data(forType:.rtfd) != nil ? .rtfd : .rtf
   if let rich=try? NSAttributedString(data:data,options:[.documentType:type],documentAttributes:nil) {
    value["richText"]=rich.string
    rich.enumerateAttribute(.attachment,in:NSRange(location:0,length:rich.length)){attribute,range,_ in
     if let attachment=attribute as? NSTextAttachment { let bytes=attachment.fileWrapper?.regularFileContents ?? attachment.contents ?? Data();attachments.append(["offset":range.location,"bytesBase64":bytes.base64EncodedString(),"filename":attachment.fileWrapper?.preferredFilename ?? ""])}
    }
    if let html=try? rich.data(from:NSRange(location:0,length:rich.length),documentAttributes:[.documentType:NSAttributedString.DocumentType.html]) {value["richHTML"]=String(data:html,encoding:.utf8) ?? ""}
   }
  }
  value["attachments"]=attachments;try output(value,path)
 case "png":
  let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:80,pixelsHigh:40,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
  for x in 0..<80 { for y in 0..<40 {bitmap.setColor(NSColor(deviceRed:1,green:0.1,blue:0.2,alpha:1),atX:x,y:y)} };try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:path))
 default: fatalError("Unknown command")
 }
}
try MainActor.assumeIsolated { try main() }
