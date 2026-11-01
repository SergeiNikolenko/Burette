import AppKit
import WebKit
func log(_ text: String) { FileHandle.standardOutput.write(Data((text + "\n").utf8)) }

// An offscreen WKWebView exercises the same custom-scheme/srcdoc boundary as
// Tauri. It never creates an application window or touches the user's session.
let root = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
class Scheme: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let file = root.appendingPathComponent(task.request.url!.path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else { task.didFailWithError(NSError(domain:"test",code:1)); return }
        do {
            let data = try Data(contentsOf:file)
            let mime = file.pathExtension == "js" ? "application/javascript" : file.pathExtension == "css" ? "text/css" : "text/html"
            task.didReceive(URLResponse(url:task.request.url!,mimeType:mime,expectedContentLength:data.count,textEncodingName:"utf-8"))
            task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
class Diagnostic: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { log("CSP: \(message.body)"); if let data = message.body as? [String:Any], data["blocked"] as? String == "blob" { log("FAIL: inherited CSP rejected owned Blob"); exit(1) } }
}
let config = WKWebViewConfiguration()
config.userContentController.add(Diagnostic(), name: "diagnostic")
config.userContentController.addUserScript(WKUserScript(source: "window.addEventListener('securitypolicyviolation',e=>window.webkit.messageHandlers.diagnostic.postMessage({directive:e.effectiveDirective,blocked:e.blockedURI,source:e.sourceFile,line:e.lineNumber}));", injectionTime: .atDocumentStart, forMainFrameOnly: false))
config.setURLSchemeHandler(Scheme(),forURLScheme:"tauri")
let view = WKWebView(frame:NSRect(x:0,y:0,width:800,height:650),configuration:config)
view.load(URLRequest(url:URL(string:"tauri://localhost/build/molecule-blob-preview-test/index.html")!))
let expected = [6502,11,6502,6502,6502,0]
var step = 0
var inspecting = false
let started = Date()
var diagnostic = false
let timer = Timer.scheduledTimer(withTimeInterval:0.25,repeats:true) { _ in
    if Date().timeIntervalSince(started) > 55 { log("FAIL: inspector stopped updating at step \(step)"); exit(1) }
    if !diagnostic && Date().timeIntervalSince(started) > 15 {
        diagnostic = true
        view.evaluateJavaScript("JSON.stringify({html:document.documentElement.outerHTML.slice(0,300),probe:window.blobProbe?{errors:window.blobProbe.errors,csp:window.blobProbe.csp,live:window.blobProbe.live.size}:null,frame:document.querySelector('iframe')?.contentDocument?.body?.innerText?.slice(0,300)})") { value, error in log("DIAGNOSTIC: \(String(describing:value)) \(String(describing:error))") }
    }
    if inspecting { return }
    inspecting = true
    view.evaluateJavaScript("""
    (()=>{const p=window.blobProbe;if(!p)return null;if(p.errors.length)return {count:-1,errors:p.errors};const f=document.querySelector('iframe');
    if(!f)return {count:0,live:p.live.size,retired:p.retired.length,errors:p.errors,csp:p.csp};
    const w=f.contentWindow,a=f.contentDocument?.querySelector('#app');if(!a||a.classList.contains('buret-inspector-updating'))return null;
    const structure=w.BuretteViewer?.plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj.data;if(!structure)return null;
    const step=Number(document.querySelector('output').textContent), text=new TextDecoder().decode(w.BuretteDataBytes);
    return {count:structure.elementCount,bonds:structure.units.reduce((n,u)=>n+u.bonds.edgeCount,0),hydrogens:w.BuretteConfig.hydrogenDisplay,theme:w.BuretteConfig.theme,ignoreH:[...w.BuretteViewer.plugin.state.data.cells.values()].filter(c=>c.obj?.data?.repr).map(c=>c.obj.data.repr.props.ignoreHydrogens),bytes:text.length,exact:text===(step===1?p.small:p.large),bounded:f.srcdoc.length<8000,live:p.live.size,retired:p.retired.length,errors:p.errors,csp:p.csp};})()
    """) { value,error in
        inspecting = false
        if let error = error { log("ERROR: \(error)") }
        guard let result = value as? [String:Any] else { return }
        if let errors = result["errors"] as? [String], !errors.isEmpty { log("FAIL: native preview errors \(errors)"); exit(1) }
        guard let count = result["count"] as? Int, count == expected[step] else { return }
        let data = try! JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]);log("STEP \(step) \(String(data:data,encoding:.utf8)!)")
        guard (result["errors"] as? [String])?.isEmpty == true, (result["csp"] as? [Any])?.isEmpty == true,
              result["live"] as? Int == (step == 5 ? 0 : 1), result["retired"] as? Int == (step == 5 ? 3 : min(step,2)),
              step == 5 || result["exact"] as? Bool == true && result["bounded"] as? Bool == true && result["hydrogens"] as? String == (step >= 3 ? "none" : "all") && result["theme"] as? String == (step >= 4 ? "dark" : "light") && (result["ignoreH"] as? [Bool])?.allSatisfy({ $0 == (step >= 3) }) == true else { log("FAIL: ownership/CSP/source mismatch");exit(1) }
        step += 1
        if step == expected.count { exit(0) }
        view.evaluateJavaScript("document.querySelector('button').click()",completionHandler:nil)
    }
}
app.run()
