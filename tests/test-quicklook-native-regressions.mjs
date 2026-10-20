#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("SKIP Quick Look native regressions: requires macOS Swift runtime (covered by macOS CI).");
  process.exit(0);
}

const source = await readFile(new URL("../PreviewExtension/Platform/PreviewViewController.swift", import.meta.url), "utf8");
const parser = source.slice(source.indexOf("    private static func countXYZFrames("), source.indexOf("    private static func estimateTrajectoryFrameCount("));
const cubeParser = source.slice(source.indexOf("    private static func parseCube("), source.indexOf("    private static func parseABINIT("));
const abinitParser = source.slice(source.indexOf("    private static func parseABINIT("), source.indexOf("    private static func parseFDF("));
const orientationParser = source.slice(source.indexOf("    private static func normalizedXyzrenderOrientationRef("), source.indexOf("    private func reloadCurrentPreview("));
const navigationFailures = source.slice(source.indexOf("func webView(_ webView: WKWebView, didFail navigation:"), source.indexOf("    func webViewWebContentProcessDidTerminate("));
const timeout = source.slice(source.indexOf("private func scheduleRenderTimeout("), source.indexOf("    private func finishPreviewIfNeeded("));
const handler = source.slice(source.indexOf("fileprivate final class WeakPreviewScriptMessageHandler:"), source.indexOf("final class PreviewViewController:"));
const graphTypes = source.slice(source.indexOf("    private struct FepGraphMLPreview {"), source.indexOf("    private static let defaultRenderTimeoutSeconds"));
const graphFunctions = source.slice(source.indexOf("    private static func fepGraphMLPreview("), source.indexOf("    private static func fepGraphMLInlineHTML("));
const decodeText = source.slice(source.indexOf("    private static func decodeText("), source.indexOf("    private static func textArtifactPreviewContent("));
assert.ok(parser && timeout, "native regression entrypoints must exist");
assert.ok(graphTypes && graphFunctions && decodeText, "production GraphML helpers must exist");

const graphChecks = String.raw`
    static func checkGraphML() throws {
        func node(_ id: String?) -> String {
            let attribute = id.map { " id=\"\($0)\"" } ?? ""
            return "<node\(attribute)><data key=\"mol\">{\"atoms\":[],\"bonds\":[]}</data></node>"
        }
        func xml(_ nodes: String) -> Data {
            Data(("<graphml><key id=\"mol\" for=\"node\" attr.name=\"moldict\"/>"
                + "<graph edgedefault=\"undirected\">" + nodes + "</graph></graphml>").utf8)
        }
        for malformed in [node("same") + node("same"), node("mol1") + node(nil), node(nil) + node("mol0")] {
            do {
                _ = try fepGraphMLPreview(from: xml(malformed))
                assertionFailure("Duplicate effective node IDs must throw before dictionary construction")
            } catch PreviewError.unsupportedStructureFile(let message) {
                assert(message.contains("duplicate node ID"), message)
            }
        }
        let valid = try fepGraphMLPreview(from: xml(node("explicit") + node(nil)))
        assert(valid.nodes.map { $0.id } == ["explicit", "mol1"])
        let repeated = try fepEdgeListPreview(from: "a:b\na:b\nb:c\n")
        assert(repeated.nodes.map { $0.id } == ["a", "b", "c"])
        assert(repeated.edges.count == 3, "Repeated edges retain their original meaning")

        let names = ["node20", "center", "node10", "node2"]
        let nodes = names.map { FepGraphMLNode(id: $0, label: $0, atoms: 0, heavyAtoms: 0,
            bonds: 0, dockingScore: nil, molblock: "", x: 0, y: 0) }
        let edges = names.filter { $0 != "center" }.map { FepGraphMLEdge(source: "center", target: $0, score: nil) }
        let compact = layoutFepGraphMLPreview(FepGraphMLPreview(nodes: nodes, edges: edges))
        assert(compact.nodes.map { $0.id } == names, "Layout must retain input node order")
        let byID = Dictionary(uniqueKeysWithValues: compact.nodes.map { ($0.id, $0) })
        assert(byID["center"]!.x == 50 && byID["center"]!.y == 50)
        assert(byID["node2"]!.x == 25 && byID["node2"]!.y == 20)
        assert(byID["node10"]!.x == 75 && byID["node10"]!.y == 20)
        assert(byID["node20"]!.x == 75 && byID["node20"]!.y == 80)

        // This input is below the existing 25 MiB limit. The harness deadline
        // also bounds layout: a per-node scan of all leaves cannot finish it.
        let starText = (1...100_000).map { "hub:node\($0)" }.joined(separator: "\n")
        assert(starText.utf8.count < 25 * 1024 * 1024)
        let star = try fepEdgeListPreview(from: starText)
        assert(star.nodes.count == 100_001 && star.edges.count == 100_000)
        assert(star.nodes[0].x == 50 && star.nodes[0].y == 50)
        assert(star.nodes.allSatisfy { $0.x.isFinite && $0.y.isFinite })
    }
`;

