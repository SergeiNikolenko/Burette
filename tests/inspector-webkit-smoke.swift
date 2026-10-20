import AppKit
import WebKit

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
let config = WKWebViewConfiguration()
config.setURLSchemeHandler(Scheme(),forURLScheme:"tauri")
let view = WKWebView(frame:NSRect(x:0,y:0,width:800,height:650),configuration:config)
view.load(URLRequest(url:URL(string:"tauri://localhost/build/inspector-webkit-test/index.html")!))
let expected = [3,24,3]
var step = 0
var inspecting = false
let started = Date()
let timer = Timer.scheduledTimer(withTimeInterval:0.25,repeats:true) { _ in
    if Date().timeIntervalSince(started) > 55 { print("FAIL: inspector stopped updating at step \(step)"); exit(1) }
    if inspecting { return }
    inspecting = true
    view.evaluateJavaScript("""
    (()=>{const f=document.querySelector('iframe');const w=f?.contentWindow;const a=f?.contentDocument?.querySelector('#app');
    if(!a||a.classList.contains('buret-inspector-updating'))return null;
    const viewer=w.BuretteViewer;
    const count=viewer?.plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj.data.elementCount;
    if(!count)return null;
    window.inspectorTestIdentity ||= {frame:f,viewer};
    return {count,same:window.inspectorTestIdentity.frame===f&&window.inspectorTestIdentity.viewer===viewer};})()
    """) { value,error in
        inspecting = false
        guard let result = value as? [String:Any], let count = result["count"] as? Int, count == expected[step] else { return }
        guard result["same"] as? Bool == true else { print("FAIL: row change recreated the iframe or viewer"); exit(1) }
        print("PASS: inspector step \(step), \(count) atoms")
        step += 1
        if step == expected.count { exit(0) }
        // This is a normal React effect/timer send, not a ready-event reply.
        view.evaluateJavaScript("document.querySelector('button').click()",completionHandler:nil)
    }
}
app.run()
