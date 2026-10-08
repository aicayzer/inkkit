import Foundation
import ApplicationServices
let pid=pid_t(CommandLine.arguments[1])!
let title=CommandLine.arguments[2]
func value(_ element:AXUIElement,_ attr:String)->Any? {var v:CFTypeRef?;let result=AXUIElementCopyAttributeValue(element,attr as CFString,&v);return result == .success ? v:nil}
func tree(_ element:AXUIElement,_ depth:Int)->[String:Any] {
 var out:[String:Any]=[:]
 for name in [kAXRoleAttribute,kAXTitleAttribute,kAXDescriptionAttribute,kAXValueAttribute,kAXIdentifierAttribute,kAXFocusedAttribute] {if let v=value(element,name) { if let n=v as? NSNumber, n.doubleValue.isFinite {out[name]=n} else if let s=v as? String {out[name]=s} }}
 if depth<12,let children=value(element,kAXChildrenAttribute) as? [AXUIElement] {out["children"]=children.prefix(100).map{tree($0,depth+1)}}
 return out
}
let windows=(value(AXUIElementCreateApplication(pid),kAXWindowsAttribute) as? [AXUIElement] ?? []).filter{(value($0,kAXTitleAttribute) as? String) == title}
let data=try JSONSerialization.data(withJSONObject:windows.map{tree($0,0)},options:[.prettyPrinted,.sortedKeys]);FileHandle.standardOutput.write(data)