// Execute the production parser and timeout method without building the app or
// importing AppKit/WebKit. Stubs observe timeout effects on the active request.
const harness = `
import Foundation
protocol WKScriptMessageHandler: AnyObject {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage)
}
final class WKUserContentController {}
final class WKScriptMessage {}
final class WKNavigation {}
final class WKWebView {}
${handler}
final class MessageRecipient: WKScriptMessageHandler {
    var received = 0
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { received += 1 }
}
var recipient: MessageRecipient? = MessageRecipient()
weak var observedRecipient = recipient
private let retainedHandler = WeakPreviewScriptMessageHandler(delegate: recipient!)
retainedHandler.userContentController(WKUserContentController(), didReceive: WKScriptMessage())
assert(recipient?.received == 1)
recipient = nil
assert(observedRecipient == nil, "WebKit's retained handler must not retain its owner")
retainedHandler.userContentController(WKUserContentController(), didReceive: WKScriptMessage())
enum PreviewError: Error {
    case webRenderTimedOut
    case unsupportedStructureFile(String)
    case emptyStructureFile(String)
}
struct GraphHarness {
    ${graphTypes}
    ${graphFunctions}
    ${decodeText}
    ${graphChecks}
}
final class PreviewHarness {
    struct Atom { let symbol: String; let x: Double; let y: Double; let z: Double }
    static func fields(_ line: String) -> [String] { line.split(whereSeparator: \\.isWhitespace).map(String.init) }
    static func symbol(for number: Int) -> String { number == 6 ? "C" : "O" }
    static func stripInlineComment(_ line: String) -> String { line }
    static func describe(_ error: Error) -> String { error.localizedDescription }
    var activePreviewRequestID = UUID()
    var activePreviewNavigation: WKNavigation?
    var renderTimeoutWorkItem: DispatchWorkItem?
    var renderedErrors = 0
    var completedRequests = 0
    func appendLog(_ message: String) {}
    func appendFailedPreviewTrace(requestID: UUID, error: Error, message: String) {}
    func renderNativeError(_ error: Error, fileURL: URL?) { renderedErrors += 1 }
    func finishPreviewIfNeeded(_ error: Error?, requestID: UUID? = nil) { completedRequests += 1 }
    ${parser}
    ${cubeParser}
    ${abinitParser}
    ${orientationParser}
    ${navigationFailures}
    ${timeout}
    static func checkParser() {
        assert(countXYZFrames(lines: [String(Int.max), "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["", String(Int.max - 1), "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["2", "comment", "C 0 0 0"], start: 0) == nil)
        assert(countXYZFrames(lines: ["0", "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["1", "comment", "C 0 0 0"], start: 0) == 1)
        assert(countXYZFrames(lines: ["1", "a", "C 0 0 0", "1", "b", "H 1 0 0"], start: 0) == 2)
        let cube = ["", "", "2 0 0 0", "1 1 0 0", "1 0 1 0", "1 0 0 1", "6 0 0 0 0", "8 0 2 0 0"]
        assert(parseCube(cube)?.count == 2)
        for count in [Int.min, Int.max, 3] {
            var malformed = cube
            malformed[2] = "\\(count) 0 0 0"
            assert(parseCube(malformed) == nil, "Malformed cube count must not overflow")
        }
        assert(normalizedXyzrenderOrientationRef("\\(Int.max)\\ncomment\\n") == nil)
        assert(normalizedXyzrenderOrientationRef("1\\ncomment\\nC 0 0 0") == "1\\ncomment\\nC 0 0 0\\n")
        assert(parseABINIT(["natom 1", "znucl 6", "typat \\(Int.min)", "xangst", "0 0 0"]) == nil)
        assert(parseABINIT(["natom 1", "znucl 6", "typat 1", "xangst", "0 0 0"])?.count == 1)
    }
    func checkNavigationFailures() {
        let view = WKWebView()
        let stale = WKNavigation()
        let current = WKNavigation()
        activePreviewNavigation = current
        let failure = NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotOpenFile)
        webView(view, didFail: stale, withError: failure)
        webView(view, didFailProvisionalNavigation: stale, withError: failure)
        let cancelled = NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)
        webView(view, didFail: current, withError: cancelled)
        webView(view, didFailProvisionalNavigation: current, withError: cancelled)
        assert(renderedErrors == 0 && completedRequests == 0, "Stale or cancelled navigation must not replace the new preview")
        webView(view, didFailProvisionalNavigation: current, withError: failure)
        assert(renderedErrors == 1 && completedRequests == 1)
        webView(view, didFail: current, withError: failure)
        assert(renderedErrors == 2 && completedRequests == 2)
    }
    func checkTimeout() {
        scheduleRenderTimeout(for: activePreviewRequestID, timeoutSeconds: 3600)
        activePreviewRequestID = UUID()
        renderTimeoutWorkItem?.perform()
        assert(renderedErrors == 0 && completedRequests == 0, "stale timeout modified current preview")
        scheduleRenderTimeout(for: activePreviewRequestID, timeoutSeconds: 3600)
        renderTimeoutWorkItem?.perform()
        assert(renderedErrors == 1 && completedRequests == 1)
        renderTimeoutWorkItem?.cancel()
    }
}
PreviewHarness.checkParser()
PreviewHarness().checkTimeout()
PreviewHarness().checkNavigationFailures()
try GraphHarness.checkGraphML()
`;
const directory = await mkdtemp(path.join(tmpdir(), "burette-native-regression-"));
try {
  const file = path.join(directory, "regression.swift");
  await writeFile(file, harness);
  const result = spawnSync("swift", [file], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `Swift regression failed (${result.signal ?? result.error ?? result.status}):\n${result.stderr.slice(0, 2000)}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

const prepare = source.slice(source.indexOf("    func preparePreviewOfFile("), source.indexOf("    private func appendFileDiagnostics("));
assert.match(prepare, /renderTimeoutWorkItem\?\.cancel\(\)\s*renderTimeoutWorkItem = nil/);
assert.ok(prepare.indexOf("renderTimeoutWorkItem?.cancel()") < prepare.indexOf("webView.stopLoading()"));
assert.match(source, /userContentController\.add\(WeakPreviewScriptMessageHandler\(delegate: self\), name: "burette"\)/);
assert.doesNotMatch(source, /userContentController\.add\(self, name: "burette"\)/);
console.log("Quick Look native parsers, GraphML identities/star layout, stale navigation, timeout, and handler ownership regressions passed.");
